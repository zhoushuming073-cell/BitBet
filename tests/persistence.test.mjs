import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

const mod = (p) => vite.ssrLoadModule(p);

let accountService, walletService, leaderboardService, repos, createServerEngine, roundFor;

before(async () => {
  accountService = await mod("/services/account-service.ts");
  walletService = await mod("/services/wallet-service.ts");
  leaderboardService = await mod("/services/leaderboard-service.ts");
  repos = (await mod("/repository/index.ts")).getRepositories();
  createServerEngine = (await mod("/lib/pulse5/engine/createServerEngine.ts")).createServerEngine;
  roundFor = (await mod("/lib/pulse5/game/RoundEngine.ts")).roundFor;
});

after(async () => {
  await vite.close();
});

// In Node there is no localStorage, so the memory store + mock auth run purely
// in-memory — ideal for exercising the persistence contract.

test("注册用户：余额 10000，重复 username 被拒", async () => {
  const acc = await accountService.registerUser("trader1");
  assert.equal(acc.isGuest, false);
  assert.equal(acc.username, "trader1");

  const wallet = await walletService.getWallet(acc.userId);
  assert.equal(wallet.availableBalance, 10000);
  assert.equal(wallet.pendingClaim, 0);

  await assert.rejects(() => accountService.registerUser("trader1"));
});

test("下注扣款正确，余额不足被拒（不会负余额）", async () => {
  const acc = await accountService.registerUser("trader2");
  const w1 = await walletService.debitBet(acc.userId, { orderId: "o1", roundId: "r1", stake: 1000 });
  assert.equal(w1.availableBalance, 9000);
  assert.equal(w1.totalStaked, 1000);

  await assert.rejects(
    () => walletService.debitBet(acc.userId, { orderId: "o2", roundId: "r1", stake: 100000 }),
  );
  const after = await walletService.getWallet(acc.userId);
  assert.equal(after.availableBalance, 9000, "拒绝后余额不变");
});

test("领取原子幂等：重复领取不二次入账", async () => {
  const acc = await accountService.registerUser("trader3");
  await walletService.addPendingClaim(acc.userId, 1917.3);

  await repos.settlements.createSettlement({
    _id: "st-o1",
    settlementId: "st-o1",
    userId: acc.userId,
    roundId: "r1",
    orderId: "o1",
    result: "UP",
    stake: 1000,
    lockedOdds: 1.9173,
    payout: 1917.3,
    profit: 917.3,
    claimStatus: "pending",
    settledAt: Date.now(),
    claimedAt: null,
    createdAt: Date.now(),
  });

  const first = await walletService.claimSettlement(acc.userId, "st-o1");
  assert.equal(first.alreadyClaimed, false);
  assert.equal(first.amount, 1917.3);

  const second = await walletService.claimSettlement(acc.userId, "st-o1");
  assert.equal(second.alreadyClaimed, true);
  assert.equal(second.amount, 0);

  const wallet = await walletService.getWallet(acc.userId);
  assert.equal(wallet.availableBalance, 11917.3, "入账一次");
  assert.equal(wallet.pendingClaim, 0, "待领取清零");
});

test("无权领取他人结算", async () => {
  const a = await accountService.registerUser("trader4a");
  const b = await accountService.registerUser("trader4b");
  await repos.settlements.createSettlement({
    _id: "st-oa",
    settlementId: "st-oa",
    userId: a.userId,
    roundId: "r1",
    orderId: "oa",
    result: "UP",
    stake: 100,
    lockedOdds: 1.9,
    payout: 190,
    profit: 90,
    claimStatus: "pending",
    settledAt: Date.now(),
    claimedAt: null,
    createdAt: Date.now(),
  });
  await assert.rejects(() => walletService.claimSettlement(b.userId, "st-oa"));
});

test("排行榜按净收益排序", async () => {
  await repos.leaderboard.upsertStats({
    _id: "u-high",
    userId: "u-high",
    totalOrders: 10,
    totalRounds: 5,
    totalStaked: 5000,
    totalPayout: 8000,
    netProfit: 3000,
    roi: 30,
    wins: 7,
    losses: 3,
    winRate: 70,
    currentBalance: 13000,
    updatedAt: Date.now(),
  });
  await repos.leaderboard.upsertStats({
    _id: "u-low",
    userId: "u-low",
    totalOrders: 10,
    totalRounds: 5,
    totalStaked: 5000,
    totalPayout: 6000,
    netProfit: 1000,
    roi: 10,
    wins: 5,
    losses: 5,
    winRate: 50,
    currentBalance: 11000,
    updatedAt: Date.now(),
  });

  const top = await leaderboardService.getLeaderboard("netProfit", 10);
  assert.equal(top[0].userId, "u-high");
  assert.equal(top[1].userId, "u-low");

  const rank = await leaderboardService.getMyRank("u-low", "netProfit");
  assert.equal(rank.rank, 2);
});

test("权威引擎下单幂等：同一 idempotencyKey 只建一单", async () => {
  const engine = createServerEngine();
  const now = Date.now();
  const round = roundFor(now);
  engine.setConnected(true);
  engine.seedVolatility(Array.from({ length: 25 }, (_, i) => 67000 + i * 0.5));
  engine.setRoundOpen(round.id, 67000);
  engine.onBookTicker(66999.5, 67000.5, now);
  engine.onTrade(67000, now);

  const first = engine.placeOrder("up", 100, "same-key", now);
  const before = engine.ledger.balance;
  // 超过 120ms rate-limit 窗口后重复提交 → 走幂等去重，而非限流拦截
  const again = engine.placeOrder("up", 100, "same-key", now + 200);
  assert.equal(again.id, first.id, "同 key 返回同一订单");
  assert.equal(engine.ledger.balance, before, "不重复扣款");
  assert.equal(engine.ledger.orders.length, 1);
});

test("并发领取：二十个请求最多一个入账", async () => {
  const acc = await accountService.registerUser("claimrace");
  const now = Date.now();
  await repos.recordSettlement({
    _id: "st-race",
    settlementId: "st-race",
    userId: acc.userId,
    roundId: "r-race",
    orderId: "o-race",
    result: "UP",
    stake: 100,
    lockedOdds: 1.9,
    payout: 190,
    profit: 90,
    claimStatus: "pending",
    settledAt: now,
    claimedAt: null,
    createdAt: now,
  }, now);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => repos.claim(acc.userId, "st-race", Date.now())),
  );
  assert.equal(results.filter((result) => !result.alreadyClaimed).length, 1);
  assert.equal(results.reduce((sum, result) => sum + result.amount, 0), 190);
  const wallet = await repos.wallets.getWallet(acc.userId);
  assert.equal(wallet.availableBalance, 10190);
  assert.equal(wallet.pendingClaim, 0);
});

test("并发下单：同一用户幂等键只扣一次并只建一单", async () => {
  const acc = await accountService.registerUser("orderrace");
  const now = Date.now();
  const order = {
    _id: "order-race",
    orderId: "order-race",
    userId: acc.userId,
    roundId: "round-race",
    idempotencyKey: "same-persistent-key",
    side: "up",
    stake: 250,
    lockedOdds: 1.9,
    potentialPayout: 475,
    entryPrice: 67000,
    placedAt: now,
    status: "OPEN",
    payout: 0,
    profit: 0,
    createdAt: now,
  };
  const results = await Promise.all([
    repos.placeOrder(acc.userId, order, now),
    repos.placeOrder(acc.userId, { ...order, orderId: "order-race-duplicate", _id: "order-race-duplicate" }, now + 1),
  ]);
  assert.equal(results.filter((result) => !result.alreadyExisted).length, 1);
  const wallet = await repos.wallets.getWallet(acc.userId);
  assert.equal(wallet.availableBalance, 9750);
  assert.equal((await repos.orders.listByUser(acc.userId)).length, 1);
});

test("pending_claim 可检测漂移并从 settlement 事实重建", async () => {
  const acc = await accountService.registerUser("repaircache");
  await repos.wallets.addPendingClaim(acc.userId, 123.45, Date.now());
  const before = await repos.pendingClaimConsistency(acc.userId);
  assert.equal(before.consistent, false);
  assert.equal(before.expected, 0);
  await repos.rebuildPendingClaim(acc.userId, Date.now());
  const after = await repos.pendingClaimConsistency(acc.userId);
  assert.deepEqual(after, { cached: 0, expected: 0, consistent: true });
});

test("胜率榜先在仓储层过滤 20 单门槛再排名", async () => {
  await repos.leaderboard.upsertStats({
    _id: "one-hit",
    userId: "one-hit",
    totalOrders: 1,
    totalRounds: 1,
    totalStaked: 10,
    totalPayout: 20,
    netProfit: 10,
    roi: 0.1,
    wins: 1,
    losses: 0,
    winRate: 100,
    currentBalance: 10010,
    updatedAt: Date.now(),
  });
  await repos.leaderboard.upsertStats({
    _id: "qualified",
    userId: "qualified",
    totalOrders: 20,
    totalRounds: 20,
    totalStaked: 200,
    totalPayout: 300,
    netProfit: 100,
    roi: 1,
    wins: 15,
    losses: 5,
    winRate: 75,
    currentBalance: 10100,
    updatedAt: Date.now(),
  });
  const rows = await repos.leaderboard.listTop("winRate", 50, 20);
  assert.equal(rows.some((row) => row.userId === "one-hit"), false);
  assert.equal(rows.some((row) => row.userId === "qualified"), true);
});
