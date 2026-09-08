# BitBet · BTC 5 分钟涨跌

BitBet 是一个使用实时 BTC/USDT 行情的 **5 分钟虚拟涨跌预测游戏**。玩家使用模拟 USDT 与两个性格不同的 Bot 同场竞猜、结算并参与三人周赛；项目不接触真实资金，也不构成投资建议。

线上地址：[pulse5-btc-sim.zhoushuming.chatgpt.site](https://pulse5-btc-sim.zhoushuming.chatgpt.site/)

![BitBet 手机端界面](docs/screenshots/bitbet-mobile.png)

## 核心体验

- 5 分钟为一轮，展示当前价、轮次开盘价、方向、状态和倒计时。
- 最近 1 分钟行情图只优化展示层：原始高频 tick 仍供交易、Bot 与结算使用。
- 同一轮可多次下单，可同时持有看涨和看跌订单；每笔订单独立锁定当时价格与赔率。
- 快捷金额按本轮开始余额计算 10% / 25% / 50%，同时受当前可用余额限制；重复值与 0 值会被过滤。
- 最近结果支持领取可领取奖励；余额、订单与领取状态通过同一账本规则计算。
- 手机端使用紧凑的“行情 + 小图 + 下单面板 + Tabs”结构，重点适配 390×844、393×852 与 430×932。

## Bot Alpha 与 Bot Beta

两个 Bot 走完全独立的策略模块，但通过和真人相同的 `placeOrder`、赔率、资金扣减、结算与领取流程下单。

### Bot Alpha — Momentum

- 偏主动和激进，观察短时斜率、涨跌 tick 比、均价位置与动量变化。
- 信号明显时顺势下单，信号不足时 SKIP。
- 状态标签：`HOT`、`NORMAL`、`CAUTIOUS`。
- 短理由示例：`短线动量增强`、`趋势仍然有效`。
- 弱点是可能在趋势末端追涨或追跌。

### Bot Beta — Mean Reversion

- 更克制，关注短期累计涨跌、均值偏离、突然加速与动量衰减。
- 倾向等待冲高/急跌后的减速信号，强单边行情可能直接 SKIP。
- 状态标签：`WAITING`、`NORMAL`、`COOLDOWN`。
- 短理由示例：`价格偏离均值`、`动量开始衰减`。
- 弱点是可能过早猜顶或猜底。

### 公平性边界

- 策略上下文只包含决策时已经产生的本轮样本、当前价格、赔率、余额、历史战绩与订单状态。
- 不提供未来 tick、本轮最终 close 或 settlement result。
- Bot 订单进入真实订单账本，不直接改余额，不撤单，也不保证盈利或胜率。
- Bot 不固定在临近结算时下注；它们有独立等待时间、最晚入场时间、冷却与少量随机扰动。

## 周赛与状态提示

排行榜固定统计“你、Bot Alpha、Bot Beta”三位，并从真实订单与结算记录计算：

- 本周收益与收益率曲线
- 总资产、胜率、下注次数
- 最大连胜、最大连败、最大回撤
- Bot 实际观察到但未下单的 SKIP 次数

连胜、连败或排名变化只在状态首次变化时提示，页面刷新不会重复刷屏。

## 数据持久化说明

当前公开演示版主要使用浏览器本地存储保存玩家与 Bot 账本。因此：

- 关闭或重新打开同一浏览器，数据通常仍然保留。
- 清除站点数据、使用无痕窗口、更换浏览器或设备会得到另一份本地数据。
- Bot 是浏览器端模拟对手；页面关闭后不会在后台继续交易，重新打开后从已保存状态继续。
- 若需要跨设备、全天候后台 Bot 或多人共享榜单，应接入服务端数据库与定时任务。

## 技术结构

- React 19 + TypeScript
- Next.js 兼容路由 + Vinext/Vite
- Cloudflare/Sites 部署产物
- 领域模块位于 `lib/pulse5/`：行情、轮次、赔率、订单、结算、Bot 与统计彼此分离
- UI 位于 `components/pulse5/`
- Node 原生测试位于 `tests/`

主要目录：

```text
app/                         页面、全局样式与 API 路由
components/pulse5/           行情、下单、Bot、排行榜与移动端 Tabs
lib/pulse5/bots/             Alpha / Beta 策略与展示状态
lib/pulse5/engine/           统一交易引擎与账本视图
lib/pulse5/market/           实时行情与图表展示采样
lib/pulse5/orders/           下单规则
lib/pulse5/settlement/       结算与领取
lib/pulse5/stats/            周赛统计
tests/                       策略、公平性、交易、图表与统计测试
```

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm ci
npm run dev
```

默认开发地址为 `http://127.0.0.1:5173/`。

## 验证命令

```bash
npm run lint
npm test
```

`npm test` 会先完成生产构建，再串行运行策略、公平性、订单、赔率、持久化、图表和周赛统计测试。需要真实 CloudBase MySQL 连接的集成测试在未配置连接信息时会跳过。

## 部署

仓库包含 `.openai/hosting.json`，当前生产站点由 OpenAI Sites 托管。发布流程会构建并验证同一 Git commit，打包产物，保存 Site version 后再公开部署。

## 免责声明

本项目仅供交互设计、前端工程和模拟策略研究。所有资金、订单、收益与排行榜均为虚拟数据，不提供真实交易或投资服务。
