# CloudBase MySQL 与身份认证配置

## MySQL

CloudBase 官方支持连接字符串直连。生产使用云托管内网地址；外网直连仅用于本地调试。

1. 在 CloudBase 控制台初始化 MySQL 8.0。
2. 配置 `CONNECTION_URI=mysql://user:password@host:3306/tcb`，或分别配置 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。
3. 依次执行 `migrations/001_initial_schema.sql`、`migrations/002_pending_claim_integrity.sql`。
4. 不要把连接串、数据库密码、内部结算密钥写入 Git 或任何 `NEXT_PUBLIC_*` 变量。

## CloudBase Auth

1. 开启邮箱注册、用户名密码登录并配置 SMTP。
2. Web SDK 使用 `auth.signUp({ email, password, username })` 发验证码，再调用返回的 `data.verifyOtp({ token })` 完成注册。
3. 登录使用 `auth.signInWithPassword({ email, password })`。
4. Web SDK 通过 `auth.getAccessToken()` 获取 Access Token，前端只在 `Authorization: Bearer ...` 中传给业务 API。
5. 在 CloudBase HTTP 网关开启身份认证。后端只在网关已验签的前提下解析 `user_id`；不能把“仅解码 JWT”当作验签。

## 数据一致性

- `(orders.user_id, orders.idempotency_key)` 唯一，防止重放重复扣款。
- `wallet_ledger` 对下注订单与领取结算均有唯一约束。
- 领取使用 `SELECT ... FOR UPDATE`；并发请求中最多一个事务改变 `pending` 状态并入账。
- `wallets.pending_claim` 与未领取 `settlements.payout` 不一致时，使用仓储的 `rebuildPendingClaim()` 或第二份迁移修复。
- 胜率榜只纳入 `total_orders >= 20`，筛选和排序都在仓储/SQL 层完成。
