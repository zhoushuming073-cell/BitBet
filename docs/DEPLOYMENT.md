# BitBet · Sites 部署说明

## 当前生产架构

- 站点：OpenAI Sites / Cloudflare Worker 运行时。
- 身份：Sites 网关注入的 ChatGPT 用户 ID；客户端提交的 `userId` 不受信任。
- 数据：D1 的 `game_actor_ledgers`、`lambda_configs`、`bot_scheduler_leases`。
- 行情：客户端与服务端统一使用 Kraken BTC/USDT 公共市场数据；服务端读取盘口、分钟 K 线和官方 5 分钟结算 K 线。
- 权威路径：玩家下单、Bot 决策、实际执行赔率、资金扣减、结算和领取都在服务端完成。
- 并发：账本使用版本号进行乐观并发控制；调度器使用 D1 lease 避免重复执行。

## 迁移

Drizzle schema 位于 `db/schema.ts`，生成迁移位于 `drizzle/`。Sites 发布时会将追加迁移应用到绑定名为 `DB` 的 D1 数据库。

不要修改已经发布的 SQL 迁移；后续结构变化应继续生成新的递增迁移。

## Bot 后台运行与补算

Worker 导出 `scheduled` 入口，用于定时推进全部已建立账户的 Alpha、Beta、Lambda。每次用户打开页面也会推进自己的四人赛状态。

为容忍调度或网络中断，服务端会从 Bot 最后评估时间开始，以历史 1 秒 K 线按 5 秒决策点回放最近最多 12 个缺失轮次。每次策略调用只能看到当前回放时点以前的样本；收盘价仅在该轮全部决策结束后用于结算。

## 发布验证

```text
npx tsc --noEmit
npm run lint
npm test
```

发布后还应验证：

1. 未登录访问写接口返回 401，并能通过 `/signin-with-chatgpt` 登录。
2. `/api/game/state` 返回一个玩家和三个 Bot 的服务端快照。
3. 下单响应包含服务端生成的订单与更新后账本，刷新或换浏览器后仍存在。
4. Lambda 配置保存后跨浏览器一致，订单包含 `strategyMeta`。
5. 结算只使用已经关闭的官方 5 分钟 K 线；重复结算和重复领取不会二次入账。

旧 CloudBase/MySQL 代码仅作为历史兼容模块保留，不再承载首页的 BitBet 权威账本。
