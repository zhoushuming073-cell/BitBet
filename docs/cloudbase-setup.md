# BitBet · CloudBase 接入说明

本文件说明接入腾讯云 CloudBase 持久化需要在控制台手动完成的配置，以及安全规则建议。

> 架构原则：**实时（Binance 行情、赔率、本轮结算）跑在境外服务端；CloudBase 只负责永久持久化（账号、钱包、历史、排行榜）。** 不要把 CloudBase 用作实时游戏锁。

## 1. 需要手动创建的集合（collections）

在 CloudBase 控制台「数据库」中创建以下 9 个集合：

`users`、`profiles`、`wallets`、`rounds`、`orders`、`settlements`、`wallet_ledger`、`leaderboard_stats`、`sync_batches`

幂等依赖：`orders` 以 `orderId` 为 `_id`、`settlements` 以 `settlementId` 为 `_id`、`wallets` 以 `userId` 为 `_id`、`rounds` 以 `roundId` 为 `_id`、`leaderboard_stats` 以 `userId` 为 `_id`、`wallet_ledger` 以 `ledgerId` 为 `_id`、`sync_batches` 以 `batchId` 为 `_id`。业务 ID 字段建议在控制台加**唯一索引**。

## 2. 登录方式（Auth）

- 开启**匿名登录**（anonymous provider）——第一版默认用它拿到 `authUid`，无需密码。
- `users` 集合**不存密码**；`username` 是业务资料（存于 `users` + `profiles`，唯一）。
- 后续可开启邮箱/手机号/微信登录，替换 `CloudBaseAuthAdapter` 即可，业务层无感知。

## 3. 环境变量

浏览器端只需要公开的 env id（见 `.env.example`）：

```
NEXT_PUBLIC_CLOUDBASE_ENV_ID=zsmcloud-d7g8r7pemc270c160
```

`CLOUDBASE_SECRET_ID` / `CLOUDBASE_SECRET_KEY` 仅供境外服务端 / 云函数使用，**严禁**放入浏览器 bundle 或 Git。

## 4. 数据库安全规则

### 开发阶段（宽松，浏览器 SDK 直连验证）

登录用户读写自己的数据、公开读排行榜与轮次：

```json
{
  "users": { "read": true, "write": "auth != null" },
  "profiles": { "read": true, "write": "auth != null" },
  "wallets": { "read": "auth != null && doc._id == auth.uid", "write": "auth != null && doc._id == auth.uid" },
  "orders": { "read": "auth != null && doc.userId == auth.uid", "write": "auth != null && doc.userId == auth.uid" },
  "settlements": { "read": "auth != null && doc.userId == auth.uid", "write": "auth != null && doc.userId == auth.uid" },
  "rounds": { "read": true, "write": "auth != null" },
  "leaderboard_stats": { "read": true, "write": false },
  "wallet_ledger": { "read": "auth != null && doc.userId == auth.uid", "write": false },
  "sync_batches": { "read": false, "write": false }
}
```

### 生产阶段（收紧，敏感写交给境外服务端 / 云函数）

- `wallets`、`wallet_ledger`、`leaderboard_stats`、`sync_batches`：**客户端只读或禁止写**，写操作由境外后端调用 CloudBase 服务端 SDK（SecretId/SecretKey）或云函数完成。
- `orders`、`settlements`：客户端只读自己的；创建由境外后端在结算时写入。
- 排行榜只允许从 `leaderboard_stats` 读取（服务端在结算后重算 `refreshStats`）。

## 5. 领取与并发

- 领取幂等：`settlements` 先置 `claimStatus=claimed`，再入账 `wallets` + 写 `wallet_ledger`；重复领取返回 `already_claimed`，绝不二次入账。
- 下注原子性：境外服务端在扣款前校验 `availableBalance >= stake`，`扣款 + 建单` 在同一事务（境外 durable store 的 user-level lock / 事务）。
- 生产环境请用**云函数 + 事务**保证 settlement claim 的原子性，浏览器 SDK 的跨集合操作不保证强一致。

## 6. 同步与重试

- 境外服务端每轮结束后：`finishRound(N)` → 立即 `startRound(N+1)`，然后 `syncQueue.enqueue(N)` 后台异步同步到 CloudBase。
- 同步幂等：所有写都是按业务 ID 的 upsert，重复同步不产生重复数据。
- 失败按 `1s/2s/5s/10s/30s/60s` 指数退避重试，上限 60s；CloudBase 断线不影响下一轮竞猜。
