import type { Metadata } from "next";
import "./globals.css";

// Preview environment marker consumed by tests / hosting tooling. CI builds
// (GITHUB_ACTIONS set) report "production"; every local or preview run is
// "development". Evaluated per SSR render, not frozen at build time.
const previewMode = process.env.GITHUB_ACTIONS ? "production" : "development";

export const metadata: Metadata = {
  title: "BTC 5分钟涨跌竞猜",
  description: "根据实时 BTC 行情预测 5 分钟后的价格方向。使用虚拟资金体验，不涉及真实交易。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  other: {
    "codex-preview": previewMode,
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
