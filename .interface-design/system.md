# 假面采购界面系统

## Scope

- Surfaces: 在售商品、发现、链接专区、购买记录、资讯、设置、筛选、详情、商家画像和 AI 分析。
- Mode: 高频 Operate 工作台；Apple 极简、移动优先。
- Locked asset: 白底黑线 Logo。页头和 favicon 使用同一资产，不反色、不重绘。

## Foundations

- Color: `paper #f5f5f7` 画布，`white #fff` 实体内容，`ink #1d1d1f` 正文，`primary #0071e3` 操作，`destructive #ff3b30` 风险，`warning #ff9f0a` 临期，`success #34c759` 成功。
- Type: Apple 系统字体栈；SF Mono 回退用于价格、数量和时间。数字使用 tabular nums。
- Spacing: 4px 基础网格；卡片 8–12px，区块 16–24px。
- Radius: 控件 12px，商品卡 18px，弹窗 24px。嵌套圆角遵守外圆角 = 内圆角 + 内边距。
- Depth: 顶栏和底部导航可用毛玻璃；商品卡与面板保持实体白色。阴影仅表达层级。
- Motion: ENERGY 1 / RHYTHM 2 / MOTION 2。100–260ms，优先 transform / opacity；首屏少量卡入场，手势卡使用克制 spring；支持 reduced motion。
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
- `ProductCard`: 实体白卡、图片画廊、中文标题、真实来源、价格、邮费、数量和图标操作。
- `ImageGallery`: 左右控制拥有 64px 以上命中区，切图必须阻止卡片详情事件。
- `BottomWorkspaceNav`: 图标优先的玻璃底栏，活动状态为系统蓝。
- `AuctionCountdown`: 实时文字、进度条和临期警告色。

## Surface rules

- Inventory: 拍卖/直购 facets 来自完整查询条件下的全库统计；平台显示真实来源名。
- Discovery: 一屏完成判断，预载三张，动作持久化并可撤销；拍卖卡必须显示实时倒计时。
- AI: 首页只显示小按钮；打开弹窗不发请求；只有“开始分析 / 重新分析”触发接口。
- Seller: 日语砍价正文为主，中文只在下方充当小字翻译。
- Purchase: 钱币图标表达认证；凭证仅图片，解码后不超过 3MB。
- Translation: 中文完整表达标题、描述、成色、运费、配件和风险；原文切换随处可达。

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
