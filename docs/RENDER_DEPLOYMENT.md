# Render 全线上部署

本项目使用 `render.yaml` 一次创建四项服务：公开 Web、私有 API、常驻采集 Worker、持久化 Key Value，并创建托管 PostgreSQL。网页通过同源 `/backend` 代理访问私有 API，因此浏览器不需要知道内网地址。

## 费用与持续运行

Blueprint 默认使用付费常驻计算和持久化 Key Value。这样 Web 不休眠、Worker 不停机、BullMQ 队列重启后仍保留，电脑关闭后系统也会继续运行。若手动把服务改成 free，后台 Worker 不可用或数据服务可能缺少持久化，不符合持续监控目标。

## 首次上线

1. 把项目根目录初始化为 Git 仓库并推送到 GitHub；确认 `.env` 没有被提交。
2. 登录 Render，选择 **New → Blueprint**，连接该 GitHub 仓库。
3. Render 会读取根目录的 `render.yaml`。确认区域为 Singapore、资源名称无冲突。
4. 在首次创建页面填写标记为 Secret 的变量：
   - `FIRECRAWL_API_KEY`：API 与 Worker 两处填写同一值；没有时先关闭 Worker 的 `FIRECRAWL_DISCOVERY_ENABLED`。
   - `CRAWLER_CONTACT`：真实联系邮箱。
   - `CRAWLER_USER_AGENT`：例如 `TokusatsuMonitor/1.0 (+mailto:you@example.com)`。
   - `BAI_API_KEY`、`GEMINI_API_KEY`、`GROQ_API_KEY`、`SILICONFLOW_API_KEY`、`CEREBRAS_API_KEY`、`CLOUDFLARE_AI_API_TOKEN`、`COHERE_API_KEY`、`NVIDIA_API_KEY`、`OPENROUTER_API_KEY`：全部只填写在 API 服务。Worker 通过 Render 私网 API 调用 AI，Web 与 Worker 均不持有 Provider key。
   - Gemini key：确认是 Auth key。Google 已宣布 2026 年 9 月起拒绝 Standard key；若当前仍是 Standard key，先在 Google AI Studio 完成迁移再上线。
   - `GEMINI_API_TIER`、`GROQ_API_TIER`、`CEREBRAS_API_TIER`、`CLOUDFLARE_AI_API_TIER`、`COHERE_API_TIER` 默认是 `unknown`，系统不会根据 key 猜测账号是否免费。只有操作员在对应控制台确认当前账号层级后，才显式改为 `free`、`promotion` 或 `paid`；本地同步脚本为已核验的 Groq 与 Cloudflare 提供 `-EnableVerifiedGroqFreeTier`、`-EnableCloudflareFreeAllocation` 两个显式开关。SiliconFlow 同一账号会同时看到免费与收费模型，因此 `SILICONFLOW_API_TIER=unknown`，只由 `SILICONFLOW_FREE_MODELS` 明确列出已经核价的免费模型。
   - Cloudflare 还要在 API 服务填写 32 位十六进制 `CLOUDFLARE_ACCOUNT_ID`；默认 `CLOUDFLARE_AI_ALLOW_OVERAGE=false`、`CLOUDFLARE_AI_DAILY_NEURON_BUDGET=8000`，不得用提高额度或开启超额计费绕过每日免费 Neurons。
   - Cohere 默认 `COHERE_INTERNAL_EVALUATION=false`、`COHERE_PRODUCTION_AUTHORIZED=false`，因此仅有 key 不会注册 Provider。内部评估与生产授权必须分开确认；新 Command A 模型的生产资格还要以 Cohere 账号/合同为准。
   - `NVIDIA_INTERNAL_EVALUATION=false`、`NVIDIA_PRODUCTION_AUTHORIZED=false` 与 `NVIDIA_PRIVATE_DATA_AUTHORIZED=false` 必须保持默认，所以 NVIDIA Trial 不会进入公开生产池。NVIDIA-hosted Developer endpoint 的 Trial Terms 只允许内部测试/评估；仅在已经取得 NVIDIA 或授权服务商的生产 Subscription 后，才可按合同范围启用生产，并且只有合同确认允许相应私人数据后才能单独启用私人数据。试用/活动/未知档只允许公开市场资料。

- 默认 `AI_COST_POLICY=free_only` 与 `AI_ALLOW_PAID_MODELS=false`：只使用已核验的合法免费/活动额度，未知或收费路线一律跳过。只有操作员明确接受费用后，才可同时调整成本策略和付费开关。
- 公开聊天与系统诊断接口有单独的费用和限流闸门：Blueprint 默认 `AI_PUBLIC_COST_POLICY=free_only`、`AI_PUBLIC_ALLOW_PAID_MODELS=false`，聊天为每客户端每 15 分钟 12 次、诊断为每小时 2 次。限流桶最多保留 10,000 个并每分钟清理过期项；如前置反向代理网段不同，按实际拓扑调整 `AI_TRUSTED_PROXY_CIDRS`。不要通过提高公开限额来规避 Provider 配额；`/ai/internal/execute` 不使用公开限流。
  - `AI_INTERNAL_TOKEN`：API 与 Worker 两处填写完全相同的随机长令牌。
  - `APIFY_TOKEN`：可选。填写后再把 Worker 的 `APIFY_ECOMMERCE_ENABLED` 改为 `true`。
  - `PLAYWRIGHT_WS_ENDPOINT`：可选。云端动态页面后备需要可访问的远程 Chromium WebSocket；不要填写本机路径。

5. 点击 **Apply**。API 与 Worker 都会在启动前执行 Prisma migration。
6. 等四项服务与数据库全部变为绿色，打开 `https://tokusatsu-monitor-web.onrender.com`。

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
- Worker 每两小时归档已售出、已结束、下架商品，购买记录和凭证不会被清理。
- Render Worker 日志无持续重启、无 Mock Adapter 入库。
- AI 对话成功返回商品与中文回答；如模型服务不可用，浏览器收到带 `code`、`message`、`retryable` 的 JSON，而不是空响应或 `Unexpected end of JSON input`。

## AI Provider 池验收

Render API 服务的默认顺序是 `bai|gemini|groq|siliconflow|cerebras|cloudflare|cohere|nvidia|openrouter`，实际会被 `AI_PROVIDER_ORDER_<TASK>` 的任务顺序覆盖。翻译优先 Gemini/Cloudflare/SiliconFlow，结构化批量任务优先 Groq/Cerebras/Cloudflare，图片优先 Gemini/B.AI/Cloudflare，市场分析优先 Groq/Gemini。每次先换同 Provider 的合格模型，再换 Provider。Cohere 与 NVIDIA Trial 默认不会注册到公开生产池。

上线后在 API 日志中确认以下事实；日志只能出现 Provider、模型、尝试序号、耗时和错误类型，禁止出现 Authorization header、请求中的私人内容或 key：

- 所有获得生产授权的 Provider 目录至少各成功一次；Cohere Trial 与 NVIDIA Trial 只在非生产评估环境做连通测试。某个 key 无效时只熔断该 Provider，不拖垮其余服务。
- 临时把一个 Provider key 设错后，调用能自动切到下一 Provider，并返回非空 JSON。
- Groq `429` 会遵守 `retry-after` 和 `x-ratelimit-reset-*`，不会立刻重试；其他 Provider 使用有抖动的有限退避。
- 目录刷新周期默认 6 小时；价格/活动核验超过 24 小时会降为 `unknown`，不再永久假定免费。目录 `404`、限额 `429` 或能力不符后会短期负缓存，不会持续请求失效模型。
- `free_only` 请求不会选择已知收费或成本未知的模型；默认配置在免费路线耗尽后返回可重试错误，不会进入付费兜底。

免费配额属于账号/项目和模型，不属于“这把 key 的固定额度”，而且会动态变化：

- Gemini 免费层仅部分模型可用，额度以 AI Studio 当前 Limits 为准；免费层内容可能用于改进 Google 产品，因此系统只允许公开商品、公开卖家和公开市场资料走 Gemini free。购买凭证、联系方式、支付资料与私人对话不进入该路线。参考 [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) 与 [API key migration](https://ai.google.dev/gemini-api/docs/api-key)。
- Groq 免费层按组织、模型分别计算 RPM/RPD/TPM/TPD，账号 Limits 页面是最终值。普通推理默认不保留，但可靠性或滥用调查日志可能临时保留最多 30 天。参考 [Groq rate limits](https://console.groq.com/docs/rate-limits) 与 [Your Data](https://console.groq.com/docs/your-data)。
- SiliconFlow 免费模型通常是不带 `Pro/` 前缀的当前目录模型，实名认证后可用；固定限额按账号和模型计算。模型免费状态、下线与价格变化时，以模型广场和账单为准。参考 [SiliconFlow Rate Limits](https://docs.siliconflow.cn/cn/userguide/rate-limits/rate-limit-and-upgradation)。
- Cerebras 免费层的 RPM/TPM/RPD/TPD 按组织、项目和模型变化，账号 Limits 页面是最终值。共享 API 当前公开目录可靠列出 `gpt-oss-120b`；`gemma-4-31b` 只有在当前凭证目录可见并通过探针后才启用。参考 [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits) 与 [public models](https://inference-docs.cerebras.ai/api-reference/models/public-models)。
- Cloudflare Workers AI 免费计划每日包含 10,000 Neurons，00:00 UTC 重置；付费超额价格按当前官方页面计算。本项目默认关闭 overage，账号层级和剩余 Neurons 必须动态核验。参考 [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) 与 [REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)。
- Cohere Trial key 免费但仅用于评估，Chat 常见限额为每分钟 20 次、每月总计 1,000 次 API 调用；Production key 为付费，新 Command A 变体的生产使用可能仍需联系 Cohere。参考 [Cohere rate limits](https://docs.cohere.com/v2/docs/rate-limits) 与 [going live](https://docs.cohere.com/v1/docs/going-live)。
- NVIDIA-hosted NIM Developer endpoint 免费用于内部原型与评估，但 Trial Terms 禁止公开生产使用。生产使用需要 NVIDIA AI Enterprise 或授权服务商对应 Subscription；仅有 `nvapi-` key 不代表已有生产权利。参考 [Run NIM Anywhere](https://docs.api.nvidia.com/nim/docs/run-anywhere) 与 [LLM APIs](https://docs.api.nvidia.com/nim/re/reference/llm-apis)。
- OpenRouter 免费模型额度很低且不适合作为生产保障；上游 Provider 可能采用不同日志/训练政策。参考 [OpenRouter FAQ](https://openrouter.ai/docs/faq) 与 [Provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging)。
- B.AI 当前零 Credits 路线属于限时活动，不在代码中声明为永久免费；以 B.AI 账号页显示为准。

## 域名或服务名变化

如果 Render 因重名要求修改 Web 服务名，同时更新 API 的 `CORS_ORIGIN`。网页到 API 的实际访问使用 Render 内网连接，不受公网 API 域名影响。

## 密钥规则

不要把 `.env`、`Keys.txt`、任何 AI Provider key、Firecrawl、Apify、视觉、远程 Playwright 或 Render Key 提交到 GitHub。Blueprint 中只保留 `sync: false` 占位，密钥由 Render Dashboard 保存。九个 AI key 只存在于 API 服务；不要为了方便复制到 Web 或 Worker。

## 来源自动适配

已配置的公开来源会使用专用解析器；配置 `FIRECRAWL_API_KEY` 后可启用更多来源。若要让 Firecrawl 处理白名单之外的公开 HTTPS 商品页，在 API 与 Worker 同时将 `FIRECRAWL_ALLOW_ANY_DOMAIN=true`，仍会执行 HTTPS、robots.txt、内网地址拦截、超时和限速检查。

Apify 只接收检索条件并返回结构化电商数据；Playwright 只负责动态渲染页面。两者都不会决定商品类别，书籍、杂志、漫画和卡片仍由统一的领域过滤器拒绝。

## Product 与审核队列

API 和 Worker 启动前会执行 Prisma migration，创建 `products`、标准词典、`review_queue`、`inventory` 并启用 PostgreSQL `pg_trgm`。Worker 启动后先写入日/中/英词典，再回填尚未关联 Product 的历史 Listing。该流程可重复执行，不会生成测试商品。
