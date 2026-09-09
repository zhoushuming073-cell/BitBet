# BitBet 本地运行

行情主要通过网络连接 Binance BTC/USDT 公共接口，并在 Binance 受地区限制时使用 Kraken 公共行情降级；本地预览使用开发账户，线上账户、下注、余额和战绩由 Sites 服务端保存，不会产生真实交易所订单。

游戏由在线页面每约 1.5 秒调用 `/api/game/tick` 推进；关闭页面后 Bot 停止运行，不补算离线期间的虚拟订单。Lambda 的学习只在其真实参赛订单正式结算后发生。

## Windows 一键启动

1. 安装 [Node.js 22 LTS](https://nodejs.org/)。
2. 把整个 `bitbet` 文件夹放到桌面。
3. 双击 `start-bitbet.bat`。
4. 首次启动会自动下载依赖，完成后浏览器会打开 `http://127.0.0.1:5173`。

关闭黑色命令窗口即可停止网页。以后再次运行，直接双击 `start-bitbet.bat`。

## 命令行启动

在 `bitbet` 文件夹中执行：

```bash
npm ci
npm run dev
```

然后打开：<http://127.0.0.1:5173>

## 网络说明

- 必须联网才能获取 BTC 实时价格。
- 网络需要能够访问 Binance 或 Kraken 的公共 REST / WebSocket 行情接口。
- 线上虚拟余额和记录保存在 Sites 服务端 D1 账本，不依赖浏览器 `localStorage`。
