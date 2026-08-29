import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "假面采购",
  description: "日本特摄中古商品监控与采购决策后台",
  applicationName: "假面采购",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
