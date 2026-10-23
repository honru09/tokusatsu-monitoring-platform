# 闲鱼运营 · 功能与版式对照

## 内容构图

- 核心任务：收录 Mercari → 编辑同一份闲鱼商品 → 官方发布与回填 → 维护与实际经营记录。
- 主工作面固定为「我的商品」。搜索、状态、批量与分页拥有独立状态；工具打开时继续保留。
- 桌面无选中商品时是两列紧凑图文行；选中后左侧商品集合、右侧实体白色编辑面，标题与数据按同一网格排列。
- 手机在集合与单件操作间独立重排，返回保留输入；工具使用接近整屏的原生对话框，内部独立滚动。
- 常驻主入口为「添加货源」；进入编辑后它降为次级。商品底部仍依据真实状态只提供一个黄色主要操作。
- 来源、确认、运费与原始信息、标题建议、历史、批量失败明细保留按需展开入口。
- 空状态分别说明没有草稿、筛选为空或没有货源；错误位于当前工作面或工具内部，失败不丢失输入。

## 功能去向

| 原入口 | 新入口 | 数据 / 状态所有者 | 验证 |
| --- | --- | --- | --- |
| 上架管理 | 常驻「我的商品」 | 原 listing API、query/status/page | PASS · 查询/状态/批量/编辑；分页逻辑保留，本轮未实际翻页 |
| 货源候选 | 添加货源 → Mercari 货源 | candidates API；独立 query/page | PASS · 定向浏览器夹具 / 只读渲染 |
| 单件收录后手动切视图 | 收录并编辑 → 对应新 listingId | import API 后读取真实新草稿，choose 的未保存保护 | PASS · 定向浏览器夹具 / 只读渲染 |
| 收录本页 | Mercari 货源工具内「收录本页」 | 原最多 30 项页面 / 50 项 API 上限 | 入口与 API 保留；本轮验证单件收录，未执行页面批量收录 |
| 货源监测设置 | 货源工具 → 配置货源监测 | 原 onOpenMonitoring，原采购系统监测 | 原回调保留；未跳转外层监测配置 |
| 闲鱼监测独立窗口 | 货源与市场工具 → 闲鱼参考 | 原 monitors / discoveries API | PASS · 定向浏览器夹具 / 只读渲染 |
| 新建 / 编辑 / 扫描 / 暂停监测 | 闲鱼参考中的条件与发现记录 | 原 dirty/nextDraft/pending / capability guards | PASS · 条件保存/脏稿/能力禁用；未启动真实自动扫描 |
| JSON 导入 / 已读 | 闲鱼参考展开 JSON / 发现记录 | 原 ingest / markRead | PASS · 定向浏览器夹具 / 只读渲染 |
| 商品维护独立窗口 | 已发布商品 → 维护商品；经营概览 → 商品维护 | 同一真实 listingId / version | PASS · 定向浏览器夹具 / 只读渲染 |
| 运营数据独立窗口 | 已发布商品 → 查看运营数据；经营概览 → 运营数据 | 同一真实 listingId；逐商品保存未提交的指标与维护输入 | PASS · 定向浏览器夹具 / 只读渲染 |
| 从数据回商品 | 单品指标行「打开商品」或当前商品「返回商品」 | 原 GET /resale/:id，复用 choose 的未保存保护 | PASS · 定向浏览器夹具 / 只读渲染 |
| 跨商品维护 / 报表 | 经营概览 / 查看全部经营 / 查看全部维护 | 原多商品列表 / periods / sort | PASS · 定向浏览器夹具 / 只读渲染 |
| 调价 / 擦亮 / 定时 / 回执 | 维护表单与最近任务 | 原 tasks API，手动结果确认 / 未连接边界 | PASS · 定向浏览器夹具 / 只读渲染 |
| 指标人工记录 / 同步 / 未知值 | 实际观测表单与单品指标 | 原 metrics API；未知仍为 null；0 仍为有效值 | PASS · 定向浏览器夹具 / 只读渲染 |
| CSV / 区间 / 排序 / 每日汇总 | 经营数据工具报告栏 / 展开每日 | 原真实 CSV URL、days、metricSort | PASS · 定向浏览器夹具 / 只读渲染 |
| 登录 / 失效 / 断开 | 页头闲鱼连接条 / 连接详情 | 原 account API / timer / capabilities | PASS · 定向浏览器夹具 / 只读渲染 |
| 标题 / 描述 / 售价 / 交付 / 确认 | 单件编辑面 | 原 EditDraft、version、stale/dirty保护 | PASS · 定向浏览器夹具 / 只读渲染 |
| 图片 / 封面 / 排序 / 删除 / 恢复货源图 | 单件编辑图组 / 管理图片 | 原 imageUrls / photoIndex、9 张上限 | PASS · 定向浏览器夹具 / 只读渲染 |
| 编辑 / 预览 / 保存 | 编辑面 / 商品底部主要操作 | 原 preview / draft / PATCH、失败保留 | PASS · 定向浏览器夹具 / 只读渲染 |
| 默认运费 / 单件运费 / 所在地 | 自动化设置 / 单件「运费与所在地」 | 原 settings、shippingMode / fee / location | PASS · 定向浏览器夹具 / 只读渲染 |
| 整理 / 接管 / 审核 / 核查 / 排队 / 暂停 | 更多商品操作 | 原 actions / version / busy guards | PASS · 审核/定时/暂停；其余原 actions 回调保留 |
| 批量 / 部分成功 / 定时 | 选择商品后出现批量工作条 | 原 bulk API，失败项目保留选择 | PASS · 定向浏览器夹具 / 只读渲染 |
| 去闲鱼发布 / 保存新版本再 prepare | 商品底部主要操作 | 原 PATCH 返回 version → prepare，失败保留 | PASS · 定向浏览器夹具 / 只读渲染 |
| 手动 URL 回填 / 发布结果 / 下架核实 | 手动发布与结果核实 | 原 targetUrl 解析 ID / record actions | PASS · 定向浏览器夹具 / 只读渲染 |
| 操作历史 | 单件操作记录 | 原 events API | PASS · 编辑读取 events 夹具；真实历史只读可达 |
| 自动化 / 暂停 / 恢复 / 手动运行 | 页头更多 → 自动化设置 | 原 settings/run API | PASS · 定向浏览器夹具 / 只读渲染 |
| 工作区深链接 / 切换保留 | 外壳导航、?workspace=resale 保留 | 根 Dashboard；组件持续挂载、active gating | PASS · 定向浏览器夹具 / 只读渲染 |

## 动效清单

| 交互 | 反馈 | 实际结束条件 | 减少动效 |
| --- | --- | --- | --- |
| 来源 / 经营工具 | 原生 dialog + 180ms 透明度 / 8px 位移 / 0.99 缩放 | showModal / close，取消旧动画的 generation 防护 | 即时相同结构 |
| 工具内任务切换 | 活动底线连续移动，旧任务状态保持 | 真实 view 更新 | 静态底线 |
| 商品选择 | 背景 / 左侧选中线即时反馈 | 当前 listingId | 同等选中反馈 |
| 按钮提交 / 收录 | 按压 0.98 / 禁用 / 请求中的文字 | 真实 API 成功或失败 | 无位移按压 |
| 保存 / 版本失败 | 底部真实状态 / 字段输入保留 | PATCH / action 结果 | 同等结果 |
| 图片选择 / 预览 | 当前图边界、局部切换 | photoIndex / preview | 同等图片和按钮 |
| 展开 | 原生 details；支持 interpolate-size 的浏览器提供 180ms 局部高度/透明度过渡 | open 属性，可中途逆转 | 即时展开，相同功能 |
| 图片横向阅读 | 原生 x proximity scroll-snap，仅96–120px缩略图strip | 手动滚动、点击和键盘选择，浏览器保持水平位置 | 原生吸附，不自动运动 |

## 限制

此次仅界面与现有 API 状态连接；未新增渠道能力，未调用真实 AI、发布、采购或买卖接口。实际最终发布继续在官方页面确认。已发布商品维护和指标目前遵循现有手动渠道能力。

## 2026-10-09 实際验证

隔离预览：`http://127.0.0.1:3105`，public API 使用同源 `/backend`。

- `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`：通过。
- `playwright-tests/resale-workspace.cjs`：1440 / 390 / 320 通过，含登录/失效、失败保存、编辑/预览/图片、默认/逐商品运费、prepare先保存返回版本、URL回填、菜单键盘与工作区保留、审核/暂停、触点无遮挡。
- `playwright-tests/resale-operations.cjs`：1440 / 390 通过，含批量部分成功/定时、监测保存/导入/已读、未连接操作禁用、人工调价回执、真实ID维护→数据→返回商品、两件商品逐件输入恢复、未知与0、排序/区间/CSV。
- `playwright-tests/resale-ai-flow.cjs`：1440 / 390 通过，含采购详情关联、读取结果复用、仅点击翻译、无自动AI、额度到聊天无页面刷新、聊天发送。
- `playwright-tests/resale-connected-flow.cjs`：1440 / 390 / 320（短屏568高）通过，含收录失败保留、主集合与货源筛选独立、真实新listingId选中、脏稿切换保护、来源查询恢复、Escape/焦点/滚动恢复、9图原生横向snap与键盘选择/水平滚动。
- `work/editorial-upgrade/resale-visual.cjs`：禁止全部非GET，在真实商品上检查320 / 390 / 768 / 1280 / 1440：列表→编辑、44px控件、无横向溢出、无pageerror均通过。
- 截图：`work/editorial-upgrade/resale-{list,editor}-{320,390,768,1280,1440}.png`；流程截图：`playwright-artifacts/resale/`。
- 图片吸附只用于横向缩略图；主商品集合、运营表格、整个编辑器与工具抽屉不强制吸附。

真实数据边界：全部浏览器业务流程 mutation 使用夹具；只读真实视觉脚本拦截非GET。此次未发出实际AI/发布/采购/付款/交易请求。最终生产构建与全站验收由主代理统一执行。
