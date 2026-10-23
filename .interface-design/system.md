# 假面采购界面系统

## Scope

- Surfaces: 首页、发现、AI、管理者消息、工作台、链接专区、购买记录、资讯、设置、筛选、详情和商家画像。
- Mode: 高频 Operate 工作台；Apple 极简、移动优先。
- Locked asset: 白底黑线 Logo。页头和 favicon 使用同一资产，不反色、不重绘。

## Foundations

- Color: `paper #f5f5f7` 画布，`white #fff` 实体内容，`ink #1d1d1f` 正文，`primary #0071e3` 操作，`destructive #ff3b30` 风险，`warning #ff9f0a` 临期，`success #34c759` 成功。
- Type: Apple 系统字体栈；SF Mono 回退用于价格、数量和时间。数字使用 tabular nums。
- Spacing: 4px 基础网格；卡片 8–12px，区块 16–24px。
- Radius: 控件 12px，商品卡 18px，弹窗 24px。嵌套圆角遵守外圆角 = 内圆角 + 内边距。
- Depth: 采用 `globals.css` 中已整合的浅色玻璃材质；正文与商品必须清晰，后置发现卡不透出重复文字。阴影仅表达层级。
- Motion: ENERGY 3 / RHYTHM 3 / MOTION 3。100–320ms，优先 transform / opacity；强化 Apple 空间层次、液态玻璃材质、动态背景和明确触控反馈；动效只解释来源、导航和状态，手势使用可中断、有重量感但不夸张的 spring，并支持 reduced motion。
- Touch: 控件至少 44×44px，固定导航预留安全区。

## Responsive composition

- Desktop: 多列紧凑商品网格；表格保留完整比较能力。
- Mobile: 独立重排，不缩小桌面。商品库双列精简卡；购买记录和宽表转换为卡片或优先列；完整描述延后到详情。
- Priority: 图片、商品身份、价格、数量、采购价值。
- Deferred: 长描述、重复标签、卖家次级元数据和装饰信息。
- Validation: 320px、390px、短屏与 1440px 均无意外横向溢出；发现页操作区不能被底部导航遮挡。

## Shared primitives

- `IconButton`: 44px 命中区和明确 accessible name。
- `Dialog`: fixed overlay、视口居中、约 82dvh 最大高度、关闭/Escape/背景退出。
- `ProductCard`: 现有浅色材料、图片画廊、中文标题、真实来源、价格、邮费、数量和图标操作；成本口径由 `listing-cost.ts` 统一。
- `ImageGallery`: 左右控制拥有 64px 以上命中区，切图必须阻止卡片详情事件。
- `BottomWorkspaceNav`: 图标优先的玻璃底栏，活动状态为系统蓝。
- `AuctionCountdown`: 实时文字、进度条和临期警告色。
- `ManagerAccountGate`: 首次进入居中选择两位固定管理者；这是身份选择，不伪装成密码登录，不提供注册。
- `CollaborationMessage`: 自己靠右、对方靠左；可承载文字、回复、商品引用、转发关系、互动和已读状态。

## Surface rules

- Inventory: 拍卖/直购 facets 来自完整查询条件下的全库统计；平台显示真实来源名。
- Discovery: 一屏完成判断，预载三张，动作持久化并可撤销；拍卖卡必须显示实时倒计时。
- AI: 首页只显示小按钮；打开弹窗不发请求；只有“开始分析 / 重新分析”触发接口。
- Seller: 日语砍价正文为主，中文只在下方充当小字翻译。
- Purchase: 钱币图标表达认证；凭证仅图片，解码后不超过 3MB。
- Translation: 中文完整表达标题、描述、成色、运费、配件和风险；原文切换随处可达。
- Collaboration: 一级底栏为首页、发现、AI、消息、工作台；个人主页由页头头像进入。消息和互动写入 PostgreSQL，商品引用保留最小决策信息。

## Accessibility

- 图标按钮必须有 accessible name 与 focus-visible。
- 弹窗使用 dialog、aria-modal 和标题关系；加载、错误、空状态可读。
- 状态不能只靠颜色；倒计时进度提供 progressbar 语义。
- 页面滚动和商品手势分离；键盘操作与可见按钮等价。

## Route-outs

- `responsive-design` / `mobile-design`: 窄屏重排、触控、安全区和真实设备尺寸。
- `interaction-design`: 弹窗、卡片和状态反馈。
- `impeccable`: 最终视觉检测与精修。
- `tanstack-table`: 海量资讯的桌面数据表格；手机转卡片。

## 2026-10-09 当前整站基准

用户已指定恢复此前 Apple 色彩与画风，并扩大重要交互动效覆盖。当前方向以本节与 docs/UI_MOTION_RULES.md 为准。

- ENERGY 3 / RHYTHM 3 / MOTION 3。恢复旧版浅蓝/薄荷静态 daylight 背景，#1d1d1f 正文、#58616c 辅助、#0071e3 操作；白色阅读面与局部磨砂导航。背景材质用于区分固定操作层和商品阅读层，不做持续背景动画。
- 4 / 8 / 12 / 16 / 24 / 32 / 48px 节奏；控件14px圆角、商品/工作面18–24px；台账与目录继续用稳定行列组织，阴影表示具体层级。
- 24–32px页面标题、18–20px区块、14–16px正文、12–13px辅助。数值tabular，金额与状态不无提示截断。
- 桌面顶部四个主导航；手机底部64px安全区。工作台选货→采购→售卖，闲鱼常驻商品+任务抽屉及共享商品上下文。
- 重要操作即时响应；按压100–140ms，局部反馈140–220ms，空间转换260–420ms或可重定向的 Apple spring。导航、商品选择、抽屉、图片和展开有独立反馈；同元素一个动画所有者，价格/输入/长表保持稳定。
- 六类滚动模式按适用内容选择；减少动效、键盘、短屏与长列表具有同等功能。工作区短转场结束或取消后清除transform，固定工具栏和吸顶不受影响。
- Canonical共享层为 apps/web/src/styles/simple-apple.css，各工作区结构与业务事件由本地组件负责。

第二轮共享原语：AmbientMotionState 统一输入方式和局部触点反馈；AppleActionRail 以单个表面跟随操作行；导航稳定选择轨与初始位置保持单一所有权。图片、表单、抽屉、消息仍由各业务状态所有者负责。失败保草稿、同步提交去重、键盘即时、reduce 等价和关闭回焦是交付条件。
