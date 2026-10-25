import type { Metadata, Viewport } from "next";
import "./globals.css";
import "../styles/procurement-glass.css";
import "../styles/apple-refinement.css";
import { AmbientMotionState } from "../components/ambient-motion-state";
import { MobileViewportState } from "../components/mobile-viewport-state";
import { PushServiceWorker } from "../components/push-service-worker";
import "../styles/mobile-chrome.css";
import "../styles/persistent-chat.css";
import "../styles/apple-polish.css";
import "../styles/simple-apple.css";

export const metadata: Metadata = {
  title: "假面采购",
  description: "日本特摄中古商品监控与采购决策后台",
  applicationName: "假面采购",
  manifest: "/manifest.webmanifest?v=2",
  icons: {
    icon: [
      { url: "/favicon-32x32.png?v=2", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png?v=2", type: "image/png", sizes: "192x192" },
      { url: "/brand-icon.svg?v=5", type: "image/svg+xml" },
    ],
    shortcut: ["/favicon-32x32.png?v=2"],
    apple: [
      {
        url: "/apple-touch-icon.png?v=2",
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "假面采购",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f7",
  colorScheme: "light",
  viewportFit: "cover",
  interactiveWidget: "resizes-visual",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AmbientMotionState />
        <MobileViewportState />
        <PushServiceWorker />
        <template
          dangerouslySetInnerHTML={{
            __html:
              "<!-- THESIS: 高频采购判断优先，拒绝把工作台做成宣传页或指标卡拼盘。 OWN-WORLD: 锁定白底黑线骑士标识、Apple 中性色、系统蓝、实体商品卡与克制液态玻璃导航。 STORY: 用户先从真实全库态势进入类别或交易方式，再用商品决策卡完成收藏、忽略、采购与追踪。 FIRST VIEWPORT: 顶栏只保留品牌和全局操作，首页以七日发现、交易结构、来源与动态分类组成一幅数据总览，AI 按需弹出，商品库紧随其后；手机独立重排为纵向总览、双列卡片与底部导航。 FORM: 用户明确指定的 Apple 极简采购工作台，方向键 pinned-apple-procurement-20260905。 FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->",
          }}
        />
        {children}
      </body>
    </html>
  );
}
