# BitBet 生产部署清单

## 已完成的代码边界

- 业务持久层已提供 CloudBase MySQL 8.0 适配器，连接使用 `CONNECTION_URI`，或 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`。
- `migrations/001_initial_schema.sql` 建立账号、钱包、轮次、订单、结算、流水、排行榜和同步队列表；`002_pending_claim_integrity.sql` 可重建待领取缓存。
- 下单通过 `SELECT ... FOR UPDATE` 锁钱包，并在一个事务中完成订单唯一性检查、扣款、订单与流水。
- 单笔领取和全部领取都在事务中锁定结算与钱包；重复请求不会重复入账。
- `settlements` 是待领取事实来源，`wallets.pending_claim` 只是物化缓存，可检查并重建。
- 正式账号 API 使用 `requireUser()`，业务接口不接受客户端 `userId`。
- 生产下单不接受客户端 `midPrice`；本地回退必须同时满足非 production 和 `ALLOW_CLIENT_MARKET_PRICE_DEV=true`。
- 生产缺少 MySQL、持久化游戏状态、服务端行情或网关鉴权时均 fail closed。

## 上线前仍必须完成

1. 在 CloudBase MySQL 8.0 执行两份迁移，并用专用低权限数据库账号配置云托管内网连接。
2. 在 CloudBase 身份认证中开启邮箱注册、用户名密码登录和 SMTP 发码。
3. 在 HTTP 网关为 `/api/account/*` 与 `/api/game/*` 开启身份认证；确认后端只能经该入口访问，再设置 `CLOUDBASE_HTTP_AUTH_VERIFIED=true`。
4. 注入真实服务端 BTC 行情实现 `MarketPriceProvider`，并由可信服务端任务根据 Binance 5m 收盘触发结算。
5. 注入 `GameStateStoreFactory` 的持久化实现（SQLite、Redis 等均可）；生产不允许默认内存实现。
6. 使用 `MySqlSyncQueue` 或同等持久化实现运行同步 worker。
7. 生成并安全保存 `INTERNAL_SETTLEMENT_SECRET`，只授予结算 worker。
8. 运行真实 MySQL 集成测试、并发压测、网关鉴权测试后再部署。

## 验证命令

```text
npx tsc --noEmit
npm run lint
npm run build
node --test --test-concurrency=1 tests/*.test.mjs
```

没有真实 `CONNECTION_URI` 时，测试只覆盖内存事务模型和 SQL 静态契约，不能声称已接通 CloudBase MySQL。
