import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "假面采购",
  description: "日本特摄中古商品监控与采购决策后台",
  applicationName: "假面采购",
  icons: {
    icon: [{ url: "/brand-icon.svg?v=3", type: "image/svg+xml" }],
    shortcut: ["/brand-icon.svg?v=3"],
    apple: [{ url: "/brand-icon.svg?v=3", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f7",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <template
          dangerouslySetInnerHTML={{
            __html:
              "<!-- THESIS: 高频采购判断优先，拒绝把工作台做成宣传页。 OWN-WORLD: 白底黑线骑士标识、Apple 中性色、系统蓝和少量语义色，实体商品卡与克制玻璃导航。 STORY: 用户先看商品身份、价格和数量，再按需展开 AI、筛选和详情。 FIRST VIEWPORT: 顶栏只保留品牌与全局操作，首页首个内容操作是紧凑 AI 按钮，商品库紧随其后；手机由独立双列卡片和底部导航组成。 FORM: 用户明确指定的 Apple 极简采购工作台，方向键 pinned-apple-procurement-20260829。 FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->",
          }}
        />
        {children}
      </body>
    </html>
  );
}
