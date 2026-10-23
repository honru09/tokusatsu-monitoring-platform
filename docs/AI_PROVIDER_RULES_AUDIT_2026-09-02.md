# AI Provider 官方规则复核审计（2026-09-02）

## 审计范围与方法

本审计复核以下 11 个 Provider：Vercel AI Gateway、SenseNova Token Plan、B.AI、OpenRouter、Google Gemini Developer API、GroqCloud、SiliconFlow、Cerebras Cloud、Cloudflare Workers AI、Cohere、NVIDIA NIM hosted API。

结论仅来自截至 2026-09-02 可公开访问的官方文档、官方定价页、官方条款和官方 API 参考。复核过程未登录任何控制台，未读取 `.env`、`Keys.txt` 或其他凭据文件，未调用任何模型，也未用账户专属页面推断其他账户的权益。

本文使用三种证据状态：

- **确认**：当前官方公开资料直接支持。
- **变化或修正**：与现有 `docs/AI_PROVIDER_POOL_RESEARCH.md` 相比需要补充、收窄或更正。
- **无法官方确认**：公开资料没有给出，或只能在账户控制台、认证目录、单独合同中确认；不得猜测。

“免费”在本文中严格区分为永久免费模型、按周期刷新的免费配额、零价限时活动、一次性试用 Credits，以及网关赠送 Credits。它们不能互相替代，也不能因为某个 API Key 当前可调用就被编码成永久免费或生产可用。

## 结论摘要

1. **不得把免费状态写死。** Vercel、OpenRouter、Gemini、Groq、SiliconFlow、Cloudflare、Cohere 的免费范围或限额均会随模型、账户、计划或活动变化；B.AI 的零价模型是无固定结束日的活动；Cerebras 是 30 天试用；NVIDIA 没有公开统一赠额。
2. **两项生产硬限制必须立即进入路由门禁。** SiliconFlow 国际站公开标准条款禁止商业用途及为他人利益使用；NVIDIA API Trial 明确禁止把 API 服务或生成内容用于生产。除非账户有另行书面合同或生产订阅，这两条直连路由不得进入商业生产。
3. **私密数据默认拒绝。** Vercel 明确禁止敏感个人信息；Gemini Free tier、Cohere Trial/Research、NVIDIA Trial 存在训练或产品改进用途；SenseNova、B.AI、Groq 的当前公开资料不足以确认普通 API 正文的保留与训练边界；SiliconFlow 标准条款也排除了敏感或机密数据。OpenRouter 必须同时控制网关和上游策略。
4. **SenseNova Token Plan 的连接信息已得到当前公开文档确认。** OpenAI-compatible base URL 是 `https://token.sensenova.cn/v1`，目录是认证的 `GET /v1/models`；它与旧版 `https://api.sensenova.cn/v1/llm/chat-completions` 属于不同产品路径，不应混用。
5. **只有 Groq 提供清晰的通用限流响应头契约。** 其余 Provider 应按官方错误类别采用有界指数退避和 jitter，但不能依赖未公开承诺的 `Retry-After` 或 `x-ratelimit-*` 头。

## 连接、免费机制与默认门禁

| Provider              | 官方连接与目录                                                                          | 当前公开无成本机制                                           | 默认生产门禁                                              |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| Vercel AI Gateway     | `https://ai-gateway.vercel.sh/v1`；公开 `GET /v1/models`                                | 每团队 `$5/月`，仅 Free Tier eligible 子集                   | 条件允许；受 Vercel 计划和实际上游条款共同约束            |
| SenseNova Token Plan  | `https://token.sensenova.cn/v1`；认证 `GET /v1/models`                                  | Free 公测双积分池                                            | 商业授权和私密数据边界未确认，默认不进正式生产            |
| B.AI                  | `https://api.b.ai/v1`；认证 `GET /v1/models`                                            | 当前 4 个有官方证据的零 Credits 模型；赠送 Credits 30 天到期 | 生产和私密数据条款未确认，默认仅公开数据验证              |
| OpenRouter            | `https://openrouter.ai/api/v1`；公开 `GET /api/v1/models`                               | 动态 `:free` 模型和 `openrouter/free`                        | 官方称免费模型通常不适合生产                              |
| Gemini Developer API  | 原生 `https://generativelanguage.googleapis.com/v1beta`；OpenAI layer `/v1beta/openai/` | 仅部分模型有 Free tier                                       | Free tier 仅公开/非敏感数据；区域和模型条件满足后才可生产 |
| GroqCloud             | `https://api.groq.com/openai/v1`；认证 `GET /openai/v1/models`                          | Free plan 的逐模型 RPM/RPD/TPM                               | 仅 Production Models 可作生产候选；Preview 仅评估         |
| SiliconFlow           | `https://api.siliconflow.com/v1`；认证 `GET /v1/models`                                 | 新用户 `$1` Credits；完整免费模型集合未公开稳定列出          | 国际站标准条款下禁止商业生产，除非另有合同                |
| Cerebras Cloud        | `https://api.cerebras.ai/v1`；认证 `/v1/models`，公开 `/public/v1/models`               | `$5`、30 天 Free Trial，需验证付款方式                       | 试用容量不是永久生产保障；按模型生命周期门禁              |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`；官方动态目录        | 每日 10,000 Neurons                                          | 可作生产候选；部分 frontier 模型强制 Paid/prepaid         |
| Cohere                | `https://api.cohere.ai/compatibility/v1`；认证原生 `GET /v1/models`                     | 指定 Command 模型在限额内免费                                | Hosted free 不等于生产授权；须 Model Vault 或销售确认     |
| NVIDIA NIM hosted API | `https://integrate.api.nvidia.com/v1`；官方动态 API Catalog                             | Developer/API Trial，无公开统一 Credits 或限额               | Trial 明确禁止生产；有生产订阅后另建配置                  |

## 逐 Provider 复核

### 1. Vercel AI Gateway

**确认**

- OpenAI-compatible base URL 为 `https://ai-gateway.vercel.sh/v1`；公开目录为 `GET https://ai-gateway.vercel.sh/v1/models`。
- 当前定价页明确把免费层定义为每个 Vercel team 每月 `$5` AI Gateway Credits，只能调用 Free Tier eligible 模型子集，且逐模型限流低于付费层。
- 免费 Credits 从团队第一次 Gateway 请求开始；一旦购买 Credits，团队转入付费层，月度免费 Credits 不再适用。BYOK 也只在付费层开放。
- 官方提供动态 Free Tier 模型筛选页。它才是当前范围的公开来源，不应在代码中永久冻结一份列表。

**变化或修正**

- 早期资料中“免费层是否覆盖所有模型”的歧义已被当前定价页消除：**不是全部模型，而是官方标记的子集**。现有研究将 `$5` 视为网关额度而非上游永久免费模型仍然正确，但还应加上子集门禁。
- AI Gateway 会受实际第三方上游条款约束。Gateway 的统一接口不会自动统一上游的保留、训练、地域或商业规则。

**生产与私密数据**

- AI Product Terms 允许客户提供与 Gateway 相连的应用，但要求应用和终端用户遵守上游条款。
- 所有计划的 Input 都不得包含敏感个人信息，例如健康、金融账户或政府签发标识信息。
- 只有 AI Gateway Enterprise 条款给出明确的“不用 Gateway Customer Content 训练或改进 AI 产品”保证。Hobby/Pro 不能被推断为同等保证；ZDR 还需要符合计划资格并选择同意不保留/训练的上游。

**429**

- Free tier 逐模型限流，超限返回 429；官方建议短暂等待后重试。路由器仍应使用有界退避，并记录实际模型和上游 Provider。

**官方来源**：[SDKs & APIs](https://vercel.com/docs/ai-gateway/sdks-and-apis)、[Pricing](https://vercel.com/docs/ai-gateway/pricing)、[Free Tier models](https://vercel.com/ai-gateway/models?freeTier=true)、[AI Product Terms](https://vercel.com/legal/ai-product-terms)、[BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)

### 2. SenseNova Token Plan

**确认**

- 当前公开文档明确给出 OpenAI-compatible base URL `https://token.sensenova.cn/v1`，Chat Completions 为 `POST /v1/chat/completions`，认证目录为 `GET /v1/models`。
- 同一 Token Plan Key 还可使用 Anthropic-compatible `POST https://token.sensenova.cn/v1/messages`。Anthropic SDK 的 base URL 是 `https://token.sensenova.cn`，由 SDK 追加 `/v1/messages`。
- Token Plan 当前文档声明其所有 API 请求都基于 `https://token.sensenova.cn/v1`。现有研究里出现的旧 `api.sensenova.cn` 产品路径不属于当前 Token Plan 接入配置，不应与这套 Key 混用。
- 公开套餐页当前显示 `Free · 公测`、`¥0/月`、最多 20 个 API Key，并明确列出 SenseNova 6.8 Flash Lite 和 SenseNova U1 Fast。
- 2026-08-28 起，公开文档说明账户内有通用积分池和 Flash-Lite 专属积分池。两个池分别有滚动 5 小时 60,000 积分和滚动周 600,000 积分；Flash-Lite 先扣专属池，其他模型只扣通用池。不同模型按实际使用以不同规则扣积分，不能把积分直接换算成请求数或 token 数。
- `sensenova-6.8-flash-lite` 是支持图像理解的多模态聊天模型；U1 Fast 是图像生成模型，不能作为 Chat Completions 的聊天 Model ID。最终可用模型和能力应以认证的 `/v1/models` 返回为准。

**变化或修正**

- 现有研究中的 Token Plan base URL 和 `/v1/models` 现在已有当前官方公开文档直接支持，不再属于“无法官方确认”。
- 营销套餐卡列出的模型不等于账户完整目录。官方文档还会出现其他 SenseNova 或第三方模型，实际授权必须从当前 Key 的认证目录发现。

**无法官方确认**

- 未找到 Token Plan 当前公开条款对商业生产授权、请求正文保存时长、是否用于训练或改进模型、数据处理地域作出完整承诺。不能据“公测免费”推断可以处理私密订单、支付截图、联系人、凭据或私人笔记。
- 本审计不把用户提供的某个账户控制台快照推广为所有账户的永久规则；账户余额、模型权限和活动积分仍须在正式测试前按账户核对。

**429**

- Token Plan 文档定义 `429 quota_exceeded_error` 为速率或额度超限，并明确建议指数退避。没有找到稳定 retry header 契约。

**官方来源**：[Token Plan](https://www.sensenova.cn/token-plan)、[Token Plan API 文档](https://platform.sensenova.cn/docs)

### 3. B.AI

**确认**

- 生产 base URL 是 `https://api.b.ai/v1`；认证 `GET /v1/models` 返回当前凭据有权访问的模型。
- 当前公开资料能直接确认的 API 零 Credits 模型是：`DeepSeek-V4-Flash`、`DeepSeek-V4-Flash-Vision-Exp`、`MiMo-V2.5`、`Qwen3.8-Flash`。
- 这些是当前活动结算，不是标准价格永久为零。Qwen3.8-Flash 页面明确说明活动结束后恢复页面标准价格；其他零价项也应以平台显示和最终账单为准。
- 注册、充值活动等赠送 Credits 自发放日起 30 天有效。公开文档没有给出所有新账户统一获得多少初始 Credits。

**变化或修正**

- 现有研究把 `Hy3` 和 `GLM-5.3-Flash` 也列为当前零 Credits，但当前官方定价页只为它们列出标准非零价格，未在当前免费说明中确认零价。静态免费列表应收窄为上面 4 个有明确当前证据的模型，并在每次启用前重新检查。

**无法官方确认**

- 公开 API 文档没有给出普通 prompt/response 的通用保留、训练或私密数据处理承诺，也没有一份覆盖所有模型的商业授权条款。生产域名存在不等于任意模型、任意数据均已获生产授权。

**429**

- 官方建议对 429、500、502、503 使用带随机 jitter 的指数退避；400、401、403、404 通常不自动重试。

**官方来源**：[Pricing and Usage](https://docs.b.ai/llmservice/pricing-and-usage/)、[Qwen3.8-Flash](https://docs.b.ai/llmservice/models/qwen3-8-flash/)、[API Reference](https://docs.b.ai/llmservice/api/)

### 4. OpenRouter

**确认**

- base URL 是 `https://openrouter.ai/api/v1`；公开目录为 `GET /api/v1/models`。
- `:free` 选择某模型的免费变体；`openrouter/free` 是在当前免费池中动态选择的随机路由，不是一个固定底模。
- 未累计购买至少 `$10` Credits 的账户，免费模型合计 50 requests/day；累计购买至少 `$10` Credits 后为 1,000 requests/day。失败尝试也可能占用免费日额度。
- 官方明确提醒免费模型低限流、可用性变化大，通常不适合生产。

**生产与私密数据**

- OpenRouter 自身默认不记录 prompt/response 正文，除非用户选择 prompt logging；但实际上游的保留与训练策略独立存在。
- 私密请求至少要同时设置 `zdr: true` 和 `data_collection: "deny"`，并使用允许的 Provider/模型白名单。即使如此，也要核对目标上游的当前条款。

**429**

- BYOK 的 429 可能表示上游限额耗尽。官方建议等待后重试；官方安全重试示例对 429/5xx 使用指数退避，并避免在工具已产生副作用后重放整次请求。

**官方来源**：[Quickstart](https://openrouter.ai/docs/quickstart)、[Models API](https://openrouter.ai/docs/guides/overview/models)、[Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)、[FAQ](https://openrouter.ai/docs/faq)、[Data collection](https://openrouter.ai/docs/guides/privacy/data-collection)、[ZDR](https://openrouter.ai/docs/guides/features/zdr)

### 5. Google Gemini Developer API

**确认**

- 原生 base URL 为 `https://generativelanguage.googleapis.com/v1beta`，原生目录为 `GET /v1beta/models`；OpenAI compatibility base URL 为 `https://generativelanguage.googleapis.com/v1beta/openai/`。
- Free tier 只覆盖部分模型。精确 RPM、TPM、RPD 和项目可用额度受模型与账户 tier 影响，官方要求在 AI Studio 查看；公开页面不能代替账户限额。
- 模型页和价格页是动态目录。不能仅凭旧示例或某次 Key 成功调用把模型永久标为 free。

**生产与私密数据**

- Gemini API 面向专业和商业开发者，但向 EEA、瑞士、英国的终端用户提供 API Client 时必须使用 Paid Services。
- Free tier 提交的内容可被 Google 用于改进产品；Paid Services 的 prompts 和 responses 不用于改进产品，但仍有安全、滥用防护和法定义务所需的有限日志处理。
- 因此 Free tier 只应接收公开、可披露、非敏感数据。需要私密数据的生产路由应使用已确认的 Paid tier 和适用合同。

**429**

- 429 为 `RESOURCE_EXHAUSTED`。官方 SDK 对 429/5xx 等暂态故障使用指数退避；直接 REST 客户端应采用 jitter、有界重试和项目级限流。

**官方来源**：[OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)、[Models API](https://ai.google.dev/api/models)、[Models](https://ai.google.dev/gemini-api/docs/models)、[Pricing](https://ai.google.dev/gemini-api/docs/pricing)、[Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)、[Additional Terms](https://ai.google.dev/gemini-api/terms)、[Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)

### 6. GroqCloud

**确认**

- base URL 是 `https://api.groq.com/openai/v1`；认证目录为 `GET /openai/v1/models`。
- Free plan 不是赠送 Credits，而是组织级、逐模型的 RPM、RPD、TPM 等限制。公开表只是高层摘要，账户 Limits 页面仍是实际上限来源。
- 官方目录区分 Production Models 与 Preview Models。Production Models 可作生产候选；Preview Models 明确仅用于评估，不能作为正式生产唯一依赖。

**变化或修正**

- 旧版法律归档曾描述较强的数据保护边界，但当前普通 API prompt/output 的通用保留与训练承诺没有在现行公开资料中得到同等确认。不得把归档条款当作当前保证。

**无法官方确认**

- 在取得当前合同或 Groq 对普通 API 数据处理的现行明确承诺前，默认只发送公开数据。反馈功能有独立保留规则，不能反推普通 API 请求的规则。

**429**

- Groq 文档明确提供 `retry-after` 及 rate-limit reset headers。客户端应优先遵守 `retry-after`，并对 429/5xx 使用指数退避。

**官方来源**：[OpenAI compatibility](https://console.groq.com/docs/openai)、[Supported models](https://console.groq.com/docs/models)、[Rate limits](https://console.groq.com/docs/rate-limits)、[Security onboarding](https://console.groq.com/docs/production-readiness/security-onboarding)、[Feedback policy](https://console.groq.com/docs/feedback-policy)、[Legal archive](https://console.groq.com/docs/legal/archive)

### 7. SiliconFlow

**确认**

- base URL 是 `https://api.siliconflow.com/v1`；认证目录为 `GET /v1/models`。
- 国际站定价页当前只可稳定确认新用户 `$1` free Credits。公开资料没有给出一份可安全冻结的当前完整免费模型清单；任何模型的 free/Pro 状态都应动态核对。
- 429 正文会区分 TPM、RPM、IPM、IPD 等超限维度，但未承诺稳定的 retry header。

**重大变化或修正**

- 国际站当前公开 Terms of Use 第 3.4(e) 禁止为自己以外的任何人利益使用平台或服务，第 3.4(p) 禁止任何商业用途。现有研究中“允许所代表实体的内部业务用途”的结论不能继续作为 `api.siliconflow.com` 商业生产授权。
- 保守门禁应是：在取得适用于该账户的另行书面商业合同前，SiliconFlow 国际站直连只用于非商业内部验证，不服务客户、不参与售卖商品或服务的生产流程。

**私密数据**

- 条款称技术服务通常按用户指示处理 Interaction Data，不主动存储、使用或披露；但用户同时承诺不提交政府认定的敏感或机密材料、未经同意的个人信息、14 岁以下儿童个人信息等。具体产品规则和第三方模型条款仍可另行适用。
- 因此标准账户应按公开数据处理，不能仅据“不主动访问”表述批准私密数据。

**429**

- 根据错误正文识别被击中的限额桶，打开对应本地熔断器，再使用有界指数退避和 jitter；不要假设存在 `Retry-After`。

**官方来源**：[Quickstart](https://docs.siliconflow.com/en/userguide/quickstart)、[List models](https://docs.siliconflow.com/en/api-reference/models/get-model-list)、[Pricing](https://www.siliconflow.com/pricing)、[Terms of Use](https://docs.siliconflow.com/en/legals/terms-of-service)、[Error handling](https://docs.siliconflow.com/en/faqs/error-codecopy)

### 8. Cerebras Cloud

**确认**

- base URL 是 `https://api.cerebras.ai/v1`；认证目录为 `GET /v1/models`，公开元数据目录为 `GET https://api.cerebras.ai/public/v1/models`。
- 当前公开模型是 `gpt-oss-120b` 和 `gemma-4-31b`。前者是生产文本模型；后者的图像输入处于 Public Preview，须按其图片数量、格式和大小限制单独门禁。
- Cerebras 没有永久免费层。新账户在验证付款方式后获得 `$5` Free Trial Credits，30 天到期；用完或到期后须购买 Credits。
- 当前公开 Free Trial 示例限额对两个模型均为 5 RPM、30K TPM、1M TPH、1M TPD，但组织实际 Limits 页面仍优先。

**生产与私密数据**

- 公开隐私政策称推理输入和输出不保留，也不用于模型训练；服务运行所需日志仍可能保留。
- `gpt-oss-120b` 的 production model 标签不等于 `$5` 试用具备永久容量或 SLA。正式路由仍需确认账户 tier、预算和模型生命周期；Gemma Preview 不应成为唯一生产视觉模型。

**429**

- 429 错误正文指出超限的 bucket，但未找到稳定 retry header 契约。应在本地按组织和模型维度限流。

**官方来源**：[Authentication](https://inference-docs.cerebras.ai/api-reference/authentication)、[Public models](https://inference-docs.cerebras.ai/api-reference/models/public-models)、[Supported models](https://inference-docs.cerebras.ai/models/overview)、[Pricing](https://www.cerebras.ai/pricing)、[Rate limits](https://inference-docs.cerebras.ai/support/rate-limits)、[Privacy](https://cloud.cerebras.ai/privacy)

### 9. Cloudflare Workers AI

**确认**

- OpenAI-compatible base URL 是 `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`。Account ID 是 URL 的一部分，不能从 API Token 猜测。
- Workers AI 每日包含 10,000 Neurons，00:00 UTC 重置。超出免费额度后的使用与可用模型取决于付费计划和余额。
- 截至审计日，官方定价页明确要求 Paid Workers plan 或预付 AI Gateway Credits 的 frontier 模型包括 Kimi K2.6、Kimi K2.7 Code、GLM 5.2、GLM 5.3、GLM 5.3 Flash、DeepSeek V4 Flash、DeepSeek V4 Pro。它们不能算入无支付方式的免费池。
- 模型目录是动态的，能力和计费应从当前 Workers AI catalog 读取，不能永久硬编码。

**生产与私密数据**

- Cloudflare 声明 Workers AI Customer Content 不向其他客户暴露，且除非客户明确同意，不用于训练或改进 Cloudflare 或第三方服务。
- 这是本组较清晰的数据边界之一，但正式发送私密数据前仍要确认账户、存储组合、地域和合同配置；将 Workers AI 与存储服务组合会产生独立存储行为。

**429**

- 429 内部错误码 `3036` 表示每日额度耗尽，`3040` 表示模型容量不足。两者应采用不同熔断策略；官方未承诺通用 retry header。

**官方来源**：[REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)、[Models](https://developers.cloudflare.com/workers-ai/models/)、[Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[Errors](https://developers.cloudflare.com/workers-ai/platform/errors/)、[Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)

### 10. Cohere

**确认**

- OpenAI compatibility base URL 是 `https://api.cohere.ai/compatibility/v1`；认证原生目录是 `GET https://api.cohere.ai/v1/models`，可用 `endpoint=chat` 过滤。
- Command A+、Command A Reasoning、Command A Translate 当前对 Trial 和 Production Key 在公开限额内免费。当前公开限额为 20 Chat RPM，新版 Chat 模型合计 1,000 API calls/month。
- 免费托管没有公开永久结束日期，属于可变化状态。

**变化或修正**

- “Production Key 可免费调用”不是“已获生产部署授权”。A+ 和 Reasoning 的生产使用要求 Model Vault；Translate 的生产使用要求联系 Cohere。未完成该授权前不应进入对外生产路由。

**私密数据**

- Trial/Research 使用的输入输出可能用于 Cohere 研发，且 Trial 平台不应处理个人信息。
- Enterprise SaaS 的公开承诺是正文默认 30 天删除，并可选择退出训练；这不能自动套用到未知类型的 Key。

**429**

- 官方仅要求收到 429 后等待再试，未给出稳定 retry header 契约。应按 Key 类型和模型维度做本地限流。

**官方来源**：[Compatibility API](https://docs.cohere.com/docs/compatibility-api)、[List Models](https://docs.cohere.com/v2/reference/list-models)、[Rate limits](https://docs.cohere.com/v2/docs/rate-limits)、[Going live](https://docs.cohere.com/v1/docs/going-live)、[Command A+](https://docs.cohere.com/docs/command-a-plus)、[Command A Reasoning](https://docs.cohere.com/docs/command-a-reasoning)、[Command A Translate](https://docs.cohere.com/v2/docs/command-a-translate)、[Enterprise data commitments](https://cohere.com/enterprise-data-commitments)

### 11. NVIDIA NIM hosted API

**确认**

- hosted API Catalog 的 OpenAI-compatible base URL 是 `https://integrate.api.nvidia.com/v1`；模型与精确能力应以当前官方 API Catalog 和每个 NIM reference 为准。
- Developer Program/API Trial 仅用于原型、研究、开发、内部测试和评估。官方没有公开一个适用于所有账户的统一免费 Credits、RPM 或 TPM 数值。
- API Trial Terms 明确禁止把 API Service 或 Generated Content 用于生产；生产需要 NVIDIA 或适用 Service Provider 的 Subscription。

**重大变化或修正**

- 现有研究把认证 `GET /v1/models` 写成当前目录事实，但本次未能在现行官方 LLM API reference 中重新确认一个适用于所有 hosted NIM 的通用 Models endpoint。该项应降级为“无法官方确认”，目录发现以官方动态 Catalog 和精确 NIM reference 为准。

**私密数据**

- Trial Terms 禁止提交机密信息、受控或敏感数据、支付卡信息，以及未被具体 API Service 明确允许的个人数据。
- Trial 可收集 session metrics、错误和执行日志，以及 User Content/Generated Content，用于改进 NVIDIA 产品、服务和 AI 模型。Hosted Trial 因此只能发送公开数据。
- 自托管 NIM 或已购买的生产订阅可能有不同条款，必须作为独立 Provider 配置，不能继承 Trial 假设。

**429**

- 当前官方通用 API reference 没有确认稳定的 429 retry header 契约。应按实际响应做观测式限流，不把观测到但未文档化的头写成协议保证。

**官方来源**：[LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis)、[NVIDIA Developer Program](https://developer.nvidia.com/developer-program)、[NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)

## 对后续真实 Key 测试的强制前置门禁

本审计没有执行真实 Key 测试。后续测试不能以“逐个试到成功”为唯一策略，而应按以下顺序进行：

1. 在不打印密钥的前提下完成环境变量存在性、格式和重复 Key 检查，并先做泄漏扫描。
2. 为每个 Provider 固定正确 base URL 和认证协议，避免把旧域名、网关 Key、上游 Key 或不同产品线混用。
3. 先读取认证模型目录或账户授权信息；只有目录中存在且规则允许的模型才进入 canary。
4. 首次 canary 只使用公开、无个人信息的固定提示，限制为最小 token 和单并发；记录 HTTP 状态、Provider request ID、模型 ID、实际路由、token usage、cost、rate-limit metadata，不记录 Key 或完整私密正文。
5. 文本、结构化输出、工具调用、视觉和 OCR 分开测试。目录存在不等于支持所有能力。
6. 免费额度、活动和模型生命周期均保存 `observed_at` 与来源，设置短 TTL；过期后自动降级为未知，不继续假设免费。
7. 生产授权、私密数据授权、费用授权是三个独立布尔门禁。任何一个未知都不能由“调用成功”自动改为 true。
8. 429 只在请求尚未触发副作用时自动重试；工具或外部写操作已经执行后，必须使用幂等键或进入人工复核。

## 本次复核后的优先修正清单

1. 将 SiliconFlow 国际站标准账户设为 `commercial_authorized=false`、`private_data_authorized=false`，除非有另行书面合同。
2. 将 NVIDIA hosted Trial 设为 `production_authorized=false`、`private_data_authorized=false`；不要依赖未确认的通用 `/v1/models`。
3. 将 SenseNova Token Plan base URL 和认证 `/v1/models` 从“未确认”升级为官方确认，同时保留 `commercial_authorized=unknown`、`private_data_authorized=false`。
4. 将 B.AI 静态零价列表收窄到当前有直接官方证据的 4 个模型，并设置短 TTL；移除 Hy3、GLM-5.3-Flash 的静态免费断言。
5. 将 Vercel 免费层明确建模为 `$5/month + eligible model subset + per-model lower limits`，而不是全目录额度。
6. 将 Groq 的普通 API 数据边界标为当前未确认；不要引用旧法律归档作为现行保证。
7. 将 Cohere 的“限额内免费”和“获准生产”拆成两个字段；未获得 Model Vault 或销售确认时不进入公开生产流量。

本文是工程合规与路由审计，不替代适用于账户、地区和业务的法律意见或单独合同。
