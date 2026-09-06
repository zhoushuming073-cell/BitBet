# BitBet 境外部署迁移清单

> 本文件交给负责「境外 Site 部署」的后续 Agent。核心原则一句话：**实时逻辑（行情/赔率/本轮结算）跑境外，永久持久化（账号/钱包/历史/排行榜）跑腾讯云 CloudBase。** 不要让跨境数据库延迟影响实时下注。

## 1. 架构总览

```
浏览器（只展示 + 提交 side/stake）
   │  REST
   ▼
境外 BitBet 后端（权威引擎）
   ├─ Binance 行情（REST + WebSocket）—— 服务端单连接
   ├─ 权威状态（余额 / 订单 / 结算 / 领取）
   ├─ 赔率做市（MarketMaker / PriceImpact / Inventory）
   └─ 5 分钟轮次结算（Binance 5m K 线）
   │  异步同步（幂等 upsert）
   ▼
腾讯云 CloudBase（NoSQL 持久化）
   ├─ 账号 / 资料 / 钱包
   ├─ 轮次 / 订单 / 结算
   ├─ 钱包流水
   └─ 排行榜
```

- **REALTIME = 境外服务端**：Binance 行情、200ms 实时采样、实时赔率、当前局 inventory、依赖 Binance 的结算。
- **PERSISTENCE = CloudBase**：账号、钱包、已结束轮次、已结束订单、结算、领取、排行榜、历史。

## 2. 当前已实现（本地可验证）

| 模块 | 位置 | 状态 |
|---|---|---|
| 权威游戏引擎工厂 | `lib/pulse5/engine/createServerEngine.ts` | ✅ 可注入任意 `GameStateStore` |
| 权威状态抽象 | `lib/pulse5/orders/GameStateStore.ts` | ✅ `LedgerStore` 实现，`new LedgerStore(null)` 纯内存 |
| 本地权威后端 | `lib/game/server.ts` | ✅ 全局单例引擎 + 下单/结算/领取/查状态 |
| 权威 API | `app/api/game/{orders,settle,claim,claim-all,state}` | ✅ curl 验证闭环通过 |
| 浏览器 API 客户端 | `lib/game/client.ts` | ✅ |
| UI 切权威 API | `components/pulse5/market-game.tsx` | ✅ 下单/领取/结算走 API |
| 账号/钱包/排行榜持久化 | `repository/*` + `services/*` | ✅ Memory + CloudBase 双实现 |
| 结算同步桥接 | `services/settlement-sync-service.ts` + `game-coordinator.ts` | ✅ |
| claim 原子化 | `repository/types.ts` 的 `Repositories.claim` | ✅ Memory 单线程 / CloudBase 事务 |

## 3. 境外部署需要做的事（未完成，按优先级）

### 3.1 服务端行情（最高优先级）
现在 Binance 行情仍在浏览器（`createBrowserEngine` 的 `BinanceFeedManager`）。境外部署要：
1. 把 Binance REST/WS 迁到境外后端（单连接）。
2. 用 WebSocket / SSE 把行情推给浏览器。
3. 浏览器引擎降级为「行情订阅 + 赔率预览」，不再持有权威状态。

### 3.2 权威状态持久化
现在权威引擎用「模块级全局单例 + 纯内存 store」，只适合本地单进程。境外部署要：
- 换成 **Durable Object**（Cloudflare Workers）或 SQLite / Redis。
- 引擎的 `createServerEngine(store)` 已经支持注入任意 store，只需换 store 实现。

### 3.3 权威 API 鉴权
现在 `/api/game/*` 无鉴权（本地验证用）。生产必须：
- 用户身份（CloudBase Auth 或 JWT）。
- 服务端校验「下单金额 ≤ 该用户可用余额」「领取的 settlement 属于该用户」。
- 限流（防刷）。

### 3.4 幂等与防重放
- 下单：客户端传 `idempotencyKey`，服务端按 `roundId + key` 去重（引擎已支持）。
- 结算：按 `roundId` 幂等（`settleRound` 已幂等）。
- 领取：按 `settlementId` 幂等（`claim` 已原子幂等）。
- 同步：所有写按业务 ID upsert，重复同步不产生重复数据。

### 3.5 结算权威化
现在浏览器引擎检测 Binance 5m K 线并触发结算（`settleRoundOnce`），境外部署后改为服务端 Cron 或 WS kline-close 事件触发 `settle`，浏览器不再自己结算。

## 4. 环境变量清单

浏览器端（公开，`NEXT_PUBLIC_` 前缀）：
```
NEXT_PUBLIC_CLOUDBASE_ENV_ID=zsmcloud-d7g8r7pemc270c160
```

境外后端（敏感，禁止进浏览器 bundle / Git）：
```
CLOUDBASE_SECRET_ID=
CLOUDBASE_SECRET_KEY=
```

## 5. CloudBase 控制台需要手动配置

1. 创建 9 个集合：`users` `profiles` `wallets` `rounds` `orders` `settlements` `wallet_ledger` `leaderboard_stats` `sync_batches`。
2. 开启匿名登录（第一版默认）；后续可加邮箱/手机号/微信。
3. 给 `orders.orderId` / `settlements.settlementId` / `wallets.userId` 等加唯一索引。
4. 按 `docs/cloudbase-setup.md` 配数据库安全规则（开发宽松 / 生产收紧两套）。

## 6. 数据流（下单 → 结算 → 领取）

```
浏览器提交 side + stake + idempotencyKey
   │  POST /api/game/orders
   ▼
境外引擎：算 executionOdds → 校验余额 → 原子扣款 + 建单
   │  返回权威 order（lockedOdds / potentialPayout）
   ▼
浏览器展示挂单 / 余额（从 /api/game/state 拉取）

—— 轮次结束 ——

境外后端：Binance 5m K 线 close → settleRound
   │  WON/VOID → pendingClaim（不自动入账）
   ▼
浏览器显示「待领取 X」→ 用户点领取
   │  POST /api/game/claim（原子：标记 claimed + 入账 + 写流水）
   ▼
异步同步到 CloudBase（账号钱包 / 结算 / 排行榜）
```

## 7. 安全检查清单（生产前必过）

- [ ] 权威 API 全部鉴权（未登录拒绝）。
- [ ] 下单：服务端校验余额、计算赔率，客户端不传 lockedOdds/profit/balance。
- [ ] 领取：校验 settlement.userId === 当前用户，原子幂等。
- [ ] 排行榜：只从 `leaderboard_stats` 读，服务端 `refreshStats` 重算，不信任前端。
- [ ] CloudBase 安全规则收紧：客户端禁止写 `wallets`/`wallet_ledger`/`leaderboard_stats`。
- [ ] 限流 + 幂等键防重放。
- [ ] 生产日志不刷敏感信息。

## 8. 本地开发命令

```
npm run dev        # 5173
npm run build      # 生产构建
vinext start       # 3000（本地单进程，权威 API 全局单例可用）
npx tsc --noEmit
npm run lint
node --test tests/*.test.mjs
```
