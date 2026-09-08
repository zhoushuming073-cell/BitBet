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
let CFG, RoundEngine, FairProb, Volatility, PriceImpact, MarketMaker,
  LedgerStore, Position, Settlement, Pulse5Engine, ErrorCode, quickAmountsFor, availableQuickAmountsFor;

before(async () => {
  CFG = (await mod("/lib/pulse5/game/gameConfig.ts")).GAME_CONFIG;
  RoundEngine = await mod("/lib/pulse5/game/RoundEngine.ts");
  FairProb = await mod("/lib/pulse5/market/FairProbabilityEngine.ts");
  Volatility = await mod("/lib/pulse5/market/VolatilityEstimator.ts");
  PriceImpact = await mod("/lib/pulse5/market/PriceImpactModel.ts");
  MarketMaker = await mod("/lib/pulse5/market/MarketMaker.ts");
  LedgerStore = await mod("/lib/pulse5/orders/LedgerStore.ts");
  Position = await mod("/lib/pulse5/orders/PositionService.ts");
  Settlement = await mod("/lib/pulse5/settlement/SettlementService.ts");
  ({ quickAmountsFor, availableQuickAmountsFor } = await mod("/lib/pulse5/game/quickAmounts.ts"));
  Pulse5Engine = (await mod("/lib/pulse5/engine/Pulse5Engine.ts")).Pulse5Engine;
  ErrorCode = (await mod("/lib/pulse5/engine/errors.ts")).ErrorCode;
});

test("2000 USDT round-start balance yields 200 / 500 / 1000 shortcuts", () => {
  assert.deepEqual(quickAmountsFor(2000), [200, 500, 1000]);
});

test("quick buttons never emit zero or duplicate capped amounts", () => {
  assert.deepEqual(quickAmountsFor(0), []);
  assert.deepEqual(availableQuickAmountsFor(2000, 0), []);
  assert.deepEqual(availableQuickAmountsFor(2000, 80), [80]);
});

after(async () => {
  await vite.close();
});

// Deterministic 5m round: round starts at R and we are 180s in (120s left).
const R = 180_000_000; // exact multiple of 300000
const OPEN = 77_000;
function warmedEngine({ mid = OPEN, elapsedSec = 180, open = OPEN } = {}) {
  const e = new Pulse5Engine(null);
  e.setConnected(true);
  const closes = Array.from({ length: 25 }, (_, i) => open + i * 0.5);
  e.seedVolatility(closes);
  e.setRoundOpen(R, open);
  const now = R + elapsedSec * 1000;
  e.onBookTicker(mid - 0.5, mid + 0.5, now);
  e.onTrade(mid, now);
  return { e, now };
}
function buy(e, side, stake, now, key) {
  return e.placeOrder(side, stake, key ?? `k-${side}-${stake}-${now}-${Math.random().toString(36).slice(2, 6)}`, now);
}
function order(roundId, side, stake, odds, createdAt = roundId + 1000) {
  return {
    id: `x-${side}-${stake}-${odds}-${createdAt}`, userId: "local", roundId, side, stake,
    lockedOdds: odds, potentialPayout: Math.round(stake * odds * 100) / 100, priceAtEntry: OPEN,
    pFairUpAtEntry: 0.5, pMarketUpAtEntry: 0.5, volatilityAtEntry: 1e-4, inventoryAtEntry: 0,
    priceImpactPercent: 0, quoteId: "q", idempotencyKey: `k-${createdAt}-${side}`,
    status: "OPEN", payout: 0, profit: 0, createdAt, settledAt: null,
  };
}

// ---- 9. 50/50 -> 1.92x / 1.92x, 96% RTP ----
test("50/50 fair probability prices both sides at 1.92x (4% takeout)", () => {
  const b = MarketMaker.evaluateMarket({ openPrice: OPEN, midPrice: OPEN, tauSeconds: 120, sigma: 1e-4, openOrders: [] });
  assert.ok(Math.abs(b.pFairUp - 0.5) < 1e-9);
  assert.ok(Math.abs(b.pFairUp + b.pFairDown - 1) < 1e-12);
  assert.ok(Math.abs(b.baseUpOdds - 1.92) < 1e-9);
  assert.ok(Math.abs(b.baseDownOdds - 1.92) < 1e-9);
  // Decimal payout: 100 @1.92 -> 192 payout, 92 profit
  assert.equal(Math.round(100 * 1.92 * 100) / 100, 192);
  assert.equal(Math.round((100 * 1.92 - 100) * 100) / 100, 92);
});

// ---- 13/14. fair probability: z model, time enters via sqrt(tau) ----
test("fair probability rises as time runs out when price is above open", () => {
  const early = FairProb.computeFairProbability({ openPrice: OPEN, midPrice: OPEN + 30, tauSeconds: 120, sigmaPerSecond: 1e-4 });
  const late = FairProb.computeFairProbability({ openPrice: OPEN, midPrice: OPEN + 30, tauSeconds: 10, sigmaPerSecond: 1e-4 });
  assert.ok(late.pFairUp > early.pFairUp);
  assert.ok(Math.abs(early.pFairUp + early.pFairDown - 1) < 1e-12);
  const below = FairProb.computeFairProbability({ openPrice: OPEN, midPrice: OPEN - 30, tauSeconds: 10, sigmaPerSecond: 1e-4 });
  assert.ok(below.pFairUp < 0.5);
});

// ---- 18/19. no probability clamp, but quotability gates trading ----
test("does NOT clamp probability; one-sided market is unquotable instead", () => {
  const extreme = FairProb.computeFairProbability({ openPrice: OPEN, midPrice: OPEN * 1.002, tauSeconds: 2, sigmaPerSecond: 1e-4 });
  assert.ok(extreme.pFairUp > 0.95, "model keeps the true >95% probability");
  const b = MarketMaker.evaluateMarket({ openPrice: OPEN, midPrice: OPEN * 1.002, tauSeconds: 2, sigma: 1e-4, openOrders: [] });
  assert.equal(MarketMaker.isSideQuotable(b, "up"), false);
  assert.equal(MarketMaker.isSideQuotable(b, "down"), false);
});

// ---- 15-17. volatility estimator safety ----
test("volatility estimator handles warm-up, floor, NaN and outliers", () => {
  const est = new Volatility.VolatilityEstimator();
  assert.equal(est.warmed, false);
  est.seedFromOneMinuteKlines(Array.from({ length: 25 }, (_, i) => OPEN + i));
  assert.equal(est.warmed, true);
  assert.ok(est.sigma >= CFG.MIN_VOLATILITY_PER_SEC);
  let t = 1000;
  est.sample(OPEN, t); est.sample(NaN, (t += 1000)); est.sample(0, (t += 1000)); // ignored
  est.sample(OPEN + 1, (t += 1000));
  assert.ok(Number.isFinite(est.fastSigma) && Number.isFinite(est.slowSigma) && Number.isFinite(est.sigma));
  assert.ok(est.sigma >= CFG.MIN_VOLATILITY_PER_SEC && est.sigma <= CFG.MAX_VOLATILITY_PER_SEC);
  const flat = new Volatility.VolatilityEstimator();
  flat.seedFromOneMinuteKlines(Array.from({ length: 25 }, () => OPEN));
  assert.ok(flat.sigma >= CFG.MIN_VOLATILITY_PER_SEC, "dead-flat input still has a safety floor");
});

// ---- 25/26/75. inventory logit skew lowers favored-side odds ----
test("heavy UP liability lowers UP odds and raises DOWN odds at 50% fair", () => {
  const clean = MarketMaker.evaluateMarket({ openPrice: OPEN, midPrice: OPEN, tauSeconds: 120, sigma: 1e-4, openOrders: [] });
  const heavyUp = [order(R, "up", 40_000, 2.0), order(R, "up", 30_000, 2.0)];
  const skewed = MarketMaker.evaluateMarket({ openPrice: OPEN, midPrice: OPEN, tauSeconds: 120, sigma: 1e-4, openOrders: heavyUp });
  assert.ok(skewed.pMarketUp > 0.5);
  assert.ok(skewed.baseUpOdds < clean.baseUpOdds);
  assert.ok(skewed.baseDownOdds > clean.baseDownOdds);
});

// ---- 29/30/76. price impact: large order gets worse odds than small ----
test("price impact worsens odds with size via slice integration", () => {
  const small = PriceImpact.computePriceImpact({ side: "up", stake: 100, pFairUp: 0.5, liabilityUp: 0, liabilityDown: 0 });
  const large = PriceImpact.computePriceImpact({ side: "up", stake: 10_000, pFairUp: 0.5, liabilityUp: 0, liabilityDown: 0 });
  assert.ok(Math.abs(small.priceImpactPercent) < Math.abs(large.priceImpactPercent));
  assert.ok(small.averageOdds > large.averageOdds);
  assert.ok(large.averageOdds < small.baseOdds);
});

// ---- 70. continuous orders UP/UP/DOWN/UP all succeed ----
test("allows unlimited mixed-direction orders within one round", () => {
  const { e, now } = warmedEngine();
  let t = now;
  buy(e, "up", 100, t, "a"); t += 200;
  buy(e, "up", 200, t, "b"); t += 200;
  buy(e, "down", 300, t, "c"); t += 200;
  buy(e, "up", 400, t, "d");
  assert.equal(e.ledger.orders.length, 4);
  assert.equal(e.ledger.balance, 10_000 - 1000);
  const sides = e.ledger.orders.map((o) => o.side);
  assert.deepEqual(sides, ["up", "down", "up", "up"]); // newest first
});

// ---- 71. balance accounting + insufficient balance ----
test("debits each hedge leg independently and rejects overspend", () => {
  const { e, now } = warmedEngine();
  let t = now;
  buy(e, "up", 3000, t, "b1"); t += 200;
  assert.equal(e.ledger.balance, 7000);
  buy(e, "down", 4000, t, "b2"); t += 200;
  assert.equal(e.ledger.balance, 3000);
  assert.throws(() => buy(e, "up", 5000, t, "b3"), (err) => err.code === ErrorCode.INSUFFICIENT_BALANCE);
  assert.equal(e.ledger.balance, 3000);
});

// ---- 6/35. per-order locked odds + payout-weighted avg odds (req 72) ----
test("aggregates side position with payout-weighted average odds", () => {
  const orders = [order(R, "up", 1000, 2.1), order(R, "up", 500, 1.71)];
  const pos = Position.buildPosition(R, orders, 7000);
  assert.equal(pos.up.stake, 1500);
  assert.equal(pos.up.payout, 2955); // 2100 + 855
  assert.ok(Math.abs(pos.up.avgOdds - 1.97) < 1e-9);
});

// ---- 73. hedge PnL (buy up AND down) ----
test("IF UP / IF DOWN PnL for coexisting up and down positions", () => {
  const orders = [order(R, "up", 1000, 2.1), order(R, "down", 600, 2.5)];
  const pos = Position.buildPosition(R, orders, 8400);
  assert.equal(pos.totalInvested, 1600);
  assert.equal(pos.pnlIfUp, 2100 - 1600);   // +500
  assert.equal(pos.pnlIfDown, 1500 - 1600); // -100
});

// ---- 44. locking profit on both sides is allowed ----
test("allows both outcome PnLs to be positive (locked profit)", () => {
  const orders = [order(R, "up", 100, 3.0), order(R, "down", 100, 3.0)];
  const pos = Position.buildPosition(R, orders, 9800);
  assert.ok(pos.pnlIfUp > 0 && pos.pnlIfDown > 0);
});

// ---- orders are placed by amount and filled at the LATEST market ----
test("order locks the latest-market odds/entry at order time, not an old quote", () => {
  const { e, now } = warmedEngine({ mid: OPEN });
  const first = e.placeOrder("up", 100, "k-first", now);
  assert.equal(first.status, "OPEN");
  assert.ok(first.lockedOdds > 0 && first.priceAtEntry === OPEN);
  // Market ticks down before the next order; the new order uses the new latest
  // price (stays comfortably inside the quotable probability band).
  const moved = OPEN - 10;
  e.onBookTicker(moved - 0.5, moved + 0.5, now + 400);
  const second = e.placeOrder("up", 100, "k-second", now + 400);
  assert.equal(second.priceAtEntry, moved);
  // The first order keeps its independently locked odds.
  assert.notEqual(second.lockedOdds, first.lockedOdds);
});

test("bot order reason is stored on the real order record", () => {
  const { e, now } = warmedEngine();
  const placed = e.placeOrder("up", 100, "bot-reason", now, "短线动量增强");
  assert.equal(placed.reason, "短线动量增强");
  assert.equal(e.ledger.orders[0].reason, "短线动量增强");
});

// ---- 33. idempotency prevents double spend on duplicate submit ----
test("same idempotency key returns the original order without double debit", () => {
  const { e, now } = warmedEngine();
  const first = e.placeOrder("up", 100, "same-key", now);
  const before = e.ledger.balance;
  const again = e.placeOrder("up", 100, "same-key", now + 201);
  assert.equal(again.id, first.id);
  assert.equal(e.ledger.balance, before);
});

// ---- feed latency / brief disconnect never blocks trading ----
test("an old feed timestamp still allows an order, filled at the last known market", () => {
  const { e, now } = warmedEngine();
  e.setConnected(false); // brief reconnect
  e.onBookTicker(OPEN - 0.5, OPEN + 0.5, now - 10_000); // stale timestamp
  const order = e.placeOrder("down", 100, "k-latency", now); // must NOT throw
  assert.equal(order.status, "OPEN");
  assert.ok(order.priceAtEntry > 0 && order.lockedOdds > 0);
});

// ---- 47/78. last-15s lock boundary is authoritative ----
test("betting locks exactly at end - 15s (15.001 ok, 15.000/14.999 reject)", () => {
  const e = new Pulse5Engine(null);
  e.setConnected(true);
  e.seedVolatility(Array.from({ length: 25 }, (_, i) => OPEN + i * 0.5));
  e.setRoundOpen(R, OPEN);
  const end = R + CFG.ROUND_DURATION_MS;
  const feed = (now) => e.onBookTicker(OPEN - 0.5, OPEN + 0.5, now);

  feed(end - 15_001);
  assert.doesNotThrow(() => e.requestQuote("up", 100, end - 15_001));
  feed(end - 15_000);
  assert.throws(() => e.requestQuote("up", 100, end - 15_000), (err) => err.code === ErrorCode.ROUND_LOCKED);
  feed(end - 14_999);
  assert.throws(() => e.requestQuote("up", 100, end - 14_999), (err) => err.code === ErrorCode.ROUND_LOCKED);
});

// ---- 51/53/79. settlement win/loss/draw + idempotency + claimable payouts ----
test("settlement marks winners claimable, voids draw, is idempotent", () => {
  // UP round: one up winner @2.1, one down loser.
  const ledger = new LedgerStore.LedgerStore(null);
  ledger.balance = 9800;
  ledger.addOrder(order(R, "up", 100, 2.1));
  ledger.addOrder(order(R, "down", 100, 2.0));
  const first = Settlement.settleRound({ ledger, roundId: R, openPrice: OPEN, closePrice: OPEN + 50, now: R + 300_000 });
  assert.equal(first.result, "UP");
  assert.equal(ledger.balance, 9800); // winnings are NOT auto-credited; await claim
  const up = ledger.orders.find((o) => o.side === "up");
  const down = ledger.orders.find((o) => o.side === "down");
  assert.equal(up.status, "WON"); assert.equal(up.payout, 210); assert.equal(up.claimed, false);
  assert.equal(down.status, "LOST"); assert.equal(down.profit, -100); assert.equal(down.claimed, true);
  assert.equal(ledger.claimableBalance(), 210);
  assert.equal(first.summary.roundPnL, 210 - 200);
  // claim the winner -> balance credits exactly once
  assert.equal(ledger.claimOrder(up.id), 210);
  assert.equal(ledger.balance, 9800 + 210);
  assert.equal(ledger.claimableBalance(), 0);
  // settle again -> no double credit
  const second = Settlement.settleRound({ ledger, roundId: R, openPrice: OPEN, closePrice: OPEN + 50, now: R + 300_000 });
  assert.equal(second.alreadySettled, true);
  assert.equal(ledger.balance, 9800 + 210);

  // DRAW refunds both stakes, claimable with no takeout.
  const ledger2 = new LedgerStore.LedgerStore(null);
  ledger2.balance = 9800;
  ledger2.addOrder(order(R + 300_000, "up", 100, 2.1));
  ledger2.addOrder(order(R + 300_000, "down", 100, 2.0));
  const draw = Settlement.settleRound({ ledger: ledger2, roundId: R + 300_000, openPrice: OPEN, closePrice: OPEN, now: R + 600_000 });
  assert.equal(draw.result, "DRAW");
  assert.equal(ledger2.balance, 9800); // refunds not auto-credited
  assert.ok(ledger2.orders.every((o) => o.status === "VOID" && o.profit === 0 && o.claimed === false));
  assert.equal(ledger2.claimableBalance(), 200);
  assert.equal(ledger2.claimAll(), 200);
  assert.equal(ledger2.balance, 10_000);
});

// ---- persistence: in-memory ledger survives rehydration ----
test("ledger snapshot/rehydration restores balance and open orders", () => {
  let saved = null;
  const persister = { load: () => saved, save: (s) => { saved = s; } };
  const a = new LedgerStore.LedgerStore(persister);
  a.debit(250); a.addOrder(order(R, "up", 250, 1.92)); a.persist();
  const b = new LedgerStore.LedgerStore(persister);
  assert.equal(b.balance, 9750);
  assert.equal(b.openOrdersForRound(R).length, 1);
});

// ---- round boundaries align to 5m and lock = end - 15s ----
test("rounds align to UTC 5m boundaries with a 15s lock", () => {
  const r = RoundEngine.roundFor(R + 12_345);
  assert.equal(r.id, R);
  assert.equal(r.end - r.start, CFG.ROUND_DURATION_MS);
  assert.equal(r.end - r.lockTime, CFG.BET_LOCK_MS);
  assert.equal(R % CFG.ROUND_DURATION_MS, 0);
});

// ---- smooth hand-off: market never blanks while the new round open is in flight ----
test("a new round shows a provisional open (no dash) and locks betting until the official open arrives", () => {
  const e = new Pulse5Engine(null);
  e.setConnected(true);
  e.seedVolatility(Array.from({ length: 25 }, (_, i) => OPEN + i * 0.5));
  const now = R + 10_000; // 10s into round R, whose official open was never set yet
  e.onBookTicker(OPEN - 0.5, OPEN + 0.5, now);
  e.onTrade(OPEN, now);
  let v = e.getView(now);
  assert.ok(v.market, "market snapshot stays populated across the boundary");
  assert.equal(v.market.openPending, true);
  assert.equal(v.market.roundOpen, OPEN); // provisional = current mid
  assert.equal(v.bettingState, "NO_ROUND_OPEN");
  e.setRoundOpen(R, OPEN - 2); // official 5m open arrives (WS/REST)
  v = e.getView(now + 100);
  assert.equal(v.market.openPending, false);
  assert.equal(v.market.roundOpen, OPEN - 2);
  assert.equal(v.bettingState, "OK");
});

// ---- smooth hand-off: settlement result is exposed for the result toast, idempotently ----
test("settle exposes lastSettlement summary and a repeat settle does not overwrite it", () => {
  const { e, now } = warmedEngine({ mid: OPEN });
  buy(e, "up", 100, now, "last-settle-1");
  const end = R + CFG.ROUND_DURATION_MS;
  const out = e.settle(R, OPEN, OPEN + 50, end);
  const v = e.getView(end + 1);
  assert.ok(v.lastSettlement);
  assert.equal(v.lastSettlement.roundId, R);
  assert.equal(v.lastSettlement.winningSide, "UP");
  assert.equal(v.lastSettlement.grossPayout, out.summary.grossPayout);
  assert.equal(v.lastSettlement.roundPnL, out.summary.grossPayout - 100);
  const again = e.settle(R, OPEN, OPEN + 50, end + 2000);
  assert.equal(again.alreadySettled, true);
  assert.equal(e.getView(end + 3).lastSettlement.settledAt, end);
});

test("authoritative ledger restore announces a newly settled winning round", () => {
  const { e, now } = warmedEngine({ mid: OPEN });
  buy(e, "up", 100, now, "server-restore-settlement");

  const server = new Pulse5Engine(new LedgerStore.LedgerStore(null, e.ledger.snapshot()));
  const end = R + CFG.ROUND_DURATION_MS;
  server.settle(R, OPEN, OPEN + 50, end);

  e.restoreLedger(server.ledger.snapshot(), { announceNewSettlement: true });
  const notice = e.getView(end + 1).lastSettlement;
  assert.ok(notice);
  assert.equal(notice.roundId, R);
  assert.equal(notice.winningSide, "UP");
  assert.equal(notice.grossPayout, server.ledger.orders[0].payout);
  assert.equal(e.getView(end + 1).claimable, server.ledger.orders[0].payout);
});
