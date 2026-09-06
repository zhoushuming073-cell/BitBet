# BitBet 本地运行

行情仍然通过网络连接 Binance 公共接口，下注、余额和战绩只保存在当前浏览器中，不会产生真实订单。

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
- 网络需要能够访问 Binance 公共 REST 与 WebSocket 行情接口。
- 虚拟余额和记录保存在浏览器 `localStorage`，清理浏览器网站数据后会重置。
