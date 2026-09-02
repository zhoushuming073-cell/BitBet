import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pulse5 · BTC 5分钟虚拟涨跌",
  description: "使用实时 BTC 行情和 10,000 USDT 虚拟资金体验 5 分钟涨跌预测。纯模拟，不连接钱包，不产生真实订单。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
