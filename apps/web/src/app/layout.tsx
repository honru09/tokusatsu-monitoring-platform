import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "特摄采购情报台",
  description: "日本特摄中古商品监控与采购决策后台",
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
