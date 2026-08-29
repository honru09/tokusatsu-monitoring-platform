---
name: 采购中心
description: 面向日本特摄中古商品采购的高密度情报工作台
colors:
  procurement-blue: "#1e40af"
  signal-blue: "#3b82f6"
  procurement-orange: "#d97706"
  ink: "#0f172a"
  paper: "#f8fafc"
  fog: "#e9eef6"
  border-blue: "#dbeafe"
  white: "#ffffff"
  destructive: "#dc2626"
typography:
  headline:
    fontFamily: "Fira Code, Noto Sans SC, monospace"
    fontSize: "1.25rem"
    fontWeight: 900
    lineHeight: 1.4
  title:
    fontFamily: "Fira Code, Noto Sans SC, monospace"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Fira Sans, Noto Sans SC, Hiragino Sans, Yu Gothic UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Fira Sans, Noto Sans SC, Hiragino Sans, Yu Gothic UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.4
  data:
    fontFamily: "Fira Code, SFMono-Regular, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.4
rounded:
  md: "8px"
  lg: "12px"
  panel: "16px"
  product-card: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.procurement-blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
    typography: "{typography.label}"
  button-accent:
    backgroundColor: "{colors.procurement-orange}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "44px"
    typography: "{typography.label}"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
    typography: "{typography.body}"
  panel:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "16px"
  product-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.product-card}"
---

# Design System: 采购中心

## Overview

**Creative North Star: "采购情报台"**

采购中心的界面像一个持续运转的专业采购情报台：冷静、清晰、有足够的信息密度，同时把价格、风险、采购价值和下一步操作放在最容易扫描的位置。它不是面向消费者的商店陈列，也不是娱乐化的卡片应用；真实商品图片与可核验数据始终是视觉主体。

深蓝提供操作与可信度锚点，近白底色让长时间浏览保持轻盈，采购橙只用于价格、机会和关键提示。动效解释状态与空间连续性，手势具有惯性和阻尼，但不借用 Tinder 的品牌语言、色彩或夸张反馈。

**Key Characteristics:**

- 高密度但可扫描的采购工作台
- 深蓝、近白与采购橙组成的克制功能色体系
- Fira Sans 负责正文，Fira Code 负责标题与数据
- 真实商品图片优先，状态、分数与价格紧随其后
- 触摸、鼠标、键盘与明确按钮等价可达

## Colors

冷静蓝色负责结构和行动，暖橙色只标记采购机会；近白与墨色承担大部分阅读面积。

### Primary

- **采购深蓝**：主要按钮、活动导航、焦点与进度。它是系统可信度和操作性的主锚点。
- **信号蓝**：只用于深蓝的浅层背景、边界和低强调状态，不与采购橙争夺注意力。

### Secondary

- **采购橙**：价格、机会、快捷导入和关键数据提示。它应保持稀缺，避免整块铺满大面积界面。

### Neutral

- **墨色**：标题、正文和深色工作区背景。
- **纸白**：页面底色，带极弱蓝橙环境光，而非纯白空白画布。
- **雾灰**：统计条、图片占位和低层级分组背景。
- **边界蓝**：面板、筛选和导航的轻描边。
- **警戒红**：删除、失败、紧急拍卖和不感兴趣反馈。

**The Opportunity Accent Rule.** 采购橙只表达机会、价格或关键采购提示；普通结构与导航不得滥用它。

**The Functional Red Rule.** 红色只用于错误、破坏性操作和真实紧迫状态，不能作为装饰色。

## Typography

**Display Font:** Fira Code（Noto Sans SC 与 monospace 后备）
**Body Font:** Fira Sans（Noto Sans SC、Hiragino Sans 与 Yu Gothic UI 后备）
**Label/Mono Font:** Fira Code（SFMono-Regular 与 Consolas 后备）

**Character:** Fira Sans 保证中文采购信息的连续阅读，Fira Code 为标题、数字、倒计时和分数提供仪表感。粗体用于行动与结论，不用于整段正文。

### Hierarchy

- **Headline**（900，1.25rem，1.4）：一级工作区标题与关键结论。
- **Title**（700，1rem，1.4）：商品名、分组和卡片标题。
- **Body**（400，0.875rem，1.5）：说明、描述和详情正文。
- **Label**（700，0.75rem，1.4）：按钮、标签与短状态。
- **Data**（700，0.75rem，1.4）：价格、数量、倒计时、页码和推荐分。

**The Data Has a Voice Rule.** 可比较数字使用等宽字；长商品名和解释文本保持无衬线，避免整页变成代码终端。

## Layout

桌面端使用高密度工作区：顶栏建立身份与运行状态，一级导航紧随其后，主要内容由 16px 圆角白色面板承载。商品库在宽屏形成多列紧凑卡片；发现页把单个决策卡放在居中、限宽的堆栈中，后两张卡只提供位置连续性。

间距以 4、8、12、16、24 和 48px 递进。44px 是关键控件的最低交互高度。移动端不压缩中文标签为逐字换行；一级导航改为横向滚动，操作按钮重排成两列，输入字号保持至少 16px 以避免浏览器缩放。

**The Scan Before Scroll Rule.** 首屏优先显示当前工作区、数量、状态和可执行动作；完整商品详情进入抽屉或详情层，而不是塞入列表卡片。

## Elevation & Depth

系统以轻描边和色块分层为主，阴影只帮助浮层、卡片和拖拽对象与背景分离。常驻面板使用低扩散环境阴影；模态框和顶部发现卡使用更深阴影。拖拽中的重量来自 spring、位移与阴影变化，而不是旋转或弹跳表演。

### Shadow Vocabulary

- **Panel** (`0 8px 28px rgba(15, 23, 42, .08)`)：导航、常驻面板和商品卡。
- **Modal** (`0 24px 70px rgba(15, 23, 42, .22)`)：详情、筛选浮层和当前可拖拽卡。

**The Flat-Until-Lifted Rule.** 常驻内容保持低层级；只有正在交互、覆盖上下文或需要明确前后关系的对象获得显著阴影。

## Shapes

控件使用 8px 圆角，紧凑分组使用 12px，主要面板与浮层使用 16px；商品卡使用 18px，形成比表单略柔和的内容容器。细蓝灰描边定义边界，虚线只用于加载、空状态和上传入口。圆形只用于小型状态或数量标记，不作为主要容器语言。

## Components

### Buttons

- **Shape:** 轻度圆角（8px），关键操作至少 44px 高。
- **Primary:** 采购深蓝底、白字、加粗；hover 加深为蓝色，不改变尺寸。
- **Accent:** 采购橙底、墨色字，只用于采购机会和链接导入等高价值动作。
- **Secondary:** 白底、轻描边；hover 改变浅色背景或边界颜色。
- **Destructive:** 红色文字或红底白字，必须对应真实删除、失败或否定动作。
- **Focus:** 3px 半透明深蓝外轮廓，偏移 2px；禁用态降低透明度并使用禁止光标。

### Chips

- **Style:** 紧凑、数据化，使用浅雾灰或采购橙底色；短标签不换行。
- **State:** 已选筛选项和采购机会可增强对比，普通元数据保持低强调。

### Cards / Containers

- **Corner Style:** 面板 16px，商品卡 18px。
- **Background:** 白色主体，雾灰用于内部统计条。
- **Shadow Strategy:** 常驻卡使用 Panel 阴影；只有模态和当前拖拽卡使用 Modal 阴影。
- **Border:** 轻蓝或低透明墨色 1px 描边。
- **Internal Padding:** 紧凑卡 8–12px，工作区面板 16px。

### Inputs / Fields

- **Style:** 白底、8–12px 圆角、轻墨色描边，常规高度 44px。
- **Focus:** 使用全局深蓝焦点轮廓，不依靠颜色变化作为唯一提示。
- **Error / Disabled:** 错误使用警戒红并配合文字；禁用态保持稳定尺寸并降低透明度。

### Navigation

一级导航是白色圆角面板中的紧凑标签。活动项使用墨色底与采购橙文字；非活动项用墨色文字和浅蓝 hover。移动端保持标签完整，通过横向滚动访问超出项。

### Discovery Card Stack

顶部卡可拖拽，后两张仅通过 scale、translateY 和 opacity 表达自然堆叠。左、右、下反馈随距离增强，只有距离与速度的组合阈值达到后才提交；未达到阈值时用 release spring 回到中心。所有动作必须先持久化再移除卡片，并提供撤销。

## Do's and Don'ts

### Do:

- **Do** 优先展示真实商品图片、名称、价格、来源和采购价值。
- **Do** 保持中文默认展示，同时提供原文切换。
- **Do** 为加载、失败、空状态、禁用和撤销提供明确反馈。
- **Do** 同时支持触摸、鼠标、键盘与可见按钮，并尊重减少动态效果设置。
- **Do** 用 spring、transform 和 opacity 表达直接操控的重量与连续性。

### Don't:

- **Don't** 使用 Tinder 的品牌、配色、图标或视觉身份包装发现页。
- **Don't** 用采购橙装饰普通容器，或用警戒红制造虚假紧迫感。
- **Don't** 把完整详情塞进列表或发现卡片。
- **Don't** 让动效阻塞输入、只支持鼠标，或把前端动画当成已保存结果。
- **Don't** 收录书籍、杂志、漫画或卡片类商品。
