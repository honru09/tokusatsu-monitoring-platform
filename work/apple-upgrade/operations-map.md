# Apple 工具组改版

## 源码范围

五个工具工作区 TSX、operations-editorial.module.css、monitoring-config.css。没有修改 API、存储、模型配额、发布、采购或其他工作区源码。

## 材质与交互

- 复用 ui-surface、ui-shadow、ui-line、ui-accent、glass-ink-secondary；22px分组面，14–20px局部控件；蓝色重点操作和实体白色阅读面。
- 库存/计算/资讯指示器及监控分类选择使用 appleSelection；详情/对话框/物流展开/计算切换使用 appleSpatial。
- 新记录只给前4条最多105ms轻量入场，同一ID刷新不重播；不对长表全部添加延迟或layout动画。
- 键盘事件即时切换，reduced motion保留状态并取消位移；触控没有hover运动；金额和表单输入保持稳定。
- 物流勾选与展开可快速反转；计算器切换保留草稿；复制完成采用局部颜色/文字反馈。
- 原calculator-layout CSS入场被关闭，避免覆盖Motion键盘即时状态；<600px监控分类单列，避免文字挤窄。

## 验证

- 最终tsc通过；原有四套组件测试36/36通过。
- operations-browser/verification.json：43项通过，320/390/768/1280/1440、390短屏、手机/桌面reduce、空与错误状态；无文档溢出、pageerror或小于44px目标。
- operations-motion.json：12项通过，键盘零位移、输入稳定、快速模式/展开/分类反转、草稿保留、即时对话框。
- monitor-mobile/verification.json：最后分类单列修正后320/390定向2项通过，已查看390截图。

所有浏览器写入、模型和GET分析均被隔离或拦截。没有实发消息、模型调用、发布、采购或付款。手机检查是Chrome视口，没有实体iPhone/Safari验收。
