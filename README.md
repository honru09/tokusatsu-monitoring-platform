# 日本特摄中古商品监控平台

面向采购人员的日本中古特摄商品情报系统。默认以假面骑士为主、奥特曼为辅，完整执行“搜索 → 进入详情页 → 规范化 → 文本分类 → 全图异步分类 → 人工复核 → 状态/价格刷新”，而不是只保存搜索标题。

## 已实现范围

- Next.js 采购工作台：在售商品、链接专区、库存与购买、人工审核、监控运行五个独立工作区，支持紧凑商品卡、筛选弹窗、详情抽屉与审计。
- NestJS API：商品列表/详情/修改/审计、服务器时间同步、健康检查、Prometheus 文本指标。
- PostgreSQL：以 `Product` 表示标准商品实体、`Item` 表示各平台 Listing；同一商品可聚合多个来源，并包含系列/角色/厂商/玩具类型词典、审核队列、匹配决策和库存。
- Redis + BullMQ：持久化重复搜索、详情采集、全图分类和动态状态刷新队列。
- Adapter：生产式配置仅启用真实来源。Yahoo! Auctions 使用 Crawlee/Cheerio；Firecrawl 可扩展公开白名单来源；Apify E-commerce 可检索结构化电商结果；Playwright 仅在普通公开页面读取失败时负责动态渲染。采集层不做业务分类，所有来源均实行限速、超时、重试与 Adapter 级熔断。
- 监控同时执行高频增量扫描与循环分页存量回扫。启动时立即预热补扫，之后把市场关键词分散到队列中持续搜罗，不只等待新上架。
- Web 默认显示中文标准名称并可切回原文。粘贴公开商品详情链接后，后台任务进度会在链接专区实时显示，完成后生成与在售库一致的标准商品卡，不会自动收藏。
- 文本规则分类：IP、玩具类型、厂商、成色、数量和单件成本；文本与视觉结果分开保存，冲突不会静默覆盖。
- 视觉分类：独立异步包按字段输出 `{ value, confidence, evidence }`。90% 以上自动确认，70%–89% 进入人工审核，低于 70% 的字段保持未知，不猜测。
- 商品归一：日/中/英别名词典先标准化，再用 PostgreSQL trigram、显著词与多因素评分归并 Listing；低可信匹配进入审核队列。
- 容器化：web、api、worker、postgres、redis，以及可选的 LiteLLM Gateway；PostgreSQL/Redis 使用持久卷，Redis 开启 AOF。

## 目录

```text
apps/
  api/                   NestJS API
  web/                   Next.js 采购看板
workers/
  crawlers/              Adapter、调度、详情、状态 Worker
  classification/        全图视觉分类服务
packages/
  shared/                SourceAdapter、分类与领域类型
  db/                    Prisma schema、migration、seed
  product-dictionary/    日/中/英标准商品词典与别名
services/
  matching/              Trigram、分词和多因素匹配评分
  product-intelligence/  Product 匹配、回填和审核队列
infrastructure/
  docker-compose.yml
  litellm/
    config.example.yaml   fast/smart/vision/ocr 四个稳定模型别名
scripts/
  preflight.ps1
  deploy.ps1
  smoke.ps1
```

## Windows 一键部署

前置条件：兼容下限为 Node.js 22.13.0，仓库开发/验证固定使用 Node.js 24.19.0 与 pnpm 11.19.0，另需启用 Linux engine 的 Docker Desktop。版本管理器会读取仓库中的 `.node-version` 或 `.nvmrc`；`devEngines` 与 lockfile 固定可复现运行时，生产镜像使用 `node:24.19.0-alpine`。先运行：

```powershell
./scripts/preflight.ps1
```

如果 Docker 日志显示 `wsl --version failed`，说明系统仍在使用旧版 inbox WSL。请在管理员 PowerShell 中执行 `wsl --update`，按系统提示重启，再重新运行预检。

开发环境可显式开启 Mock Adapter；当前生产式本地部署已关闭 Mock，仅运行真实 Adapter：

```powershell
./scripts/deploy.ps1
```

启用 Mandarake 真实 Adapter：

```powershell
./scripts/deploy.ps1 -EnableRealAdapter
```

服务地址：

- Web：<http://localhost:3000>
- API：<http://localhost:3001>
- 健康检查：<http://localhost:3001/health>
- PostgreSQL 主机端口：`55432`（避免与本机常见的 `5432` 冲突）
- Redis：`6379`

## 手动命令

本地手动开发固定使用 Node.js 24.19.0 和 pnpm 11.19.0。进入仓库后，先让 fnm、nvm、mise 或同类版本管理器应用 `.node-version` / `.nvmrc`，再启用 Corepack。不要在 Node.js 20 的 PATH 下直接启动 pnpm 11.19.0；pnpm 会在读取仓库配置之前失败。

```powershell
# 示例：任选本机已有的版本管理器，不需要修改仓库外的配置
fnm use
corepack enable
pnpm install
pnpm toolchain:check
```

请在执行 `pnpm install` 前先由版本管理器切换到 Node.js 24.19.0；安装只按 lockfile 校验依赖，并会拒绝不匹配的 Node.js 或 pnpm，而不会替你下载运行时。Docker 基础镜像已经提供精确版本的 Node.js，因此容器安装使用 `--no-runtime`，随后对构建命令启用同样的严格版本检查。根级脚本通过 `scripts/run-pnpm.mjs` 复用当前 Node 进程，因此 `pnpm build`、`pnpm test` 等命令中的嵌套 pnpm 不会回落到系统 PATH 上的旧 Node.js。

```powershell
pnpm install
pnpm toolchain:check
pnpm db:generate
pnpm typecheck
pnpm test
pnpm build
docker compose --env-file .env -f infrastructure/docker-compose.yml up -d --build
./scripts/smoke.ps1
```

当前部署只启用 OVO 这一条付费路线，并只允许精确模型 `gpt-5.6-luna`。`scripts/sync-ai-secrets.ps1 -RequireOvo` 会把所有任务收口到 OVO、暂停其他 Provider，并保持后台付费批处理关闭；其他 Key 仅保留为未激活配置，不参与自动切换。OVO 新配置在完成一次真实成功调用前显示“已配置 · 待验证”，账号组拒绝模型时显示“暂不可用”，不会伪报“已连接”。

仓库仍保留 LiteLLM 与多 Provider 实现供以后显式恢复。只有重新核验模型、费用、数据权限和生产授权后，才可启用 AI Gateway profile：

```powershell
docker compose --env-file .env --profile ai-gateway -f infrastructure/docker-compose.yml up -d --build
```

LiteLLM 仅绑定本机 `127.0.0.1:4000`。当前 OVO-only 部署不经 LiteLLM；若以后恢复，容器内 API 通过 `http://litellm:4000/v1` 调用，`fast`、`smart`、`vision`、`ocr` 背后的实际模型必须分别由 `LITELLM_*_MODEL` 注入，仓库不写死容易过期的模型 ID。

### AI Provider 安全验证

验证器先执行官方目录、成本、数据和商用规则门控，再决定是否需要真实推理。默认命令只读取目录和配置元数据，不发送 completion；只有显式 `--completion` 才会产生真实生成请求，可能消耗额度或产生费用。验证输出经过脱敏，不写入 Key、Authorization、prompt 或响应正文。完整的逐凭据、逐模型判据见 [`docs/AI_PROVIDER_LIVE_VALIDATION.md`](docs/AI_PROVIDER_LIVE_VALIDATION.md)。

```powershell
# 默认：只做目录探针，不生成 completion
pnpm ai:validate

# 显式真实 completion：可能计费；只验证指定 Provider 的最小输出
pnpm ai:validate -- --completion --provider bai --max-tokens 16

# 诊断可见但未激活的配置；不会改变生产路由
pnpm ai:validate -- --include-inactive
```

`--include-inactive` 仅为诊断构建临时 runtime，不能绕过成本、数据或商用门，也不会把 evaluation-only、unknown 或失败模型加入生产池。运行前请先确认当前账户的官方额度、重置时间和条款；本仓库不会通过多 Key、多账户或多组织轮换规避限流。

查看日志与停止：

```powershell
docker compose --env-file .env -f infrastructure/docker-compose.yml logs -f
docker compose --env-file .env -f infrastructure/docker-compose.yml down
```

数据卷默认保留；只有明确需要清空数据时才可额外使用 `down -v`。

## 配置

复制 `.env.example` 为 `.env`。生产环境至少修改：

`scripts/deploy.ps1` 会补齐缺失的 `POSTGRES_PASSWORD`、匹配的本地 `DATABASE_URL` 和 `AI_INTERNAL_TOKEN`，且不会把值打印到终端。若已有 PostgreSQL 容器，脚本会沿用其密码；若只有无法恢复密码的持久卷，则会停止并要求写回原密码，绝不会用新密码破坏现有数据库认证。手动运行 Compose 时必须显式传入根目录的 `--env-file .env`。

- `POSTGRES_PASSWORD`
- `CRAWLER_CONTACT` 与带联系方式的 `CRAWLER_USER_AGENT`
- `CORS_ORIGIN`、`NEXT_PUBLIC_API_BASE_URL`
- `OVO_API_KEY`、`OVO_API_URL=https://ovo1.cn/v1`、`OVO_API_TIER=paid` 与 `OVO_PRODUCTION_AUTHORIZED=true`：当前唯一生产 Provider；所有 `AI_ROUTE_OVO_*` 只填写 `gpt-5.6-luna`
- `AI_PROVIDER_ORDER=ovo` 及各任务级顺序均保持 `ovo`；不要配置第二个 Luna 别名来重试同一次账号组错误
- `AI_PROVIDER_MAX_CONCURRENCY_OVO=1`、`BACKGROUND_AI_PAID_AUTOMATION_ENABLED=false`：单并发并关闭历史批量翻译，避免账号组异常时浪费付费请求
- 其他 Provider、LiteLLM 与上游 Key 可以保留在本地 Secret 中，但当前必须处于暂停状态；恢复前需重新执行目录、能力、费用、数据和生产授权验收
- 公共聊天或主动 AI 分析只有在显式允许付费且通过公开端点限流时才可调用 OVO；页面加载本身不得触发 AI
- AI 调用预算默认是单模型 30 秒、整条模型/Provider 回退 240 秒、Web 与 Worker 客户端 270 秒；整条截止时间与接入的 Provider 数量无关
- `AI_INTERNAL_TOKEN`（API 与 Worker 使用同一个随机长令牌）
- `PROCUREMENT_SEARCH_KEYWORDS`：以 `|` 分隔的优先采购检索词，默认覆盖批量食玩、扭蛋、指人偶、迷你手办，以及假面骑士 S.H.Figuarts／真骨雕专区
- `PROCUREMENT_MIN_QUANTITY`、`PROCUREMENT_TARGET_QUANTITY`：批量采购的最低数量与优先目标数量，默认分别为 5 和 10
- `PROCUREMENT_MAX_UNIT_COST_JPY`：含已知运费后的单件成本上限，默认 `1000` 日元；运费未知时只能作为成本下限，不能判为首选
- `PROCUREMENT_MAX_VOLUME_CM3`、`PROCUREMENT_MAX_UNIT_VOLUME_CM3`：总体积与单件体积上限，默认分别为 `10000` 和 `1000` cm³；体积未知时不会被判为已知小体积
- `APIFY_TOKEN` 并将 `APIFY_ECOMMERCE_ENABLED=true`（如需 Apify 电商检索）
- `PLAYWRIGHT_WS_ENDPOINT`（如需在云端使用远程 Chromium 动态页面后备）
- `SENTRY_DSN`（如接入错误追踪）

### 采购候选优先机制

采购发现优先处理小体积、多数量、低单件成本的商品。Worker 会先合并重复商品，提取标题、正文和结构化数据中的明确数量、运费与包装尺寸，再以同一组采购阈值排序后抓取详情。价格口径是 `(商品价 + 已知运费) / 数量`；运费未知时只保留成本下限，体积未知时也不会当作已知小件。

规则层输出 `preferred`、`promising`、`needs_facts`、`deprioritized` 四种可解释类别以及事实、理由和缺失字段，不对外展示数字评分。AI 只核验文本或图片证据、识别冲突和决定是否需要图片复核，不得把未知运费、数量或体积补成事实。发现页与市场分析复用同一规则排序，闲鱼仍只用于已有关联商品的独立价格比较。

### 中国市场比价（已实现，部署前保持关闭）

中国平台数据只用于关联已有 `Product` 的价格比较和原商品链接，不会创建日本市场的 `Item`，也不会进入日本商品采集、分类、库存、采购或状态刷新链路。真实 PostgreSQL 中共用 canonical `Product` 身份，但中国观察写入独立的 comparison/offer 证据表，日本商品仍只写入 `Item`；闲鱼 `Source` 固定为 `comparison_only` 且保持 `enabled=false`，数据库触发器拒绝任何使用该 Source 的 `Item` 写入。这样只共享“同一个商品是谁”，不混合两边的 Listing、价格样本与业务状态；后续中国平台沿用同一隔离和授权门槛。

只有使用官方 API、取得平台书面许可，或已确认供应商拥有相应数据授权时才可启用。第三方 Actor 可以提供技术接入，但其存在本身不代表平台授权。启用闲鱼比较必须同时设置 `CHINA_MARKET_COMPARISON_ENABLED=true`、`CHINA_MARKET_COMPARISON_AUTHORIZED=true` 和 `XIANYU_COMPARISON_ENABLED=true`；任何一个开关为 `false` 都保持停用。比价采集与调度不依赖 `BACKGROUND_AI_PAID_AUTOMATION_ENABLED`：该开关关闭时使用确定性关键词与严格匹配后备，不会因此让已授权的闲鱼队列静默停摆。

默认使用 `XIANYU_APIFY_ACTOR=zen-studio~goofish-xianyu-search-scraper`，此路径必须配置 `APIFY_TOKEN`，但不依赖 `APIFY_ECOMMERCE_ENABLED`。如果采用已授权的搜索 API，则另行配置 `XIANYU_SEARCH_API_URL` 和作为 Secret 注入的 `XIANYU_SEARCH_API_TOKEN`。第三方 Actor 的存在不代表平台授权。为避免每个 Product 再抓取 20～50 个完整详情，当前 Actor 使用 summary：只有刚刚成功完成的 Apify run 数据集中的 canonical 商品行，且 `detailStatus=summary`、没有 detail error、没有 sold/offline/ended 等明确终止状态时，才以 `apify_current_search_result` 记录为本次当前在售观察。裸解析、缓存行、过旧 run、自建搜索 API 的 unknown 状态仍然 fail closed，不会被提升为 active。

单个 Product 默认每 6 小时刷新。轻量 dispatcher 每 15 分钟只扫描到期索引，每批 20 个位置默认保留 15 个给最早到期记录、5 个给最早尚未比价的新 Product；任一队列不足时由另一队列补满，因此长期积压不会饿死旧记录或新商品。稳定任务 ID 会合并重复调度，比较 worker 保持单并发，默认每分钟最多启动 1 个任务；`XIANYU_COMPARISON_RPM` 可在商品量增长时显式提高但代码最多接受 10，避免误配置造成突发流量。每个 Product 使用 3～8 组关键词（默认最多 5 组）、跨全部关键词最多评估 40 个候选，并以 3 秒请求间隔限速。Worker 启动时会立即补投一次 dispatcher，已有真实库 Product 无需手工 backfill。主要调度项为 `XIANYU_COMPARISON_INTERVAL_MS`、`XIANYU_COMPARISON_DISPATCH_INTERVAL_MS`、`XIANYU_COMPARISON_BATCH_SIZE`、`XIANYU_COMPARISON_NEW_PRODUCT_QUOTA`、`XIANYU_COMPARISON_MAX_KEYWORDS`、`XIANYU_COMPARISON_MAX_CANDIDATES`、`XIANYU_COMPARISON_RPM` 和 `XIANYU_REQUEST_INTERVAL_MS`。

默认供应商总 deadline 为 3 分钟、刷新租约为 10 分钟；未发生显式失败时，ready 价格的绝对展示上限为 24 小时。任何供应商错误、登录/验证码/风控、限流或不完整响应都会立即把本次比较置为失败并停止公开旧价格，而不是把错误解释成零结果。未匹配 offer 保留 30 天且单商品最多存 2,000 条；存储上限即使误配为更小值也会钳到 50，保证本轮完整候选预算不会在 ready 证据校验前被删掉。这些值分别由 `XIANYU_PROVIDER_DEADLINE_MS`、`XIANYU_COMPARISON_LEASE_MS`、`XIANYU_COMPARISON_MAX_STALE_MS`、`XIANYU_COMPARISON_OFFER_RETENTION_DAYS` 和 `XIANYU_COMPARISON_MAX_STORED_OFFERS` 控制。API 与 worker 必须使用相同的 refresh/stale 配置，否则界面可能过早隐藏或过久显示旧数据。

自建 `XIANYU_SEARCH_API_URL` 必须接受 `POST { keyword, limit, maxItems }`，并返回商品行数组，或在 `items`、`results`、`offers`、`records`、`list`（也可位于 `data` 下）中返回数组。每行必须包含真实闲鱼商品 URL、标题和正数人民币价格；要进入参考价样本还必须包含明确的 `active` / `online` / `在售` 状态证据。商品 ID 从 URL 验证，若响应另带 ID 字段则必须与 URL 一致；主图和成色可选。状态缺失只会保存为 unknown 候选，绝不会推断成在售。`xianyu_spider` 的默认 `/search/` 响应只有数量与数据库记录 ID，不能直接作为这里的价格证据；需要先扩展成返回实际商品行的只读服务。未知响应结构、仅有正数计数、登录失效或验证页面都会按失败处理，不会伪装成“搜索无结果”。

跨市场机会计算由 `XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED` 独立控制。闲鱼同款参考价达到 `XIANYU_ARBITRAGE_MIN_REFERENCE_PRICE_CNY` 后，只有再显式启用 `XIANYU_REVERSE_SEARCH_ENABLED`，才会用规范化 Product 的日文标题、系列和型号向已启用的日本来源投递一次高优先级精确反查。两项默认都关闭，避免基础价格对比无谓放大日本抓取量；整合部署时可在成本与授权信息齐全后一起开启。反查结果仍按普通日本 `Item` 入库并重新做 Product 同一性匹配，搜索词命中本身不能强行绑定商品。日本结果匹配到别的 Product 时只记为反查未命中，不形成机会。

跨市场机会按每条日本 listing 单独计算并保留审计状态：`ready`、`needs_facts` 或 `rejected`。只有固定售价、已知日本运费、同款与数量证据、已知小体积、有效 JPY/CNY 汇率，以及平台费、国际运费和中国境内履约费全部具备时，才会计算净利润并允许进入 `ready`。`XIANYU_ARBITRAGE_PLATFORM_FEE_RATE`、`XIANYU_ARBITRAGE_INTERNATIONAL_SHIPPING_JPY`、`XIANYU_ARBITRAGE_CHINA_FULFILLMENT_CNY` 默认故意留空；未由运营人员录入可靠值时只能得到 `needs_facts`，不会用 AI 或零成本假设制造高利润。日本成本下限已经高于闲鱼参考价，或价差、净利润、利润率不达门槛时记录为 `rejected`，不会作为可见套利命中。

该能力不实现或协助验证码、登录、风控、反爬、账号或代理轮换等绕过。持久化仅限商品侧白名单字段和对比所需的价格、币种、原链接与匹配信息，不保存卖家个人资料，也不保存供应商返回的原始整行响应。每条候选必须记录 provider key 与实际命中的中文关键词；汇总记录 `xianyu-v1` 算法版本及 allowlist 后的完成度/计数统计。数据库只允许 canonical `https://www.goofish.com/item?id=...` 链接，并在 ready 发布时复核至少 3 条本次 active offer 以及价格与代表链接来自同一条 offer。

### AI Gateway 与 Provider 路由

商品识别、图片分析、价格判断、标题解析、自动分类、翻译和对话统一经过 API 内的 Product AI / Gateway 边界。当前生产配置直接调用 OVO 的 `gpt-5.6-luna`，不使用 LiteLLM，也不自动回退到其他 Provider。任务级路由、JSON Schema 校验、超时、单并发、失败分类、熔断、缓存和审计仍由同一 Gateway 实现，因此此前的深度架构继续生效。

OVO 的 `/v1/models` 对当前 Key 返回空目录时，系统只把精确静态路由视为“可尝试”，而不是“已在线”。只有一次真实调用成功后才显示 `online/routable`；若返回“当前账号组没有可调度上游”的 404，模型与 Provider 都进入不可用状态并熔断，不会再用不存在的 `gpt-5.6` 别名追加付费请求。后台 AI 保持关闭，主动按钮仍可在冷却结束后做一次受控验证。

以下 LiteLLM 别名和多 Provider 资料是保留的备用架构，不代表当前已激活：

| LiteLLM 别名 | 主要职责                           |
| ------------ | ---------------------------------- |
| `fast`       | 翻译、标题解析、批量提取、自动分类 |
| `smart`      | 价格判断、市场分析、复杂推理       |
| `vision`     | 商品识别、全图分析                 |
| `ocr`        | 包装文字、型号与铭牌识别           |

若以后由操作员明确恢复多 Provider 模式，可重新启用 LiteLLM 和任务级直连后备。恢复前必须逐项通过当前凭据的目录与最小能力验证；下表只是可研究的职责划分，不是当前生产路由：

| 工作          | 首选免费路线                               | 主要后备                                                                                |
| ------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| 翻译          | Gemini Flash-Lite、Cloudflare GLM          | Cerebras、B.AI、Groq、获授权的 NVIDIA 文本模型；Cohere 仅在获授权后启用                 |
| 批量分类/提取 | Groq GPT-OSS、Cerebras、Cloudflare Gemma   | Gemini Flash-Lite、B.AI、NVIDIA                                                         |
| 全图分析      | Gemini Flash、B.AI                         | Cloudflare Llama Vision、经探针验证的 Groq/SenseNova 6.8 Flash Lite；获授权的 Cohere A+ |
| 卖家/市场分析 | Gemini 或 Groq Compound + 系统自有数据工具 | Cloudflare、Cerebras、NVIDIA、B.AI、OpenRouter                                          |
| 对话          | Groq、Cloudflare、Cerebras                 | Gemini、NVIDIA、B.AI、OpenRouter                                                        |
| 系统诊断      | Gemini 高推理、Groq/Cerebras GPT-OSS 120B  | Cloudflare Nemotron/GPT-OSS、NVIDIA、B.AI、OpenRouter                                   |

LiteLLM 的四个别名默认成本均为 `unknown`。只有核验当前上游账单条款后，才把别名加入 `LITELLM_FREE_MODELS`、`LITELLM_PROMOTION_MODELS` 或 `LITELLM_PAID_MODELS`；接入 Gateway 本身不代表免费。模型 ID、免费状态、功能和限额都会变化，多 Provider 模式不得靠并发、多 Key 或别名轮换规避账号额度。

Compose 在 Worker 中显式清空所有 Provider/Gateway key，Web 从不接收这些变量；只有 API 持有当前 OVO 凭据，Worker 只保留调用私有 API 所需的 `AI_INTERNAL_TOKEN`。生产环境不要复制 `.env` 到服务器，应使用 Render Secret、Vault、AWS SSM、1Password 或 Doppler 等 Secret Manager 分服务注入。

公开的聊天与系统诊断接口另有独立安全边界：默认仍禁止公开付费调用；只有操作员显式设置 `AI_PUBLIC_ALLOW_PAID_MODELS=true` 并选择允许付费的策略时，才可使用当前 OVO 路线。每个客户端默认每 15 分钟最多 12 次聊天、每小时最多 2 次诊断；限流桶自动清理，并限制为最多 10,000 个。部署在反向代理后时，只信任 `AI_TRUSTED_PROXY_CIDRS` 中的代理网段传入的客户端 IP。

表内未把 SiliconFlow 国际站列为商业生产路由：其公开标准条款禁止商业用途及为他人利益使用，除非该账户有另行书面合同，否则只能用于非商业内部验证。

免费规则不能写死为“永久免费”：

- B.AI 当前有官方直接零 Credits 证据的只有 `DeepSeek-V4-Flash`、`DeepSeek-V4-Flash-Vision-Exp`、`MiMo-V2.5` 和 `Qwen3.8-Flash`。`Hy3` 与 `GLM-5.3-Flash` 当前只有非零标准价格证据，不得继续静态标为活动免费。零 Credits 是可变活动，结算以当前平台页面为准；Bonus Credits 发放后 30 天到期。
- SenseNova Token Plan 当前账户证据显示所有 API Key 共享同一账户池（`shared_account_pool`）；Flash-Lite 先扣专属窗口再扣通用窗口。公开/账户页面的 `60,000 points/5h`、`600,000/week` 与早期 calls 表述不能互相换算，任一 429 都按账户级冷却，不能用 main→translation 绕过。`sensenova-6.8-flash-lite` 是支持图像理解的多模态聊天模型，视觉与 OCR 仍要分别通过当前目录和 capability canary；U1 Fast 是图像生成模型，不是 Chat Completions 模型。6.7 兼容重定向只记录到 2026-08-31，2026-09-01 起必须从当前目录确认 6.8 或替代模型后再切换。
- Gemini 免费层只覆盖部分模型、额度按项目与模型变化，且免费层内容可能用于改进 Google 产品；本系统仅允许它处理公开市场资料。Google 已宣布 **2026 年 9 月起拒绝 Standard key**，应提前迁移为 Auth key。参考 [Gemini 价格与数据使用](https://ai.google.dev/gemini-api/docs/pricing)、[API key 迁移](https://ai.google.dev/gemini-api/docs/api-key)。
- Groq 免费额度按组织和模型分别计算；网关会使用 `retry-after`、`x-ratelimit-remaining-*` 与 `x-ratelimit-reset-*`，避免额度见底后持续撞限。参考 [Groq 限额与响应头](https://console.groq.com/docs/rate-limits)。普通推理默认不保留，但可靠性/滥用调查可能临时保留最多 30 天；敏感资料仍不得发送。参考 [Groq 数据规则](https://console.groq.com/docs/your-data)。
- SiliconFlow 国际站只能公开确认新用户 `$1` Credits，没有可安全固化的完整免费模型清单。更重要的是，国际站标准条款禁止商业用途及为他人利益使用；未取得另行书面商业合同前，不得进入本系统对外生产路由，且仅处理公开数据。参考 [SiliconFlow Pricing](https://www.siliconflow.com/pricing) 与 [Terms of Use](https://docs.siliconflow.com/en/legals/terms-of-service)。
- Cerebras hosted API 当前公开确认 `$5` Free Trial，不是可续的永久免费层；付款方式和具体失效期按账户控制台核验，公共规则保守记为 `unknown`。`CEREBRAS_API_TIER` 默认 `unknown`，试用额度耗尽或到期收到 402 时停止请求。共享目录当前以 `gpt-oss-120b` 为可靠候选，`gemma-4-31b` 仅在凭证目录实际可见并通过 canary 后启用。参考 [Cerebras pricing](https://www.cerebras.ai/pricing)、[rate limits](https://inference-docs.cerebras.ai/support/rate-limits) 与 [public models](https://inference-docs.cerebras.ai/api-reference/models/public-models)。
- Cloudflare Workers AI 每日包含 10,000 Neurons 免费额度，00:00 UTC 重置；超出后可能计费，因此默认 `CLOUDFLARE_AI_ALLOW_OVERAGE=false`、本地日预算 `CLOUDFLARE_AI_DAILY_NEURON_BUDGET=8000` 且层级为 `unknown`。仅在控制台确认账号状态后，使用同步脚本的 `-EnableCloudflareFreeAllocation` 显式加入免费池。参考 [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) 与 [REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)。
- Cohere Trial key 免费但只供评估，通常受 20 RPM 和每月 1,000 次 Chat 调用上限约束；默认同时关闭 `COHERE_INTERNAL_EVALUATION` 与 `COHERE_PRODUCTION_AUTHORIZED`，所以仅放入候选路线而不会进入生产池。生产使用新 Command A 模型可能还需 Cohere 批准。参考 [Cohere rate limits](https://docs.cohere.com/v2/docs/rate-limits) 与 [going live](https://docs.cohere.com/v1/docs/going-live)。
- NVIDIA-hosted NIM Trial endpoints 只允许内部原型、测试与评估，明确禁止把 Trial 服务或其生成内容用于生产；默认 `NVIDIA_INTERNAL_EVALUATION=false`、`NVIDIA_PRODUCTION_AUTHORIZED=false`、`NVIDIA_PRIVATE_DATA_AUTHORIZED=false`，所以 Trial 不会进入公开生产池。当前通用 hosted LLM 官方参考没有确认一个适用于所有 NIM 的通用 `GET /v1/models` 契约；模型发现必须以官方动态 API Catalog 和精确 NIM reference 为准，不得把某次认证响应升格为通用官方保证。只有已经取得 NVIDIA 或授权服务商的生产 Subscription，并确认合同允许相应私人数据后，才能分别显式启用。参考 [NVIDIA LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis) 与 [API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)。
- Vercel AI Gateway 的 Free Tier 是每个 team 每月 `$5` Gateway Credits，只适用于官方标记的 Free Tier eligible 模型子集，不是全目录免费；购买 Credits 后转入付费层，该月度免费额不再适用。当前项目未接入 Vercel AI Gateway，这笔额度不得计入 LiteLLM 或直连 Provider 的可用预算。参考 [Vercel AI Gateway Pricing](https://vercel.com/docs/ai-gateway/pricing) 与 [Free Tier models](https://vercel.com/ai-gateway/models?freeTier=true)。
- OpenRouter `:free` 模型共享低日限额：无 credits 购买时 50 requests/day，累计购买至少 `$10` credits 后 1,000/day；官方不建议作为生产保障，上游 Provider 还有各自的数据规则。参考 [OpenRouter limits](https://openrouter.ai/docs/api/reference/limits)、[FAQ](https://openrouter.ai/docs/faq)、[Provider 数据策略](https://openrouter.ai/docs/guides/privacy/provider-logging)。

`scripts/sync-ai-secrets.ps1` 优先读取 `Keys.txt` 的精确标签 `OVO API Key`，也可从 OVO 官方控制台 URL 的紧邻下一行安全识别；兼容迁移时，仅当 `BAI_API_URL` 明确指向 `ovo1.cn` 才把旧的 BAI 凭据归属给 OVO。脚本仍能识别其他 Provider 的严格标签、专用前缀或官方控制台邻接格式，但在 `-RequireOvo` 部署中只保留其凭据并关闭激活开关。脚本不会把任意 `sk-*` 猜成 Provider，也不会输出密钥；存在多个冲突值时会停止而不是猜测。

真实 Adapter 当前已开启。Yahoo 增量搜索每 15 分钟一轮并按关键词错峰；存量回扫每 3 小时完成一轮关键词调度，当前默认覆盖搜索结果前 80 页。拍卖刷新根据剩余时间自动提升到 2 分钟、1 分钟或 30 秒。普通商品默认 60 分钟刷新。所有 BullMQ 任务采用指数退避，连续失败 5 次后打开该 Adapter 的 15 分钟熔断，不影响其他平台。`MOCK_ADAPTER_ENABLED=false` 时 Worker 会清理 Mock 的重复任务和普通待处理任务；队列维护不会误删其他来源的调度器元数据，因此不会再触发 Worker 重启循环。

## 数据语义保证

- `detected_at` 是系统首次发现时间；`listed_at` 只接受平台明确提供的时间，缺失时保持 `NULL`。
- 数据库只保存 UTC `auction_end_at`。Web 每 30 秒更新分钟级倒计时，每 45 秒校准服务器时间，避免无意义的每秒整页重渲染。
- `auction_remaining` 不入库。
- 同平台唯一键为 `(source_id, source_item_id)`；价格、运费、竞拍数变化写入历史。
- 图片分类会接收全部已采集图片 URL；低置信度或文本/图片冲突均设置 `needs_review=true`。
- 人工纠错同时保存修改前后 JSON、操作人、原因和时间。
- 书籍、杂志、漫画与卡片在采集、分类和入库边界均被排除；历史回填也不会把它们创建为 Product。
- 一个 Product 可关联多个平台 Listing；购买后按识别数量更新库存数量与平均成本。

## 合规与上线前检查

- 只访问公开页面，优先官方 API/RSS；每个 Adapter 必须独立验证 robots.txt 和平台条款。
- 不绕过登录、验证码、地理限制或反爬保护；不允许通过提高并发规避限频。
- Mandarake Adapter 的 HTML 选择器已经用固定夹具测试，但真实站点结构变化时应先停用该 Adapter、更新夹具，再恢复。
- 生产上线建议将 PostgreSQL/Redis 改为托管服务或限制主机端口暴露，使用反向代理/TLS，并将密钥放入 secret manager。

## Render 全线上运行

仓库根目录提供 `render.yaml`，会创建常驻 Web、私有 API、后台 Worker、持久化 Key Value 和托管 PostgreSQL。上线后电脑可以关机，采集与数据存储都在 Render 运行。完整步骤见 [`docs/RENDER_DEPLOYMENT.md`](docs/RENDER_DEPLOYMENT.md)。

## 验收

部署脚本最终执行 `scripts/smoke.ps1`，验证 Web、健康检查、商品 API、指标和 Mock Worker 入库。代码侧还包含：

- 分类、数量、`listed_at` 语义与拍卖动态刷新单元测试。
- Mandarake 搜索去重与详情 JSON-LD 解析测试。
- 全工作区严格 TypeScript 类型检查与生产构建。
