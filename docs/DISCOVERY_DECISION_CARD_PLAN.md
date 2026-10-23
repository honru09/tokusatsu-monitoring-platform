# 发现决策卡实施方案

## 目标与顺序

- 先验收中断前的上线、导入、AI 与既有交互；通过后再改发现卡。
- 受众是需要高频筛选日本线上中古特摄商品的中文采购者。
- 页面唯一任务：两秒内看懂“是什么、总成本、批量价值、是否值得继续看”，随后收藏、不感兴趣或进入详情。

## 组件与数据边界

```text
DiscoveryWorkspace (Client Component)
├─ DiscoveryModeSwitch
├─ DiscoveryDeck
│  ├─ BackCard × 2 (inert preview)
│  └─ SwipeCard
│     ├─ DiscoveryMedia (ImageGallery + source/image count/countdown)
│     └─ DiscoveryDecisionBody
│        ├─ ProductIdentity
│        ├─ CostSummary (total / quantity / unit price)
│        ├─ MarketOpportunity
│        └─ SourceAndCardTools (time / note / language)
└─ DiscoveryActions (dislike / detail / favorite / undo)
```

- 继续使用现有 `/discovery`、`/discovery/feedback`、`/discovery/undo` 和备注接口，不新增平行状态仓库。
- 市场机会只来自已验证的中国比价或现有确定性采购事实；不恢复匹配分、置信度或 AI 评分。
- 商品标题、图片、交易类型、数量、价格、来源和时间继续使用真实入库数据；不放示例数据。

## 信息层级

1. 图片与商品身份。
2. 数量。
3. 含已知邮费总价。
4. 含已知邮费单价。
5. 有证据的市场机会。
6. 来源与时间。

卡片最多展示三个辅助标签。卖家编号、完整描述、内部来源数等延后到详情。

## 响应式与触控

- 手机：发现页独立占满可用 `dvh`，不缩小桌面布局；隐藏重复页头文字，只保留交易方式切换、全高卡堆、动作区和底部一级导航。
- 短屏：压缩间距并延后辅助标签，保留图片、标题、总价、数量、单价与动作区。
- 桌面：卡片保持横向媒体/决策双栏，宽高固定在稳定范围内；底部导航轨不遮挡动作。
- 所有可见操作保持至少 44×44px，图片切换控件继续阻止卡片详情点击。

## 动效编排

- 继续使用项目 `motion/react` 与现有 motion tokens。
- 拖动只改变 `transform`/`opacity`；未达阈值使用 release spring 回中。
- 卡片离场后，后卡沿既有堆叠位移与缩放进入主位；不新增装饰性入场动画。
- 卡堆容器允许卡片横向离场，页面外层负责裁切，避免“左右被墙挡住”的观感。
- `prefers-reduced-motion` 下禁用位移，仅保留短淡出。

## 安全与验收

- 不引入 HTML 注入、原始 URL 拼接或新的用户输入通道。
- 验收尺寸：320×568、375×812、390×844、844×390、1280×800、1440×900。
- 验证键盘、滑动、点击详情、备注弹窗、翻译切换、图片切换、收藏、不感兴趣确认和撤销。
