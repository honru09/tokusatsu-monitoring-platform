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
- 容器化：web、api、worker、postgres、redis；PostgreSQL/Redis 使用持久卷，Redis 开启 AOF。

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
scripts/
  preflight.ps1
  deploy.ps1
  smoke.ps1
```

## Windows 一键部署

前置条件：Docker Desktop 的 Linux engine 可用。先运行：

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
- 指标：<http://localhost:3001/metrics>
- PostgreSQL 主机端口：`55432`（避免与本机常见的 `5432` 冲突）
- Redis：`6379`

## 手动命令

```powershell
pnpm install
pnpm db:generate
pnpm typecheck
pnpm test
pnpm build
docker compose -f infrastructure/docker-compose.yml up -d --build
./scripts/smoke.ps1
```

查看日志与停止：

```powershell
docker compose -f infrastructure/docker-compose.yml logs -f
docker compose -f infrastructure/docker-compose.yml down
```

数据卷默认保留；只有明确需要清空数据时才可额外使用 `down -v`。

## 配置

复制 `.env.example` 为 `.env`。生产环境至少修改：

- `POSTGRES_PASSWORD`
- `CRAWLER_CONTACT` 与带联系方式的 `CRAWLER_USER_AGENT`
- `CORS_ORIGIN`、`NEXT_PUBLIC_API_BASE_URL`
- `BAI_API_KEY`、`GEMINI_API_KEY`、`GROQ_API_KEY`、`SILICONFLOW_API_KEY`、`CEREBRAS_API_KEY`、`CLOUDFLARE_AI_API_TOKEN`、`COHERE_API_KEY`、`NVIDIA_API_KEY` 与 `OPENROUTER_API_KEY`（全部只配置在 API；Worker 通过私有 API 使用，Web 永远不持有密钥）
- 默认 `AI_COST_POLICY=free_only`、`AI_ALLOW_PAID_MODELS=false`，只使用已经核验的免费/活动额度；启用任何付费路线必须由操作员显式改动这两个开关
- AI 调用预算默认是单模型 30 秒、整条模型/Provider 回退 240 秒、Web 与 Worker 客户端 270 秒；整条截止时间与接入的 Provider 数量无关
- `AI_INTERNAL_TOKEN`（API 与 Worker 使用同一个随机长令牌）
- `APIFY_TOKEN` 并将 `APIFY_ECOMMERCE_ENABLED=true`（如需 Apify 电商检索）
- `PLAYWRIGHT_WS_ENDPOINT`（如需在云端使用远程 Chromium 动态页面后备）
- `SENTRY_DSN`（如接入错误追踪）

### AI Provider 池

API 按任务使用独立 Provider 顺序和模型路线，不把九个服务当作能力完全相同的随机池：

| 工作          | 首选免费路线                                              | 主要后备                                                                   |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| 翻译          | Gemini Flash-Lite、Cloudflare GLM、SiliconFlow Hunyuan-MT | Cerebras、B.AI、Groq、获授权的 NVIDIA 文本模型；Cohere 仅在获授权后启用    |
| 批量分类/提取 | Groq GPT-OSS、Cerebras、Cloudflare Gemma                  | Gemini Flash-Lite、SiliconFlow 小模型、B.AI、NVIDIA                        |
| 全图分析      | Gemini Flash、B.AI                                        | Cloudflare Llama Vision、经探针验证的 SiliconFlow/Groq；获授权的 Cohere A+ |
| 卖家/市场分析 | Gemini 或 Groq Compound + 系统自有数据工具                | Cloudflare、Cerebras、NVIDIA、B.AI、OpenRouter                             |
| 对话          | Groq、Cloudflare、Cerebras                                | Gemini、NVIDIA、B.AI、SiliconFlow、OpenRouter                              |
| 系统诊断      | Gemini 高推理、Groq/Cerebras GPT-OSS 120B                 | Cloudflare Nemotron/GPT-OSS、NVIDIA、B.AI、OpenRouter                      |

模型 ID、免费状态、功能和限额都会变化。网关每 6 小时刷新各凭证可见的 `/models`；价格/活动核验超过 24 小时会降为 `unknown`，不再假定免费。遇到 `404`、`429` 或能力不兼容会负缓存/熔断并换模型、再换 Provider；不会靠并发绕过限额。精确路由可通过 `AI_PROVIDER_ORDER_<TASK>` 和 `AI_ROUTE_<PROVIDER>_<TASK>` 调整。

公开的聊天与系统诊断接口另有独立安全边界：默认 `AI_PUBLIC_COST_POLICY=free_only`、`AI_PUBLIC_ALLOW_PAID_MODELS=false`，不会因内部路线配置而产生公开请求费用。每个客户端默认每 15 分钟最多 12 次聊天、每小时最多 2 次诊断；限流桶自动清理，并限制为最多 10,000 个。部署在反向代理后时，只信任 `AI_TRUSTED_PROXY_CIDRS` 中的代理网段传入的客户端 IP。内部执行接口不受这组公开限流影响。

免费规则不能写死为“永久免费”：

- B.AI 的零 Credits 模型是限时活动，结束时间和资格以账户页面为准。
- Gemini 免费层只覆盖部分模型、额度按项目与模型变化，且免费层内容可能用于改进 Google 产品；本系统仅允许它处理公开市场资料。Google 已宣布 **2026 年 9 月起拒绝 Standard key**，应提前迁移为 Auth key。参考 [Gemini 价格与数据使用](https://ai.google.dev/gemini-api/docs/pricing)、[API key 迁移](https://ai.google.dev/gemini-api/docs/api-key)。
- Groq 免费额度按组织和模型分别计算；网关会使用 `retry-after`、`x-ratelimit-remaining-*` 与 `x-ratelimit-reset-*`，避免额度见底后持续撞限。参考 [Groq 限额与响应头](https://console.groq.com/docs/rate-limits)。普通推理默认不保留，但可靠性/滥用调查可能临时保留最多 30 天；敏感资料仍不得发送。参考 [Groq 数据规则](https://console.groq.com/docs/your-data)。
- SiliconFlow 免费非 `Pro/` 模型需要实名认证，固定限额按账号和模型计算；收费 `Pro/` 模型、上下线和价格均会变化。参考 [SiliconFlow Rate Limits](https://docs.siliconflow.cn/cn/userguide/rate-limits/rate-limit-and-upgradation)。
- Cerebras 有免费层，但组织与模型限额动态变化；`CEREBRAS_API_TIER` 默认 `unknown`，只有控制台 Limits 明确确认后才设为 `free`。共享目录当前以 `gpt-oss-120b` 为可靠候选，`gemma-4-31b` 仅在凭证目录实际可见时启用。参考 [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits) 与 [public models](https://inference-docs.cerebras.ai/api-reference/models/public-models)。
- Cloudflare Workers AI 每日包含 10,000 Neurons 免费额度，00:00 UTC 重置；超出后可能计费，因此默认 `CLOUDFLARE_AI_ALLOW_OVERAGE=false`、本地日预算 `CLOUDFLARE_AI_DAILY_NEURON_BUDGET=8000` 且层级为 `unknown`。仅在控制台确认账号状态后，使用同步脚本的 `-EnableCloudflareFreeAllocation` 显式加入免费池。参考 [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) 与 [REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)。
- Cohere Trial key 免费但只供评估，通常受 20 RPM 和每月 1,000 次 Chat 调用上限约束；默认同时关闭 `COHERE_INTERNAL_EVALUATION` 与 `COHERE_PRODUCTION_AUTHORIZED`，所以仅放入候选路线而不会进入生产池。生产使用新 Command A 模型可能还需 Cohere 批准。参考 [Cohere rate limits](https://docs.cohere.com/v2/docs/rate-limits) 与 [going live](https://docs.cohere.com/v1/docs/going-live)。
- NVIDIA-hosted NIM Developer endpoints 只允许内部原型、测试与评估，不允许承载公开生产流量；默认 `NVIDIA_INTERNAL_EVALUATION=false`、`NVIDIA_PRODUCTION_AUTHORIZED=false`、`NVIDIA_PRIVATE_DATA_AUTHORIZED=false`，所以 Trial 不会进入公开生产池。只有已经取得 NVIDIA 或授权服务商的生产 Subscription，并确认合同允许相应私人数据后，才能分别显式启用。参考 [NIM hosted endpoint usage](https://docs.api.nvidia.com/nim/docs/run-anywhere) 与 [LLM API catalogue](https://docs.api.nvidia.com/nim/re/reference/llm-apis)。
- OpenRouter `:free` 模型共享低日限额，官方不建议作为生产保障；上游 Provider 还有各自的数据规则。参考 [OpenRouter FAQ](https://openrouter.ai/docs/faq)、[Provider 数据策略](https://openrouter.ai/docs/guides/privacy/provider-logging)。

`scripts/sync-ai-secrets.ps1` 只读取 `Keys.txt` 的精确标签 `BAI AI API Key`、`Gemini`、`groq`、`SiliconFlow`，以及 Provider 专用前缀 `nvapi-...`（NVIDIA）和 `sk-or-v1-...`（OpenRouter）。Cerebras、Cloudflare、Cohere 的 key 只接受各自官方控制台 HTTPS URL 的紧邻下一行；Cloudflare Account ID 只从 `dash.cloudflare.com/<32 位十六进制 ID>/...` 路径提取。脚本不会把任意 `sk-*` 猜成 Provider，也不会输出密钥；账号层级默认保留为 `unknown`。只有核验当前账号后才使用 `-EnableVerifiedGroqFreeTier` 和 `-EnableCloudflareFreeAllocation` 开启对应免费容量。

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
