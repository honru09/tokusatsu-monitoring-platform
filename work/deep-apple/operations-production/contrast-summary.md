# 生产界面对比度抽样

入口：http://localhost:3000

只测共享页头、导航、新库存回执、AI 读取入口与标题。文本颜色来自实际 computed style；透明度累计包含祖先。背景使用当前浏览器 PNG 在记录位置的空白区域采样，保留白色、浅蓝及半透明材质真实合成效果。每条数据含选择器、位置、computed 材质、截图与计算结果，见 contrast.json。此摘要不代表全站所有像素或全部交互状态。

普通文字目标 4.5 : 1；24px 普通文字或 18.66px/700 粗体目标 3 : 1。

| 元素 | 宽度 / motion | computed 前景 | rendered 背景 | 最低对比度 | 结果 |
| --- | --- | --- | --- | --- | --- |
| Header brand | 1440 / no-preference | rgb(29, 29, 31) | rgb(249,252,255) · rgb(249,252,255) · rgb(249,252,255) | 16.35 : 1 | PASS |
| Header exchange rate | 1440 / no-preference | rgb(88, 97, 108) | rgb(249,252,255) · rgb(249,252,255) · rgb(249,252,255) | 6.10 : 1 | PASS |
| Nav home | 1440 / no-preference | rgb(99, 102, 109) | rgb(252,254,255) · rgb(252,254,255) · rgb(252,254,255) | 5.68 : 1 | PASS |
| Nav AI | 1440 / no-preference | rgb(99, 102, 109) | rgb(252,254,255) · rgb(252,254,255) · rgb(252,254,255) | 5.68 : 1 | PASS |
| Nav messages | 1440 / no-preference | rgb(99, 102, 109) | rgb(251,254,255) · rgb(251,254,255) · rgb(251,254,255) | 5.67 : 1 | PASS |
| Nav active workbench | 1440 / no-preference | rgb(0, 102, 204) | rgb(236,245,255) · rgb(235,245,255) · rgb(234,244,255) | 5.00 : 1 | PASS |
| Inventory success receipt | 1440 / no-preference | rgb(35, 99, 66) | rgb(232,244,238) · rgb(232,244,237) · rgb(231,243,238) | 6.29 : 1 | PASS |
| AI product entry on focused pale blue | 1440 / no-preference | rgb(0, 102, 204) | rgb(241,247,255) · rgb(241,247,255) · rgb(241,247,255) | 5.17 : 1 | PASS |
| AI purpose heading | 1440 / no-preference | rgb(29, 29, 31) | rgb(241,247,255) · rgb(241,247,255) · rgb(241,247,255) | 15.62 : 1 | PASS |
| Header brand | 390 / no-preference | rgb(29, 29, 31) | rgb(249,252,255) · rgb(249,252,255) · rgb(249,252,255) | 16.35 : 1 | PASS |
| Header exchange rate | 390 / no-preference | rgb(88, 97, 108) | rgb(249,252,255) · rgb(249,252,255) · rgb(249,252,255) | 6.10 : 1 | PASS |
| Nav home | 390 / no-preference | rgb(99, 102, 109) | rgb(253,254,254) · rgb(253,254,254) · rgb(253,254,254) | 5.69 : 1 | PASS |
| Nav AI | 390 / no-preference | rgb(99, 102, 109) | rgb(254,254,254) · rgb(254,254,254) · rgb(254,254,254) | 5.70 : 1 | PASS |
| Nav messages | 390 / no-preference | rgb(99, 102, 109) | rgb(254,254,254) · rgb(254,254,254) · rgb(254,254,254) | 5.70 : 1 | PASS |
| Nav active workbench | 390 / no-preference | rgb(0, 102, 204) | rgb(237,245,255) · rgb(235,244,255) · rgb(234,243,255) | 4.97 : 1 | PASS |
| Inventory success receipt | 390 / no-preference | rgb(35, 99, 66) | rgb(232,244,238) · rgb(232,244,237) · rgb(231,244,238) | 6.33 : 1 | PASS |
| AI product entry on focused pale blue | 390 / no-preference | rgb(0, 102, 204) | rgb(241,247,255) · rgb(241,247,255) · rgb(241,247,255) | 5.17 : 1 | PASS |
| AI purpose heading | 390 / no-preference | rgb(29, 29, 31) | rgb(241,247,255) · rgb(241,247,255) · rgb(241,247,255) | 15.62 : 1 | PASS |
| Header brand | 390 / reduce | rgb(29, 29, 31) | rgb(249,252,255) · rgb(249,252,255) · rgb(249,252,255) | 16.35 : 1 | PASS |
| Header exchange rate | 390 / reduce | rgb(88, 97, 108) | rgb(249,252,255) · rgb(249,252,255) · rgb(249,252,255) | 6.10 : 1 | PASS |
| Nav home | 390 / reduce | rgb(99, 102, 109) | rgb(255,255,255) · rgb(255,255,255) · rgb(255,255,255) | 5.75 : 1 | PASS |
| Nav AI | 390 / reduce | rgb(99, 102, 109) | rgb(254,254,255) · rgb(254,254,255) · rgb(254,255,255) | 5.71 : 1 | PASS |
| Nav messages | 390 / reduce | rgb(99, 102, 109) | rgb(255,255,255) · rgb(255,255,255) · rgb(255,255,255) | 5.75 : 1 | PASS |
| Nav active workbench | 390 / reduce | rgb(0, 102, 204) | rgb(237,245,255) · rgb(235,244,255) · rgb(234,243,255) | 4.97 : 1 | PASS |
| Inventory success receipt | 390 / reduce | rgb(35, 99, 66) | rgb(232,244,237) · rgb(232,244,237) · rgb(231,244,237) | 6.32 : 1 | PASS |
| AI product entry on focused pale blue | 390 / reduce | rgb(0, 102, 204) | rgb(241,247,255) · rgb(241,247,255) · rgb(241,247,255) | 5.17 : 1 | PASS |
| AI purpose heading | 390 / reduce | rgb(29, 29, 31) | rgb(241,247,255) · rgb(241,247,255) · rgb(241,247,255) | 15.62 : 1 | PASS |

## 最终复验结果

- 生产入口：http://localhost:3000。桌面 1440 × 1000、手机 390 × 844、短手机 390 × 568（减少动态）。
- 27 / 27 个实际可见文字与材质样本达标；最低 4.974 : 1。
- 活动导航及 AI 读取入口实际 computed 前景为 rgb(0, 102, 204)。活动导航最低 4.974 : 1，AI 聚焦浅蓝入口 5.166 : 1。
- 12 / 12 项键盘按住 Space 检查通过：页头设置、库存新建、Motion 导航、AI 读取入口 × 三种视口。输入模式为 keyboard，transition 为 0s，实际 :active 期间没有缩放或位移；Motion 所有权保留。
- 窄复验没有浏览器 JS 错误；12 个写入/模型类请求被夹具拦截，真实业务写入 0。未调用实际 AI 模型。
- 原 production verification.json 保留：33 / 33 功能检查通过、0 浏览器错误、45 个业务请求拦截、0 真实写入；本次没有重跑这些功能检查。

取样前等待汇率行完成加载，以固定页头排版；短屏将 AI 用途 article 滚至中央，确认文字没有被固定页头遮挡。前景来自 computed style，实际背景来自 PNG 三点采样。此结果只覆盖本报告定义的状态与样本，不代表全站所有像素或全部交互状态。详细键盘数据见 contrast-keyboard-verification.json；原始像素与位置见 contrast.json。
