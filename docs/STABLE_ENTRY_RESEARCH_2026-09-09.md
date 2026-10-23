# 固定公网入口研究

核对日期：2026-09-09。范围：官方资料与技术建议；未读取凭据、创建云端资源或修改账户。本文件不是已部署说明。

## 结论

零费用、无需购买域名可以实现一个不随 Quick Tunnel 重建而变化的入口。建议使用 **Cloudflare 静态入口 + 同源状态 API + 一个 SQLite Durable Object + Windows 本地守护进程**。入口只负责检查与等待，守护进程负责复用或修复隧道。

这里的“稳定”只能指入口地址持久，不代表后端永远在线。Quick Tunnel 官方明确仅面向测试/开发，无 SLA 或在线率保证，并有 200 个同时进行中的请求限制、不支持 SSE。不能把本方案描述成生产可靠性保障。[Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

## 免费托管与状态存储

| 方案 | 官方事实 | 对本需求的判断 |
| --- | --- | --- |
| Cloudflare Pages | 生产入口为 `<project>.pages.dev`，生产部署更新内容而不是换入口；静态请求免费、不限量；Functions 与 Workers 共享 100,000 次/日免费请求额度。 | 可作为固定主页及同源 `/api/*`。不要通过重新部署主页来发布心跳或最新地址。[地址规则](https://developers.cloudflare.com/pages/configuration/preview-deployments/)、[计费](https://developers.cloudflare.com/pages/functions/pricing/) |
| Worker + Static Assets | 静态资源请求免费、不限量；Worker 执行另计。若对静态路由设置 `run_worker_first`，免费执行额度耗尽后会返回 429，不会自动退回静态文件。 | 单个项目最简单。让主页直接作为静态资源，只有 API 路径执行 Worker。[静态资源限制](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |
| `workers.dev` | 地址按 `<worker>.<account>.workers.dev` 分配；官方定位是个人/爱好、非业务关键项目，生产建议使用自有域名或 route。 | 可作低风险试用入口，但不应宣称适合业务关键生产环境。[workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) |
| Workers KV Free | 每日 100,000 次键读取、1,000 次键写入，1 GB 存储；超额的对应操作失败。 | 每 30 秒心跳为每日 2,880 次写入，超过免费额度；每 2 分钟为 720 次，但新地址仍可能延迟可见。[KV 计费](https://developers.cloudflare.com/kv/platform/pricing/) |
| SQLite Durable Object Free | 免费计划可用 SQLite 后端；100,000 次请求/日、13,000 GB-s/日，500 万行读取/日、100,000 行写入/日、总计 5 GB SQL 存储。 | 推荐一个固定名称对象保存最新地址和心跳；额度仍与账户其他用量、实际 SQL 操作一起核算，不能承诺无限免费。[DO 计费](https://developers.cloudflare.com/durable-objects/platform/pricing/) |

KV 写入在其他边缘位置可能等待 60 秒或更久才可见，连“键不存在”的结果也会缓存；因此不适合承担本需求的“立即读取最新隧道地址”与恢复锁。Durable Object 存储是强一致、可事务化的，且对象按需启动、闲置关闭；必须把需要跨休眠保留的状态写入持久存储，而不是普通 Worker 的全局变量。[KV 一致性](https://developers.cloudflare.com/kv/concepts/how-kv-works/)、[DO 行为](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)

两种可部署组合：

- 组件最少：一个 Worker 同时提供静态入口、API、DO 类。适用于接受 `workers.dev` 非业务关键定位的零费用试用。
- 使用 `pages.dev`：Pages 静态入口与 Functions，绑定另一个 Worker 中的 DO。Pages 不能在自身项目内创建/部署 DO 类，必须先部署 DO Worker 再绑定。DO Worker 不需要公开 `workers.dev` 路由。[Pages DO 绑定](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects)

Pages Free 每月 500 次构建、同时 1 次构建；正常只在修改入口代码时部署即可。[Pages 限制](https://developers.cloudflare.com/pages/platform/limits/)

## GitHub Pages 是否合适

GitHub 官方不允许把 Pages 当作经营在线业务、电商、主要促成商业交易或提供商业 SaaS 的免费托管服务，也不应通过 Pages 处理密码等敏感交易。[GitHub Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

**适用性判断，不是平台授权或法律结论：** 单纯项目介绍页并不自动等于受禁止的商业服务，但这里的页面主要把使用者带入采购业务工具，官方条款没有明确的“只放一个跳转按钮就豁免”规则。因此不建议把 GitHub Pages 当作本业务入口；如坚持采用，应向 GitHub 确认具体用例。Cloudflare 的免费额度本身也不等于业务 SLA，且不能借更换静态主页来消除 Quick Tunnel 的测试用途边界。

## 推荐流程（工程建议，尚未实现）

1. 访问者始终收藏固定入口。点击“进入系统”后，请求同源状态 API；不把上次隧道 URL 硬编码在 HTML、构建产物或 localStorage 中当作权威地址。
2. API 读取 DO 的最新记录，并由服务端对该 URL 的专用健康端点进行短超时检查。必须检查预期应用标识与 readiness，不能把登录页、Cloudflare 错误页或任意 HTTP 200 当作健康。浏览器只访问同源 API，避免跨域健康探测的 CORS 误判。
3. 当前 URL 健康则原样返回并导航，不重建隧道。当前 URL 的检查结果必须与其 generation 绑定；若检查期间地址更新，重新读取，避免返回旧检查结果。
4. 如果不可用，主页显示等待状态并有界轮询，例如每 3 秒一次、最多 90 秒。达到上限后保留固定入口并提供重试，不能无限显示“正在启动”。API 不可达、额度用尽与本机不在线应区分提示。
5. Windows 守护进程独立于浏览器与被暴露的 Web 服务运行。先检查现有进程、当前 URL 和本地应用健康；健康即复用。只有确认隧道失败且本地应用可服务时才重启隧道，使用本地互斥锁、连续失败阈值与退避，避免多次点击产生多个进程。429、单次网络超时或应用未就绪不应直接导致隧道不断换地址。
6. 新 URL 只有通过端到端健康检查后才发布。发布操作携带本机身份、单调 generation、当前状态与时间；心跳接收时间由服务端生成。防止旧进程的迟到心跳覆盖新一代隧道。

建议状态：`unconfigured`、`checking`、`ready`、`recovering`、`host_offline`、`app_unavailable`。可用记录仅需 URL、generation、服务端接收的心跳时间、最后健康检查时间和状态，不包含采购数据或认证凭据。动态状态/重定向响应应 `Cache-Control: no-store`，不要通过 CDN 缓存过期状态。

**恢复控制选择：** 默认用本地守护进程主动检查并恢复，公开入口只读。这已能做到“正常就进入，失效就等恢复”，不需要向任意访客暴露重启权限。若确实需要点击后按需启动，另设经过用户认证、限流和去重的 `ensure-running` 意图接口，由本机守护进程通过独立的出站请求领取；不接受任意命令、URL 或 PID，也不提供公开的强制重启接口。

## 离线与安全边界

- **本机关机、睡眠或断网：** 云端静态入口仍独立存在，但这个方案无法使本机执行操作。应提示“主机离线，请先开启主机”，而不是声称正在启动。需要远程开机时，必须另有经过授权的常在线管理通道，超出本方案范围。
- **隧道已死：** 恢复控制不能依赖该隧道自身。Cloudflare Tunnel 由本机 `cloudflared` 建立出站连接，因此独立守护进程与出站状态通道是恢复前提。[Tunnel 连接模型](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- **凭据：** 仅守护进程持有发布凭据，云端以 Worker/Pages secret 验证；不能放进 HTML、JS、公共 JSON、Git 仓库、查询参数或日志。部署凭据与运行期“仅发布这个入口状态”的凭据分开。Cloudflare 官方提供加密 secret binding，明确不要用普通配置变量存储敏感值。[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- **目标校验：** 只允许已授权发布者提交 HTTPS、无用户名密码、无非标准端口且主机严格匹配受支持的 `*.trycloudflare.com` 地址。探测时禁止任意跳转；校验响应身份。公开请求不能自带探测目标，防止 SSRF/开放重定向。
- **系统认证：** 公开主页不等于系统公开。可导航的 URL 不是秘密，业务系统仍需自己的登录/权限控制；不要把凭据嵌入跳转链接。换隧道主机名后浏览器登录状态可能需要重新建立，应单独验证现有认证流程。
- **启动责任：** 守护进程自启动、Docker 就绪顺序与睡眠设置必须实际验证。不要仅把进程启动成功当作“系统已恢复”，也不要为了恢复隧道而重启健康的数据库或整个 Docker 栈。

## 验收清单

- 同一健康隧道连续点击十次，不新增 tunnel 进程、不更换 URL。
- 终止该隧道后只有一次受控重建，所有访问者读到同一新 generation。
- 本机服务故障、主机离线、Cloudflare 错误页及 API 超额均不会被显示为 ready。
- 旧心跳、并发点击、伪造更新和任意探测目标无法改写有效记录或启动命令。
- 云端 API 不可用时静态主页仍可显示清晰错误；页面不存在长期缓存的可用状态。
- 浏览器源代码、网络请求和公开仓库中无发布 token、Cloudflare API token 或系统登录秘密。

需要上线前确认：Cloudflare 账户/计划、最终入口名称、是否接受 Quick Tunnel 的测试用途限制、发布凭据安全配置、本机守护进程自启动授权。此研究没有替用户做这些账户或部署决定。
