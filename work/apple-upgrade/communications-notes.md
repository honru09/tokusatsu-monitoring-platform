# 导航、工作台与通讯：Apple 材质与动效验收

## 实现

- 主导航保持四个入口和同一选中轨。指针选择使用 Apple spring，可打断；键盘选择在 layout effect 即时设置。图标只有按钮参与键盘焦点；SSR 与首次客户端渲染使用相同样式。
- 工作区真实导航才播放 420ms WAAPI 过渡。首次 URL 同步、键盘和 reduced motion 即时。快速导航取消旧动画；完成后不保留父 transform。消息和运营窗口只淡入。
- 工作台保持选货、采购、售卖共 12 个业务入口及四个系统入口。分组使用近白玻璃材质、蓝色强调和 18–22px 圆角；有限 18px 区块入场最多错开 90ms，结束 transform:none。
- 消息、助手、AI 状态、个人和运营窗口统一材质与字号层次。主要操作蓝色，阅读区近白，内容和卡片不叠加 blur。手机表单保留 44px 操作目标及 16px 输入字。
- 消息工具条采用指针 spring，键盘即时；手机横向定位由左右边距完成。终点显式 scale(1)，避免 Motion 对 complex transform → none 的 scale(0) 插值问题。
- 协作消息外层只淡入，不建立 fixed 工具条的 transform 祖先。历史消息不播放入场；助手只对新答案播放短距离入场。

## 保留的连接

- 协作草稿、消息滚动阅读位置、发送去重、回复与转发、反应失败回滚、砍价、已读轮询。
- 助手主动调用、请求去重、旧消息阅读时新答案不拉到底、存储失败不丢当前会话。
- AI 状态与三用途入口使用原有无刷新导航，按原有真实预算口径显示。
- 个人页 roving keyboard tabs，运营 iframe 首次懒加载、隐藏后返回保持同一实例。
- 工作区 URL、返回历史、700px 滚动恢复和现有持久草稿不变。

## 证据

- TypeScript noEmit 通过。
- 通讯五组件 15 项测试与主导航四项测试通过。
- 本轮通讯浏览器覆盖 1440×960、390×844、320×568，各 normal/reduce，共 30 页面；五工作区全部通过，没有溢出、小操作目标、pageerror 或自动模型调用。报告中以上六组为本轮更新，其余尺寸沿用上一轮，不作为本轮视觉证据。
- 新导航闭环验收覆盖 1440×1000 normal、390×844 normal/reduce：初始化不动画、快速取消、协作草稿、700px 恢复、键盘即时、iframe 同实例和父 transform 清除均通过。
- 闲鱼与导航 SSR 修复后重新运行导航三组闭环：pageerror 与 console hydration errors 均为零。另以 320×568 normal/reduce 独立首载 AI 状态页复核，console.error 为零；reduce 只有 Motion 的偏好说明 warning。
- 人工读取了工作台 1440/390、AI 1440/320、助手 390、个人 320 的本轮截图。

报告：`navigation-communications/report.json` 与 `../editorial-upgrade/communications/report.json`。
