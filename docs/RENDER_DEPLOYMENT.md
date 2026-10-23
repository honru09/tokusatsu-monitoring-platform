# Render 全线上部署

本项目使用 `render.yaml` 一次创建四项服务：公开 Web、私有 API、常驻采集 Worker、持久化 Key Value，并创建托管 PostgreSQL。网页通过同源 `/backend` 代理访问私有 API，因此浏览器不需要知道内网地址。LiteLLM 不由 Blueprint 自动创建，它应作为独立 Gateway 部署和升级，避免把 Gateway 的数据库、Provider 密钥与应用生命周期耦合在一起。当前 Blueprint 与应用代码没有接入 Vercel AI Gateway。

## 费用与持续运行

Blueprint 默认使用付费常驻计算和持久化 Key Value。这样 Web 不休眠、Worker 不停机、BullMQ 队列重启后仍保留，电脑关闭后系统也会继续运行。若手动把服务改成 free，后台 Worker 不可用或数据服务可能缺少持久化，不符合持续监控目标。

## 首次上线

1. 把项目根目录初始化为 Git 仓库并推送到 GitHub；确认 `.env` 没有被提交。
2. 登录 Render，选择 **New → Blueprint**，连接该 GitHub 仓库。
3. Render 会读取根目录的 `render.yaml`。确认区域为 Singapore、资源名称无冲突。
4. 在首次创建页面填写标记为 Secret 的变量：
   - 如果已经部署 LiteLLM，在 API 服务手动增加 `LITELLM_API_URL` 与 `LITELLM_API_KEY`。URL 指向 API 可达的私网地址或 HTTPS 地址，路径以 `/v1` 结尾。`LITELLM_MASTER_KEY` 只属于 Gateway，绝不能放进 API、Worker 或 Web。
   - `LITELLM_API_TIER` 保持 `unknown`。只有核验实际模型账单后，才按别名设置 `LITELLM_FREE_MODELS`、`LITELLM_PROMOTION_MODELS`、`LITELLM_PAID_MODELS`；等级必须覆盖该别名及其 fallback 链里最昂贵的可达模型。接入 Gateway 不等于获得免费额度。需要传输私人资料时，还必须审核整条部署与 fallback 链，并设置 `LITELLM_PRIVATE_DATA_AUTHORIZED=true`。
   - `FIRECRAWL_API_KEY`：API 与 Worker 两处填写同一值；没有时先关闭 Worker 的 `FIRECRAWL_DISCOVERY_ENABLED`。
   - `CRAWLER_CONTACT`：真实联系邮箱。
   - `CRAWLER_USER_AGENT`：例如 `TokusatsuMonitor/1.0 (+mailto:you@example.com)`。
   - `BAI_API_KEY`、`GEMINI_API_KEY`、`GROQ_API_KEY`、`SILICONFLOW_API_KEY`、`CEREBRAS_API_KEY`、`CLOUDFLARE_AI_API_TOKEN`、`COHERE_API_KEY`、`NVIDIA_API_KEY`、`OPENROUTER_API_KEY`：只在需要 API 直连二级后备时填写到 API 服务。Worker 通过 Render 私网 API 调用 AI，Web 与 Worker 均不持有 Provider key。
   - Gemini key：确认是 Auth key。Google 已宣布 2026 年 9 月起拒绝 Standard key；若当前仍是 Standard key，先在 Google AI Studio 完成迁移再上线。
   - `GEMINI_API_TIER`、`GROQ_API_TIER`、`CEREBRAS_API_TIER`、`CLOUDFLARE_AI_API_TIER`、`COHERE_API_TIER` 默认是 `unknown`，系统不会根据 key 猜测账号是否免费。只有操作员在对应控制台确认当前账号层级后，才显式改为 `free`、`promotion` 或 `paid`；本地同步脚本为已核验的 Groq、Cerebras Free Trial 与 Cloudflare 提供 `-EnableVerifiedGroqFreeTier`、`-EnableVerifiedCerebrasFreeTrial`、`-EnableCloudflareFreeAllocation` 三个显式开关。Cerebras 开关只把层级记为 `promotion`，模型清单和核价时间仍需根据当日官方规则与账户 Limits 单独填写。SiliconFlow 的成本层级与商业授权必须分开：国际站标准条款禁止商业用途及为他人利益使用，即使模型显示零价，未取得另行书面合同也不得用于对外生产。
   - Cloudflare 还要在 API 服务填写 32 位十六进制 `CLOUDFLARE_ACCOUNT_ID`；默认 `CLOUDFLARE_AI_ALLOW_OVERAGE=false`、`CLOUDFLARE_AI_DAILY_NEURON_BUDGET=8000`，不得用提高额度或开启超额计费绕过每日免费 Neurons。
   - Cohere 默认 `COHERE_INTERNAL_EVALUATION=false`、`COHERE_PRODUCTION_AUTHORIZED=false`，因此仅有 key 不会注册 Provider。内部评估与生产授权必须分开确认；新 Command A 模型的生产资格还要以 Cohere 账号/合同为准。
   - `NVIDIA_INTERNAL_EVALUATION=false`、`NVIDIA_PRODUCTION_AUTHORIZED=false` 与 `NVIDIA_PRIVATE_DATA_AUTHORIZED=false` 必须保持默认，所以 NVIDIA Trial 不会进入公开生产池。NVIDIA-hosted Developer endpoint 的 Trial Terms 只允许内部测试/评估；仅在已经取得 NVIDIA 或授权服务商的生产 Subscription 后，才可按合同范围启用生产，并且只有合同确认允许相应私人数据后才能单独启用私人数据。试用/活动/未知档只允许公开市场资料。

- 默认 `AI_COST_POLICY=free_only` 与 `AI_ALLOW_PAID_MODELS=false`：只使用已核验的合法免费/活动额度，未知或收费路线一律跳过。只有操作员明确接受费用后，才可同时调整成本策略和付费开关。
- 公开聊天与系统诊断接口有单独的费用和限流闸门：Blueprint 默认 `AI_PUBLIC_COST_POLICY=free_only`、`AI_PUBLIC_ALLOW_PAID_MODELS=false`，聊天为每客户端每 15 分钟 12 次、诊断为每小时 2 次。限流桶最多保留 10,000 个并每分钟清理过期项；如前置反向代理网段不同，按实际拓扑调整 `AI_TRUSTED_PROXY_CIDRS`。不要通过提高公开限额来规避 Provider 配额；`/ai/internal/execute` 不使用公开限流。
  - `AI_INTERNAL_TOKEN`：API 与 Worker 两处填写完全相同的随机长令牌。
  - `APIFY_TOKEN`：可选。填写后再把 Worker 的 `APIFY_ECOMMERCE_ENABLED` 改为 `true`。
  - 闲鱼比价：在 API 与 Worker 填写同一个 `CHINA_MARKET_COMPARISON_AUTHORIZED`，并在 Worker 配置已获授权的 `XIANYU_SEARCH_API_URL`/`XIANYU_SEARCH_API_TOKEN`，或填写 `APIFY_TOKEN`。确认数据授权后再同时把两项服务的 `CHINA_MARKET_COMPARISON_ENABLED`、`XIANYU_COMPARISON_ENABLED` 和授权开关设为 `true`。默认刷新周期是 6 小时，API 与 Worker 的 `XIANYU_COMPARISON_INTERVAL_MS=21600000`、`XIANYU_COMPARISON_MAX_STALE_MS=86400000` 必须保持一致。利润计算和日本反查分别由 `XIANYU_CROSS_MARKET_ARBITRAGE_ENABLED`、`XIANYU_REVERSE_SEARCH_ENABLED` 控制，整合部署前保持关闭。
  - `PLAYWRIGHT_WS_ENDPOINT`：可选。云端动态页面后备需要可访问的远程 Chromium WebSocket；不要填写本机路径。

5. 点击 **Apply**。API 与 Worker 都会在启动前执行 Prisma migration。
6. 等四项服务与数据库全部变为绿色，打开 `https://tokusatsu-monitor-web.onrender.com`。

## 独立部署 LiteLLM

`render.yaml` 只为 API 预留接入顺序，不直接创建 LiteLLM 服务。生产 Gateway 应按 LiteLLM 官方生产指南独立部署，并固定镜像 `ghcr.io/berriai/litellm:v1.98.0`，不要使用 `latest`。仓库中的 `infrastructure/litellm/config.example.yaml` 是 Compose 和其他平台可复用的启动配置，暴露四个稳定别名：`fast`、`smart`、`vision`、`ocr`；实际模型 ID 只通过 `LITELLM_FAST_MODEL`、`LITELLM_SMART_MODEL`、`LITELLM_VISION_MODEL`、`LITELLM_OCR_MODEL` 注入。API 当前使用 `ai@7.0.87` 与 `@ai-sdk/openai-compatible@3.0.41` 调用这些别名。

Vercel AI Gateway 不是这套 Render 架构的组成部分。其 Free Tier 是每个 team 每月 `$5` Gateway Credits，只适用于 Free Tier eligible 模型子集，不是全目录免费。若未来接入，必须单独配置凭据、允许模型子集、预算、数据与上游条款，不得把该 `$5` 计入当前 LiteLLM 预算。

Gateway 服务需要：

- `LITELLM_MASTER_KEY`，由 Secret Manager 生成和保存，不提交到仓库。
- 与四个实际模型对应的 Provider key，例如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`（Google）、`DEEPSEEK_API_KEY`、`GROQ_API_KEY`。这些 key 放在 Gateway，不放在 Web 或 Worker。
- 生产如需持久化虚拟 key、预算和成本记录，应为 LiteLLM 配置独立的托管数据库；不要直接复用应用的业务 schema。

Gateway 就绪后，从 API 所在网络检查 `/health/readiness`，再把 API 的 `LITELLM_API_URL` 指向 Gateway 的 `/v1`。本地无虚拟 key 数据库时，`LITELLM_API_KEY` 可暂时与 master key 相同；生产应创建只允许 `fast`、`smart`、`vision`、`ocr` 的受限虚拟 key 给 API。若 Gateway 尚未部署，则不要配置 `LITELLM_API_KEY`，API 会跳过 LiteLLM 并继续使用现有直连池。

## 上线验收

AI 时限采用分层预算：单模型最多 30 秒，整条跨模型/跨 Provider 回退最多 240 秒，Worker 与 Web 代理等待 270 秒（代理硬上限 300 秒）。因此模型数量或未来 Provider 数量增加时，整条请求仍受统一截止时间约束，并会在代理断开前返回结构化可重试错误。

- `https://tokusatsu-monitor-web.onrender.com/api/health` 返回 `status: ok`。
- 首页显示“监控运行中”，最近扫描时间持续变化。
- “监控运行”工作区能看到标准商品、Listing、待审核、库存和各来源运行状态。
- 存量回扫出现 `backfill` 任务，商品总数能够增加。
- 粘贴公开商品详情链接，任务完成后出现在“链接专区”（不会自动收藏）。
- 首页顶部显示规则/AI 采购分析与性价比排行榜；购买记录在独立工作区保存。
- 70%–89% 的 Product/视觉字段识别出现在“人工审核”，确认后从队列消失。
- 数据库中多个相同商品 Listing 关联到同一 Product，购买后 Inventory 数量和平均成本更新。
- 启用闲鱼比价后，已有日本 Product 会自动进入 6 小时轮询；中国候选只出现在 comparison/offer 证据表，不得出现在 `Item`、Inventory、采购记录或日本市场统计中。卡片与详情只显示未过期的参考价和同一代表商品原链接；模拟供应商失败后该价格应立即隐藏。
- Worker 每两小时归档已售出、已结束、下架商品，购买记录和凭证不会被清理。
- Render Worker 日志无持续重启、无 Mock Adapter 入库。
- AI 对话成功返回商品与中文回答；如模型服务不可用，浏览器收到带 `code`、`message`、`retryable` 的 JSON，而不是空响应或 `Unexpected end of JSON input`。

## AI Provider 池验收

Render API 服务的默认顺序与全部 `AI_PROVIDER_ORDER_<TASK>` 都以 `litellm` 开头。LiteLLM 把翻译、批处理和分类路由到 `fast`，复杂分析和价格判断路由到 `smart`，图片与 OCR 路由到 `vision`/`ocr`。Gateway 未配置、成本策略不允许、超时或熔断后，API 才进入现有直连二级后备：翻译优先 Gemini/Cloudflare，结构化批量任务优先 Groq/Cerebras/Cloudflare，图片优先 Gemini/B.AI/Cloudflare，市场分析优先 Groq/Gemini。Cohere 与 NVIDIA Trial 默认不会注册到公开生产池；SiliconFlow 国际站标准账户只允许非商业内部验证，未有另行书面合同时也不得进入公开生产池。

上线后在 API 日志中确认以下事实；日志只能出现 Provider、模型、尝试序号、耗时和错误类型，禁止出现 Authorization header、请求中的私人内容或 key：

- 所有获得生产授权的 Provider 目录至少各成功一次；Cohere Trial 与 NVIDIA Trial 只在非生产评估环境做连通测试。某个 key 无效时只熔断该 Provider，不拖垮其余服务。
- LiteLLM `/v1/models` 只暴露 `fast`、`smart`、`vision`、`ocr` 四个业务别名；API 日志只记录别名和错误类型，不记录 Gateway key、上游模型请求正文或 Authorization header。
- 临时把一个 Provider key 设错后，调用能自动切到下一 Provider，并返回非空 JSON。
- Groq `429` 会遵守 `retry-after` 和 `x-ratelimit-reset-*`，不会立刻重试；其他 Provider 使用有抖动的有限退避。
- 目录刷新周期默认 6 小时；价格/活动核验超过 24 小时会降为 `unknown`，不再永久假定免费。目录 `404`、限额 `429` 或能力不符后会短期负缓存，不会持续请求失效模型。
- `free_only` 请求不会选择已知收费或成本未知的模型；默认配置在免费路线耗尽后返回可重试错误，不会进入付费兜底。

免费配额属于账号/项目和模型，不属于“这把 key 的固定额度”，而且会动态变化：

- Gemini 免费层仅部分模型可用，额度以 AI Studio 当前 Limits 为准；免费层内容可能用于改进 Google 产品，因此系统只允许公开商品、公开卖家和公开市场资料走 Gemini free。购买凭证、联系方式、支付资料与私人对话不进入该路线。参考 [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) 与 [API key migration](https://ai.google.dev/gemini-api/docs/api-key)。
- Groq 免费层按组织、模型分别计算 RPM/RPD/TPM/TPD，账号 Limits 页面是最终值。普通推理默认不保留，但可靠性或滥用调查日志可能临时保留最多 30 天。参考 [Groq rate limits](https://console.groq.com/docs/rate-limits) 与 [Your Data](https://console.groq.com/docs/your-data)。
- SiliconFlow 国际站只能稳定确认新用户 `$1` Credits，官方没有公开一份可安全冻结的完整免费模型清单。国际站标准条款禁止商业用途及为他人利益使用；除非账户有另行书面合同，否则只允许非商业内部验证和公开数据。参考 [SiliconFlow Pricing](https://www.siliconflow.com/pricing) 与 [Terms of Use](https://docs.siliconflow.com/en/legals/terms-of-service)。
- Cerebras 是限时 Free Trial，不是自动续期的永久免费层。新账号添加验证付款方式后获得 `$5` 额度，发放 30 天后失效；当前官方示例中 `gpt-oss-120b` 与 `gemma-4-31b` 均为 5 RPM、30K TPM、1M TPH、1M TPD，具体账号仍以 Limits 页面为准。模型只有在当前凭证目录可见并通过探针后才启用。参考 [Cerebras pricing](https://www.cerebras.ai/pricing) 与 [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits)。
- Cloudflare Workers AI 免费计划每日包含 10,000 Neurons，00:00 UTC 重置；付费超额价格按当前官方页面计算。本项目默认关闭 overage，账号层级和剩余 Neurons 必须动态核验。参考 [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) 与 [REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)。
- Cohere Trial key 免费但仅用于评估，Chat 常见限额为每分钟 20 次、每月总计 1,000 次 API 调用；Production key 为付费，新 Command A 变体的生产使用可能仍需联系 Cohere。参考 [Cohere rate limits](https://docs.cohere.com/v2/docs/rate-limits) 与 [going live](https://docs.cohere.com/v1/docs/going-live)。
- NVIDIA-hosted NIM Developer endpoint 免费用于内部原型与评估，但 Trial Terms 明确禁止把 Trial 服务或生成内容用于生产。生产使用需要 NVIDIA 或授权服务商对应 Subscription；仅有 `nvapi-` key 不代表已有生产权利。当前官方通用 LLM API reference 未确认一个适用于所有 hosted NIM 的通用 `GET /v1/models` 契约，请使用官方动态 API Catalog 和精确 NIM reference 做发现与验收。参考 [NVIDIA LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis) 与 [API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)。
- OpenRouter 免费模型额度很低且不适合作为生产保障；上游 Provider 可能采用不同日志/训练政策。参考 [OpenRouter FAQ](https://openrouter.ai/docs/faq) 与 [Provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging)。
- B.AI 当前有直接官方零 Credits 证据的只有 `DeepSeek-V4-Flash`、`DeepSeek-V4-Flash-Vision-Exp`、`MiMo-V2.5` 和 `Qwen3.8-Flash`；`Hy3` 与 `GLM-5.3-Flash` 当前只有非零标准价格证据。活动不在代码中声明为永久免费，以 B.AI 账号和当前官方定价页为准。
- SenseNova `sensenova-6.8-flash-lite` 官方确认支持图像理解，但精确的视觉与 OCR 生产路由仍必须同时通过当前凭据目录、能力 canary、商业授权和数据门禁。U1 Fast 是图像生成模型，不能放入 Chat Completions 候选。

## 域名或服务名变化

如果 Render 因重名要求修改 Web 服务名，同时更新 API 的 `CORS_ORIGIN`。网页到 API 的实际访问使用 Render 内网连接，不受公网 API 域名影响。

## 密钥规则

不要把 `.env`、`Keys.txt`、LiteLLM master/API key、任何 AI Provider key、Firecrawl、Apify、视觉、远程 Playwright 或 Render Key 提交到 GitHub。Blueprint 中只保留 `sync: false` 占位，密钥由 Render Secret 或外部 Secret Manager 保存。上游 Provider key 只进入 LiteLLM，确实需要直连二级后备的 key 才同时进入 API；Web 与 Worker 始终不持有 Provider/Gateway key，Worker 只保留调用私有 API 所需的 `AI_INTERNAL_TOKEN`。不同环境使用不同凭据，并为 Gateway、API 和第三方 Provider 建立独立轮换记录。

## 来源自动适配

已配置的公开来源会使用专用解析器；配置 `FIRECRAWL_API_KEY` 后可启用更多来源。若要让 Firecrawl 处理白名单之外的公开 HTTPS 商品页，在 API 与 Worker 同时将 `FIRECRAWL_ALLOW_ANY_DOMAIN=true`，仍会执行 HTTPS、robots.txt、内网地址拦截、超时和限速检查。

Apify 只接收检索条件并返回结构化电商数据；Playwright 只负责动态渲染页面。两者都不会决定商品类别，书籍、杂志、漫画和卡片仍由统一的领域过滤器拒绝。

## Product 与审核队列

API 和 Worker 启动前会执行 Prisma migration，创建 `products`、标准词典、`review_queue`、`inventory` 并启用 PostgreSQL `pg_trgm`。Worker 启动后先写入日/中/英词典，再回填尚未关联 Product 的历史 Listing。该流程可重复执行，不会生成测试商品。
