---
name: 假面采购
description: 参考移动政务应用视觉语言的渐变式日本特摄中古商品采购工作台
colors:
  primary: "#0071e3"
  secondary: "#2997ff"
  accent: "#64d2ff"
  ink: "#1d1d1f"
  paper: "#f5f5f7"
  fog: "#e8e8ed"
  white: "#ffffff"
  success: "#34c759"
  warning: "#ff9f0a"
  destructive: "#ff3b30"
  focus-ring: "rgba(10, 132, 255, 0.25)"
  chrome-shadow: "rgba(0, 0, 0, 0.16)"
  app-sky: "#b8daf0"
  app-sky-soft: "#d9eaf4"
  app-lilac: "#e9e0f4"
  app-mint: "#dcefe3"
  app-header: "rgba(187, 219, 240, 0.72)"
  app-ink-50: "rgba(7, 8, 10, 0.50)"
  app-ink-42: "rgba(7, 8, 10, 0.42)"
  app-ink-32: "rgba(7, 8, 10, 0.32)"
  app-ink-10: "rgba(7, 8, 10, 0.10)"
  app-ink-09: "rgba(7, 8, 10, 0.09)"
  app-ink-07: "rgba(7, 8, 10, 0.07)"
  error-text: "#8b1d18"
  card-shadow: "rgba(25, 45, 63, 0.07)"
  surface-shadow: "rgba(32, 53, 72, 0.055)"
typography:
  ui: "-apple-system, BlinkMacSystemFont, SF Pro Text, Noto Sans SC, sans-serif"
  display: "-apple-system, BlinkMacSystemFont, SF Pro Display, Noto Sans SC, sans-serif"
  data: "SFMono-Regular, SF Mono, Consolas, monospace"
rounded:
  compact: "8px"
  control: "12px"
  mobile-card: "14px"
  card: "18px"
  dialog: "24px"
  icon: "16px"
  panel: "20px"
  dock: "32px"
  bubble-tail: "2px"
  pill: "999px"
interaction:
  minimumTarget: "44px"
  feedbackDuration: "100-260ms"
---

# 假面采购设计系统

## 方向

界面采用用户参考图的视觉世界：大尺度低对比浅蓝—薄荷—淡紫流动渐变、黑色大标题、白色圆角内容岛、极简黑白线性图标和高对比黑色导航。它只替换表现层，不复制参考图的业务文字或功能。系统仍是高频采购工具，不是娱乐化商城，也不借用任何第三方品牌身份。

现有白底黑线假面骑士 Logo 是锁定资产。浏览器图标、页头标志保持同一图形，不反色、不加黑底、不重新绘制。

## 信息层级

- 列表与发现页优先：图片、中文商品身份、价格、数量、真实平台、采购价值。
- 拍卖商品必须显示倒计时；直购与拍卖在入库时区分，统计来自全库 facets。
- 运费、品相、卖家和完整描述进入次级层；完整信息在详情弹窗展开。
- 中文为默认阅读语言，原文切换始终可达；AI 翻译需要保留完整语义，而非关键词替换。
- 不显示评分、匹配度或不可验证的置信度。

## 色彩与字体

- `#0071e3`：业务操作、活动状态和焦点，不用于主导航底色。
- `#1d1d1f`：正文、标题与深色操作状态。
- `#b8daf0`、`#d9eaf4`、`#e9e0f4`、`#dcefe3`：页面背景的低对比流动渐变；`#ffffff`：卡片和内容面板。
- `#ff3b30`：错误、不感兴趣和真实危险；`#ff9f0a`：临近结束；`#34c759`：成功。
- 文本使用 Apple 系统字体栈；价格、数量、时间和倒计时使用 SF Mono 回退并启用 tabular numerals。

## 桌面与手机

桌面端保持高密度多列采购工作台。手机端必须独立重排，不把桌面缩小：商品库使用双列精简卡，购买表格转换为卡片，详情和设置使用居中小窗或可滚动内容层，固定底部导航预留安全区。

手机优先保留图片、价格、数量、商品身份和采购价值；隐藏重复标签、长描述和次级元数据。发现页一屏完成判断，页面滚动不能误触拖拽，底部操作区不得被固定导航遮挡。所有触控目标至少 44×44px；320px、390px 与短屏必须无意外横向溢出。

## 组件

- 商品卡：18px 圆角、实体白底、轻阴影；图片画廊箭头拥有扩大命中区，切图不打开详情。
- 居中弹窗：固定覆盖视口，最大高度约 82dvh，背景点击、关闭按钮和 Escape 可退出。
- AI 分析：主页仅保留小按钮；打开窗口不调用接口，用户点“开始分析”后才请求。
- 底部导航：黑色实体背景、五个图标入口，活动图标使用白色实心方块；手机端贴底全宽，桌面端保持居中悬浮的稳定底部导航轨，禁止改为左侧纵向导航。
- 发现卡堆：预载三张；顶部卡使用克制 spring、惯性和阈值反馈；动作持久化并支持撤销。
- 凭证：圆形钱币图标表达认证状态；图片上限为解码后 3MB。

## 动效

常规反馈为 100–260ms，只优先改变 transform、opacity 与必要的阴影。卡片只对首屏少量内容做轻微入场，不能让未动画内容短暂消失。弹窗使用克制的缩放与回抽；所有动效尊重 `prefers-reduced-motion`。

## 禁止项

- 不重新设计或反色 Logo。
- 不使用高对比装饰渐变、扫描线、夸张动效或大面积毛玻璃；背景渐变必须保持低对比并服务于参考视觉。
- 不用泛称替代 Mercari、Yahoo!オークション、Mandarake 等真实平台。
- 不把完整详情塞进列表卡，不让固定导航遮挡操作。
- 不收录书籍、杂志、漫画或卡片类商品。
