# AI Provider 实时核验与逐凭据验收手册

核验日期：2026-09-01（Asia/Tokyo）

资料范围：官方规则核验截止 2026-09-01（Asia/Tokyo），覆盖各 Provider、LiteLLM 和模型厂商的 API 文档、模型目录、价格、限流、弃用及服务条款；另保留 2026-08-31 由仓库安全 validator 生成的脱敏实测状态。规则页面、目录、额度和活动可能在截止时间之后变化。

安全边界：本文不记录 Key 值、片段、长度、hash、Authorization header、prompt 或响应正文。实测报告只保留凭据环境变量名称/固定别名、HTTP 状态、模型 ID、错误类别、延迟、token usage 和安全计数。

历史实测结论：2026-08-31 的首轮模型目录探针覆盖 11 个直连凭据/凭据别名，全部返回 HTTP 200；显式 completion 探针成功 9/11。Gemini 因 429 配额未通过，Cerebras 因 402 credits 未通过。LiteLLM fast、smart 与 vision 通过对应能力探针，ocr 首次合成图探针遇到 429。本文没有把这些历史观测当作 2026-09-01 的新实测；成功仅适用于下文列出的凭据、模型、端点、能力和观测时刻，不外推到整个 Provider 目录。

## 1. 文档核验不等于 Key 已成功

必须区分三种证据：

| 证据层       | 能证明什么                                       | 不能证明什么                                       |
| ------------ | ------------------------------------------------ | -------------------------------------------------- |
| 官方文档     | Base URL、鉴权方式、标准请求、错误类型、公开条款 | 本地 Key 有效、余额充足、模型对该账户开放          |
| 模型目录 200 | Key 能通过鉴权并看到某些模型 ID                  | 模型能接受当前 payload、图片、JSON、工具或足够输出 |
| 最小推理 200 | 指定 Key、端点、模型和 payload 在该时刻成功      | 其他模型、其他能力、生产权利、长期稳定性           |

验收单位不是 Provider 名称，而是：

    environment × provider × credential_alias × model_id × capability × endpoint_shape

例如，SenseNova 的 main、translation 与 secondary 是三个独立验收单位。main 与 translation 属于同一个主账号额度组，secondary 属于明确分离的第二账号额度组；secondary 虽已接入 runtime，但完成逐凭据 live 验收前仍不得宣称已成功调用。同一个模型的 text、JSON、vision 和 OCR 也是四个不同能力状态。

## 首轮脱敏实测结果（2026-08-31）

### 直连 Provider

11 个直连凭据/凭据别名的模型目录均为 HTTP 200。显式 completion 结果如下：

| Provider    | 凭据别名    | 目录 | Completion | 实测模型                                    | 结论                                                                                          |
| ----------- | ----------- | ---- | ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| B.AI        | default     | 200  | 200        | <code>mimo-v2.5</code>                      | 当前模型最小 JSON completion 通过；活动/价格仍按实时账户核验                                  |
| Gemini      | default     | 200  | 429        | 两个目录候选                                | Key 与目录可用，当前项目配额阻塞；不是认证失败                                                |
| Groq        | default     | 200  | 200        | <code>openai/gpt-oss-20b</code>             | 最小 JSON completion 通过                                                                     |
| SiliconFlow | default     | 200  | 200        | <code>Qwen/Qwen2.5-7B-Instruct</code>       | 当日 CN endpoint 最小 JSON completion 通过；当前价格为输入/输出各 `$0.05/M`，不是当前免费证据 |
| Cerebras    | default     | 200  | 402        | 两个目录候选                                | Key 与目录可用，credits 阻塞；充值/额度恢复前不重试                                           |
| Cloudflare  | default     | 200  | 200        | <code>@cf/google/gemma-4-26b-a4b-it</code>  | account-scoped 最小 JSON completion 通过；未做图像 canary                                     |
| Cohere      | default     | 200  | 200        | <code>command-a-plus-05-2026</code>         | 技术探针通过；仅 evaluation，未获生产授权                                                     |
| NVIDIA      | default     | 200  | 200        | <code>nvidia/nemotron-3-nano-30b-a3b</code> | 技术探针通过；仅 evaluation，未获生产授权                                                     |
| SenseNova   | main        | 200  | 200        | <code>sensenova-6.7-flash-lite</code>       | 主凭据最小 JSON completion 通过                                                               |
| SenseNova   | translation | 200  | 200        | <code>sensenova-6.7-flash-lite</code>       | 翻译凭据最小 JSON completion 通过                                                             |
| OpenRouter  | default     | 200  | 200        | <code>minimax/minimax-m3:free</code>        | 当前免费候选最小 JSON completion 通过；不代表生产可用性保障                                   |

额外模型探针：

- SenseNova <code>sensenova-6.8-flash-lite</code> 超时，保持备用禁用；<code>u1-fast</code> 的 Chat 请求返回 404，不能进入当前 <code>/chat/completions</code> 路由。
- OpenRouter <code>z-ai/glm-5.2:free</code> 返回 429；这是该候选的当前限流状态，不影响已通过的 <code>minimax/minimax-m3:free</code> 单项证据。
- Gemini 的 429 与 Cerebras 的 402 均发生在目录 200 之后，再次证明“目录成功不等于推理成功”。

### LiteLLM Gateway

| 检查项              | 结果                 | 能证明什么                                |
| ------------------- | -------------------- | ----------------------------------------- |
| 容器健康            | healthy              | Gateway 进程与容器健康                    |
| <code>fast</code>   | text + JSON HTTP 200 | 当前 alias 与实际映射可完成最小结构化文本 |
| <code>smart</code>  | text + JSON HTTP 200 | 当前 alias 与实际映射可完成最小结构化文本 |
| <code>vision</code> | 合成图 HTTP 200      | JSON、对象、颜色和 SKU 均可返回           |
| <code>ocr</code>    | 首次合成图 HTTP 429  | 当前未通过；必须冷却后用同一合成图复测    |

LiteLLM alias 成功只证明该 alias 当前实际映射链路成功，不自动证明 <code>OPENAI_API_KEY</code>、<code>ANTHROPIC_API_KEY</code> 或 <code>DEEPSEEK_API_KEY</code> 分别成功。需要上游归因时，必须为每个上游建立独立 alias 或专用探针。

## 2. 当前真实架构边界

    网站 / API / Crawlers
              |
              v
    ProductAiService 与直接 Gateway 调用方
              |
              v
        AiGatewayService
              |
              v
          Model Router
       /                    \
      v                      v
    LiteLLM Gateway       直接 OpenAI-compatible Provider
      |                     B.AI / Gemini / Groq / SiliconFlow
      |                     Cerebras / Cloudflare / Cohere
      |                     NVIDIA / SenseNova / OpenRouter
      v
    OpenAI / Anthropic / DeepSeek / 其他上游
              |
              v
       Secret Manager 与脱敏审计

代码快照中的直接 Provider 注册表有 11 个：

- LiteLLM、B.AI、Gemini、Groq、SiliconFlow、Cerebras、Cloudflare Workers AI、Cohere、NVIDIA NIM、SenseNova、OpenRouter。
- OpenAI、Anthropic、DeepSeek 没有独立的应用 Provider runtime。<code>OPENAI_API_KEY</code>、<code>ANTHROPIC_API_KEY</code> 和 <code>DEEPSEEK_API_KEY</code> 只能由 LiteLLM 进程或另一个聚合层消费；仅把它们放进 API 应用环境，不会让当前注册表直接调用它们。
- LiteLLM 通过 AI SDK 的 OpenAI-compatible 客户端调用；其余直接 Provider 通过当前 Gateway 的 <code>/chat/completions</code> 请求形状调用。
- Product AI facade 声明并承载商品识别、图片分析、价格判断、标题解析、自动分类和翻译六项操作。Crawler 初筛使用商品识别，Crawler 正式分类使用自动分类，China-market 关键词使用标题解析并按候选情况使用商品识别/图片分析，物流使用图片分析，AnalysisService 使用价格判断与翻译。Worker 通过受保护的内部 Product AI endpoint 调用同一 facade。

以上是代码覆盖事实，不是线上成功事实。

## 3. 凭据面清单

下表只列环境变量名称，不读取变量值。

| 层级           | 凭据或身份变量                                                            | 当前消费者                       | 验收别名              | 2026-08-31 状态                                       |
| -------------- | ------------------------------------------------------------------------- | -------------------------------- | --------------------- | ----------------------------------------------------- |
| 应用到 LiteLLM | <code>LITELLM_API_KEY</code>                                              | API 应用                         | litellm/app           | fast/smart/vision 通过；ocr 429 待复测                |
| LiteLLM 管理   | <code>LITELLM_MASTER_KEY</code>                                           | LiteLLM 管理面；不应交给普通应用 | litellm/admin         | 不做推理验收                                          |
| LiteLLM 上游   | <code>OPENAI_API_KEY</code>                                               | LiteLLM 进程                     | litellm/openai        | 未做独立上游归因                                      |
| LiteLLM 上游   | <code>ANTHROPIC_API_KEY</code>                                            | LiteLLM 进程                     | litellm/anthropic     | 未做独立上游归因                                      |
| LiteLLM 上游   | <code>DEEPSEEK_API_KEY</code>                                             | LiteLLM 进程                     | litellm/deepseek      | 未做独立上游归因                                      |
| 直接 Provider  | <code>BAI_API_KEY</code>                                                  | API registry                     | bai/default           | 目录 200；mimo completion 200                         |
| 直接 Provider  | <code>GEMINI_API_KEY</code>                                               | API registry                     | gemini/default        | 目录 200；completion 429                              |
| 直接 Provider  | <code>GROQ_API_KEY</code>                                                 | API registry                     | groq/default          | 目录 200；GPT-OSS 20B completion 200                  |
| 直接 Provider  | <code>SILICONFLOW_API_KEY</code>                                          | API registry                     | siliconflow/default   | 目录 200；Qwen 2.5 completion 200                     |
| 直接 Provider  | <code>CEREBRAS_API_KEY</code>                                             | API registry                     | cerebras/default      | 目录 200；completion 402                              |
| 直接 Provider  | <code>CLOUDFLARE_AI_API_TOKEN</code> + <code>CLOUDFLARE_ACCOUNT_ID</code> | API registry                     | cloudflare/default    | 目录 200；Gemma completion 200                        |
| 直接 Provider  | <code>COHERE_API_KEY</code>                                               | API registry                     | cohere/default        | 目录/completion 200；evaluation-only                  |
| 直接 Provider  | <code>NVIDIA_API_KEY</code>                                               | API registry                     | nvidia/default        | 目录/completion 200；evaluation-only                  |
| 直接 Provider  | <code>SENSENOVA_API_KEY</code>                                            | API registry                     | sensenova/main        | 目录 200；6.7 completion 200（8/31 历史；重定向过期） |
| 直接 Provider  | <code>SENSENOVA_TRANSLATION_API_KEY</code>                                | API registry                     | sensenova/translation | 目录 200；6.7 completion 200（8/31 历史；重定向过期） |
| 直接 Provider  | <code>SENSENOVA_SECONDARY_API_KEY</code>                                  | API registry                     | sensenova/secondary   | RUNTIME_READY_UNPROBED；须单独完成目录与能力 canary   |
| 直接 Provider  | <code>OPENROUTER_API_KEY</code>                                           | API registry                     | openrouter/default    | 目录 200；MiniMax completion 200                      |

<code>sync-ai-secrets.ps1</code> 的 SenseNova 输入映射保持明确且 fail-closed：第一个控制台区块中的 <code>Main</code>/<code>Translate</code> 对应现有别名；第二个区块中的 <code>Main</code>，或第一个区块中显式的 <code>Secondary</code>，对应 secondary 占位。超过两个区块、标签不明或非单值输入会停止同步；目标中已有的 secondary 值不会被覆盖，且脚本不输出任何凭据值。

生产中，应用应使用受限 LiteLLM virtual key，而不是 master key。上游 Key 只注入 LiteLLM/Secret Manager，不进入浏览器、公开日志或普通应用诊断响应。

## 4. 不可妥协的安全规则

1. 只读取“变量是否存在”和安全元数据，不读取、打印、截断、散列或回传 Key 值；报告只使用固定 credential alias。
2. 禁止 <code>curl -v</code>、shell tracing、环境变量全量导出、异常对象原样序列化和 Authorization header 日志。
3. Provider host 必须来自显式 allowlist。重定向时不得把 Authorization header 带到不同 host。
4. 文本探针只使用固定无敏感提示；图片与 OCR 只使用合成测试图，不使用商品私图、订单、聊天、地址、付款截图或个人信息。
5. 每个凭据顺序执行，默认只做一次目录请求和一次最小推理。只有明确的瞬态错误才允许有界重试。
6. 不通过多 Key、多账户或多组织轮换规避账户级、项目级或组织级限流。
7. 只保留白名单响应元数据：HTTP 状态、Provider request ID、文档化的限流头、模型 ID、token usage、延迟与脱敏错误类别。响应体默认不落盘。
8. 探针前后都执行 secret leak scan；任何疑似泄漏先隔离日志和制品，再轮换凭据，不能继续测试。

## 5. 逐凭据、逐模型验证顺序

### Gate 0：商用与数据边界

先确认 Key 类型、账户主体、账单状态、生产授权、地区和数据政策。NVIDIA hosted Trial、Cohere Trial/未获授权的新 Command A 不能因为技术调用成功就进入公开生产；Gemini Free tier 不能接收本项目未明确授权的数据类别。

### Gate 1：配置元数据

只确认变量名称存在、Cloudflare Account ID 格式有效、Base URL host 在 allowlist、环境标签正确。不得读取值或前缀。缺少条件时记为 <code>NOT_CONFIGURED</code> 或 <code>BLOCKED_CONFIGURATION</code>。

### Gate 2：网络与服务就绪

验证 DNS、TLS、代理与超时。LiteLLM 只先调用根路径的 <code>/health/readiness</code>；它不触发上游模型。不要用 <code>/health</code> 代替 readiness，因为 LiteLLM 官方说明后者会真实调用模型并产生少量费用。

### Gate 3：模型发现

用当前 credential alias 调用官方模型目录，记录状态、模型数量和被配置模型的交集。目录失败时不得继续推理：

- 401：Key 无效或已撤销。
- 402：余额或账单不足。
- 403：权限、项目、实名、计划或商业授权不满足。
- 404：Base URL、端点或模型生命周期不匹配。
- 429：按账户/项目范围冷却，不得切同账户的另一个 Key 规避。
- 5xx：有界退避后切 Provider，不把故障判成 Key 失效。

### Gate 4：最小文本推理

对每个 credential alias 至少调用一个目录返回的、当前配置中的文本模型；对应用 allowlist 中的每个模型也各执行一次最小 canary。提示固定为 “Reply exactly OK.”，temperature 为 0，输出上限 8 到 16 tokens。验收包括：

- HTTP 2xx；
- 响应模型与路由可解释；
- 有非空文本；
- usage 可解析或明确标记为 Provider 未返回；
- 没有敏感 header 或请求体进入日志。

### Gate 5：JSON / Structured Output

商品服务依赖 JSON。必须通过应用实际使用的 request shape 单独验证 JSON Object 或 JSON Schema，并对结果执行本地 schema 校验。文本 canary 成功不代表 JSON 成功；LiteLLM 的参数丢弃或 Provider 兼容层也不能被当作 schema 支持。

### Gate 6：Vision 与 OCR

只对目录、官方能力说明和本地 allowlist 三者都允许的模型测试：

- Vision 图：合成的红色盒子、蓝色圆形和固定数量，要求返回对象、颜色和数量。
- OCR 图：合成文字 “KR-042 / 仮面ライダー”，要求 JSON 精确返回 SKU 和日文。

Vision 成功不等于 OCR 成功。图片 URL、data URL、大小、MIME、数量限制和响应 schema 都要按实际生产 payload 再测一次。Cerebras 的 <code>gemma-4-31b</code> 已进入 catalog/router 的 image_analysis 候选，但其 Public Preview 只接受 PNG/JPEG Base64 Data URI，不支持外部图片 URL，Free Trial 最多 2 张且图片总 payload 不超过 10 MB。当前 Gateway 只接收安全的公网 HTTPS 图片 URL，并已显式把该模型从此类图像请求的 eligible candidates 中剔除；在 provider-specific Data URI 路径、上限校验和实际 canary 完成前继续 fail closed。NVIDIA 的 image_analysis 路由仍为空。SenseNova 的 <code>sensenova-6.8-flash-lite</code> 已按官方图像理解能力进入 image_analysis 候选，但仍须通过当前凭据目录、视觉/OCR canary、生产授权与数据门禁。

### Gate 7：产品操作 canary

在底层能力通过后，依次验证六项 Product AI 操作。每项使用合成商品数据，检查任务映射、超时、缓存键、数据分类、成本策略和 fallback：

| Product AI 操作          | Gateway task     | 当前生产调用覆盖                          | 必须验证                            |
| ------------------------ | ---------------- | ----------------------------------------- | ----------------------------------- |
| product_identification   | complex_analysis | Crawler 初筛、China-market 候选判断       | 身份、系列、型号与证据字段          |
| image_analysis           | image_analysis   | 商品图片、China-market 图像比对、物流估算 | 多图、OCR、证据、敏感图片门         |
| price_judgement          | market_analysis  | AnalysisService 采购判断                  | 仅用输入事实、不得虚构价格          |
| title_parsing            | classification   | China-market 中文检索词生成               | SKU、角色、版本、数量               |
| automatic_classification | classification   | Crawler 分类/复核与商品翻译整理           | 分类字段 schema、证据和完整采购摘要 |
| translation              | translation      | 标题、详情和批量翻译                      | 日中完整性、专名、数字与长文本      |

### Gate 8：失败与 fallback

用 mock/测试代理注入 400、401、402、403、404、408、413、422、429 和 5xx，验证错误分类、Key 隔离、模型冷却、Provider fallback、deadline 和不重复副作用。真实 Provider 不应用故意的高并发触发 429。

### Gate 9：额度与费用

读取官方 dashboard 或白名单 usage/rate-limit 元数据，记录计划、账户范围、预算和 observed reset。禁止根据模型名中的 free、历史促销或目录出现来推断零成本。

### Gate 10：泄漏扫描与验收签名

扫描日志、测试制品、缓存、追踪、错误监控和 Git diff。状态按凭据、模型和能力分别记录：当前成功项保留实测证据；429、402、evaluation-only 和 OCR 待复测项不得被 Provider 的其他成功项覆盖。

## 6. 安全的最小请求模板

模板中的尖括号是运行时环境变量占位，不能替换进文档或日志。

### OpenAI-compatible 目录

    GET <BASE_URL>/models
    Authorization: Bearer <PROVIDER_API_KEY>
    Accept: application/json

### OpenAI-compatible 最小文本

    POST <BASE_URL>/chat/completions
    Authorization: Bearer <PROVIDER_API_KEY>
    Content-Type: application/json

    {
      "model": "<MODEL_ID_FROM_LIVE_CATALOG>",
      "messages": [{"role": "user", "content": "Reply exactly OK."}],
      "temperature": 0,
      "max_tokens": 8
    }

SenseNova 当前应用适配器把 <code>max_tokens</code> 转换为 <code>max_completion_tokens</code>。必须通过 token-domain 的实际 canary 验证这一 request shape，不能从 SenseCore 公共平台的原生 API 推导。

### OpenAI-compatible Vision / OCR

    {
      "model": "<LIVE_VERIFIED_VISION_MODEL>",
      "messages": [{
        "role": "user",
        "content": [
          {"type": "text", "text": "Return JSON with objects, colors, count, sku and exact visible text."},
          {"type": "image_url", "image_url": {"url": "<SYNTHETIC_TEST_IMAGE_DATA_OR_URL>"}}
        ]
      }],
      "temperature": 0,
      "max_tokens": 128
    }

### Anthropic 上游最小文本

    POST https://api.anthropic.com/v1/messages
    x-api-key: <ANTHROPIC_API_KEY>
    anthropic-version: 2023-06-01
    Content-Type: application/json

    {
      "model": "<MODEL_ID_FROM_LIVE_CATALOG>",
      "max_tokens": 8,
      "messages": [{"role": "user", "content": "Reply exactly OK."}]
    }

### Gemini native 可选对照

当前应用走 OpenAI compatibility。只有定位兼容层差异时，才用 native 对照：

    POST https://generativelanguage.googleapis.com/v1beta/models/<MODEL_ID>:generateContent
    x-goog-api-key: <GEMINI_API_KEY>

    {"contents":[{"parts":[{"text":"Reply exactly OK."}]}]}

native 成功、compatibility 失败时，当前应用仍应判为失败，直到应用路径被明确修改和验证。

## 7. 当前 Provider 总览

| Provider    | 应用路径                    | Base URL                                                                          | 鉴权                | 模型发现                                                 | 视觉/OCR 当前结论                                                                                         |
| ----------- | --------------------------- | --------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| LiteLLM     | 直接 runtime / 上游 Gateway | 部署自有；应用默认 <code>http://litellm:4000/v1</code>                            | Bearer virtual key  | <code>/v1/models</code>；管理面 <code>/model/info</code> | 仅 vision、ocr alias 完成上游映射和 canary 后                                                             |
| B.AI        | 直接                        | <code>https://api.b.ai/v1</code>                                                  | Bearer 或 x-api-key | <code>GET /models</code>                                 | 按具体模型；当前配置含 vision candidates                                                                  |
| Gemini      | 直接 compatibility          | <code>https://generativelanguage.googleapis.com/v1beta/openai</code>              | Bearer              | <code>GET /models</code>                                 | 按模型；项目级配额                                                                                        |
| Groq        | 直接 compatibility          | <code>https://api.groq.com/openai/v1</code>                                       | Bearer              | <code>GET /models</code>                                 | 仅生产可用且实测支持图片的模型                                                                            |
| SiliconFlow | 直接 CN                     | <code>https://api.siliconflow.cn/v1</code>                                        | Bearer              | <code>GET /models</code>                                 | 仅 VLM；CN Key 不跨区猜测                                                                                 |
| Cerebras    | 直接                        | <code>https://api.cerebras.ai/v1</code>                                           | Bearer              | <code>GET /models</code>                                 | Gemma 4 vision Public Preview；当前 URL transport 已本地排除，未来 Data URI 路径受 2 图/10 MB/canary 门控 |
| Cloudflare  | 直接                        | <code>https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1</code>     | Bearer + Account ID | account-scoped model search                              | Llama Vision 与 Gemma 4 均为当前图像候选，逐模型 canary                                                   |
| Cohere      | 直接 compatibility          | <code>https://api.cohere.ai/compatibility/v1</code>                               | Bearer              | native <code>GET /v1/models?endpoint=chat</code>         | 按模型；同时受 Trial/生产授权门控制                                                                       |
| NVIDIA      | 直接 hosted                 | <code>https://integrate.api.nvidia.com/v1</code>                                  | Bearer              | 动态 API Catalog + 精确 NIM reference                    | 文本路由已配置；Riva 是共享 Chat translation 候选，仍受目录/canary/Trial/生产授权门控                     |
| SenseNova   | 直接 token-domain           | <code>https://token.sensenova.cn/v1</code>                                        | Bearer              | 认证 <code>GET /models</code>                            | 6.8 文本与图像理解候选已配置；视觉/OCR 分别 canary                                                        |
| OpenRouter  | 直接聚合                    | <code>https://openrouter.ai/api/v1</code>                                         | Bearer              | <code>GET /models</code>                                 | 用 modalities 与实际 canary 双重门控                                                                      |
| OpenAI      | LiteLLM 上游                | <code>https://api.openai.com/v1</code>                                            | Bearer              | <code>GET /models</code>                                 | Responses 支持图片；按模型                                                                                |
| Anthropic   | LiteLLM 上游                | <code>https://api.anthropic.com</code>                                            | x-api-key + version | <code>GET /v1/models</code>                              | Messages 按 capability metadata 与模型                                                                    |
| DeepSeek    | LiteLLM 上游                | OpenAI: <code>https://api.deepseek.com</code>；Anthropic: <code>/anthropic</code> | Bearer              | <code>GET /models</code>                                 | 只给官方目录明确支持的 vision ID                                                                          |

## 8. Provider 官方规则与验收判据

### 8.0 14 个平台的官方规则矩阵（规则核验截止 2026-09-01）

下表把“能否发请求”与“能否进入本项目生产路由”分开。`unknown` 是官方公开资料或当前账户证据不足，不是免费、无限或已授权的同义词。模型目录、价格、促销和能力都属于动态数据，**没有可长期编码的静态清单**；每次目录刷新仍须和成本、数据、商用及 capability gate 求交集。

| 平台                   | Base URL / 鉴权                                                                                                          | 官方免费、试用或活动（截至核验日）                                                                                                                                              | 数字额度或余额规则                                                                                                                                                                                                                                       | 凭据/账户作用域与重置                                                                                                                                              | 付费/商用门                                                                     | 数据边界（本项目默认）                                                                                                   | 生命周期、目录与能力证据                                                                                                                                                   | 官方入口                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LiteLLM                | 自部署 `http://litellm:4000/v1`；Bearer virtual key；master key 仅管理面                                                 | Gateway 本身无免费额度、试用金或模型授权                                                                                                                                        | 无统一额度；费用和限额继承实际上游，数值 `unknown`                                                                                                                                                                                                       | virtual key、部署实例及上游账户；由上游 reset，未统一承诺                                                                                                          | 由实际上游和本项目成本策略决定；Gateway 不授予商用权                            | 受 Gateway 日志/脱敏配置和实际上游政策双重约束                                                                           | 固定 Gateway 版本；`/v1/models`、`/model/info` 与上游目录定期刷新；alias 能力必须逐项 canary                                                                               | [docs](https://docs.litellm.ai/)、[virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys)、[health](https://docs.litellm.ai/docs/proxy/health)                                                                                                                                                                                                                                                                          |
| B.AI                   | `https://api.b.ai/v1`；Bearer 或 `x-api-key`                                                                             | 零 Credit 限时活动：`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`hy3`、`mimo-v2.5`、`glm-5.3-flash`、`qwen3.8-flash`；活动结束日期未公开，注册/充值 Bonus Credits 另计 | 预付换算为 `1 USD = 1,000,000 Credits`；官方未承诺通用 RPM/TPM；Bonus Credits 自发放起 30 天到期                                                                                                                                                         | 目录按 credential 可见；活动资格按账户；reset、并发和总额度 `unknown`                                                                                              | 预付 Credits、账户资格和条款；活动不是永久免费或生产承诺                        | 官方稳定 retention/training 合同未在本次核验中确认；仅发送 `public_market`                                               | `/models`、模型页和促销页是动态证据；404 或 capability 400 触发刷新                                                                                                        | [API](https://docs.b.ai/llmservice/api/)、[pricing](https://docs.b.ai/llmservice/pricing-and-usage/)、[promotions](https://docs.b.ai/llmservice/promotions-and-pricing-notices/)                                                                                                                                                                                                                                                |
| OpenAI                 | `https://api.openai.com/v1`；Bearer                                                                                      | 无通用免费模型清单；可能有账户专属 grant；预付余额自购买起 1 年到期                                                                                                             | 组织/项目/模型/usage tier 相关；稳定公开基线和 reset `unknown`；以 usage 与限流头为准                                                                                                                                                                    | 组织、项目、模型和 tier；由响应 `x-ratelimit-reset-*` 或账户页决定                                                                                                 | 需 Billing/Usage 和相应模型权限；免费 grant 不等于生产商用                      | API 输入/输出默认不用于训练，除非 opt-in；abuse logs 通常最长 30 天，按 endpoint 可能不同                                | `/v1/models`、snapshot、deprecations 和实际 Responses/Chat capability 共同证明                                                                                             | [Models](https://platform.openai.com/docs/api-reference/models)、[rate limits](https://platform.openai.com/docs/guides/rate-limits)、[data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)                                                                                                                                                                                                |
| Anthropic              | `https://api.anthropic.com`；`x-api-key` + `anthropic-version`                                                           | 无永久免费模型；新用户可能有账户专属少量 trial                                                                                                                                  | Token bucket 持续补充；Start `$500`、Build `$1,000`、Scale `$200,000` 月度 spend cap                                                                                                                                                                     | 组织级，workspace 可进一步收紧；月度 cap 在每月 1 日 00:00 UTC 恢复                                                                                                | Commercial Terms、usage tier 和 spend limit；trial 不自动代表生产授权           | 未经明确许可不用于训练；ZDR 需另行安排                                                                                   | Models API capability、Deprecated/Retired 页和 Messages canary；deprecated 后禁新路由                                                                                      | [Models](https://platform.claude.com/docs/en/api/models/list)、[rate limits](https://platform.claude.com/docs/en/api/rate-limits)、[deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)                                                                                                                                                                                                          |
| DeepSeek               | `https://api.deepseek.com` 或 `/anthropic`；Bearer                                                                       | 无通用免费 API 额度                                                                                                                                                             | 官方公布并发限制：Flash 2,500、Pro 500、Flash-Vision-Exp 2,500；该页未说明统一 RPM/TPM 单位或窗口，账户总额度和 reset `unknown`                                                                                                                          | 账户级并发，不按 Key；同账户换 Key 不增加额度；reset `unknown`                                                                                                     | 需余额和开放平台条款；聚合商中的 DeepSeek 名称不代表直连授权                    | 直连数据政策和账户授权需单独确认；本项目默认公开资料                                                                     | 当前目录为 `deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`；`deepseek-chat`/`deepseek-reasoner` 于 2026-07-24 停用；以 `/models` 和 updates 为准    | [API docs](https://api-docs.deepseek.com/)、[models](https://api-docs.deepseek.com/api/list-models)、[rate limit](https://api-docs.deepseek.com/quick_start/rate_limit)、[pricing](https://api-docs.deepseek.com/quick_start/pricing/)、[updates](https://api-docs.deepseek.com/updates/)                                                                                                                                       |
| Gemini Developer API   | native `https://generativelanguage.googleapis.com/v1beta`（`x-goog-api-key`）；compatibility `/v1beta/openai/`（Bearer） | 见下方完整免费模型清单；Gemma 4 免费条目 ID 随目录变化                                                                                                                          | 项目级 RPM、TPM、RPD 等动态；RPD 每日太平洋时间午夜重置；Tier 1/2/3 滚动 10 分钟 spend ceiling `$10`/`$50`/`$200`，月度 billing cap Tier 1 `$250`、Tier 2 `$2,000`、Tier 3 `$20,000–$100,000`                                                            | project 而非 Key；同项目多 Key 不叠加；AI Studio Limits 是最终值                                                                                                   | Free/Paid tier、Billing、地区和模型资格；免费层内容可用于改进 Google 产品       | Free tier 仅 `public_market`；Paid tier 内容不用于改进产品（仍遵守项目数据门）                                           | native Models API 的 actions/limits、compatibility `/models`、stable/preview/experimental 和 deprecations 共同决定                                                         | [pricing](https://ai.google.dev/gemini-api/docs/pricing)、[rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)、[billing](https://ai.google.dev/gemini-api/docs/billing)、[deprecations](https://ai.google.dev/gemini-api/docs/deprecations)                                                                                                                                                                        |
| GroqCloud              | `https://api.groq.com/openai/v1`；Bearer                                                                                 | Free Plan 按模型静态表（详见下方）；GPT-OSS、Whisper、Compound 可生产，Qwen/Guard/Orpheus 为 preview/evaluation                                                                 | 典型 Free：GPT-OSS、Qwen3.6、Qwen3.8 为 30 RPM、1K RPD、8K TPM、200K TPD；Compound 30 RPM、250 RPD、70K TPM；Prompt Guard 30 RPM、14.4K RPD、15K TPM、500K TPD；Orpheus 10 RPM、100 RPD、1.2K TPM、3.6K TPD；Whisper 20 RPM、2K RPD、7.2K ASH、28.8K ASD | 组织级、按模型；project 只能降低上限；`retry-after` 和 `x-ratelimit-reset-*` 给出 observed reset；额外 Key/组织不得规避                                            | Free/Developer/生产模型资格和 pay-as-you-go；preview 不作为公开生产主路由       | 默认不保留推理内容；可靠性/滥用调查日志可最长 30 天；ZDR 需配置                                                          | `/models`、模型 lifecycle、Projects 和 rate-limit headers；Production 与 Preview 分开验收                                                                                  | [models](https://console.groq.com/docs/models)、[rate limits](https://console.groq.com/docs/rate-limits)、[your data](https://console.groq.com/docs/your-data)、[deprecations](https://console.groq.com/docs/deprecations)                                                                                                                                                                                                      |
| SiliconFlow            | 当前 CN `https://api.siliconflow.cn/v1`；Bearer（global host 另算新凭据）                                                | 不复制旧静态免费清单；`tencent/Hunyuan-MT-7B` 虽显示零价但已 Deprecated，`Qwen/Qwen2.5-7B-Instruct` 当前输入/输出各 `$0.05/M`，两者都不能当作当前免费候选                       | 通用 L0–L5 RPM/TPM：`1,000/40K`、`1,200/60K`、`2,000/80K`、`4,000/160K`、`8,000/500K`、`10,000/2M`；具体模型维度和免费有效期 `unknown`                                                                                                                   | 账户级、逐模型；429 可能命中 RPM/RPH/RPD/TPM/TPD/IPM/IPD；reset 无稳定公开值                                                                                       | 实名、账户等级、模型价格和地区；CN Key 不跨区猜测                               | 稳定 retention/training 公共合同未确认；仅发送公开市场资料                                                               | `/models`、模型详情页、区域、lifecycle、价格及 `Pro/` 状态共同决定；Deprecated 或非零价格立即退出免费路由                                                                  | [models](https://docs.siliconflow.com/en/api-reference/models/get-model-list)、[rate limits](https://docs.siliconflow.com/en/userguide/rate-limits/rate-limit-and-upgradation)、[vision](https://docs.siliconflow.com/en/userguide/capabilities/vision)                                                                                                                                                                         |
| Cerebras Cloud         | `https://api.cerebras.ai/v1`；Bearer                                                                                     | 新账户添加已验证付款方式后可获得 `$5` Free Trial，授予后 30 天到期；不是可续的永久 Free tier                                                                                    | Free Trial 每组织/模型：`gpt-oss-120b`、`gemma-4-31b` 各 5 RPM、30K TPM、1M TPH、1M TPD；Developer：GPT-OSS 1M TPM/1K RPM，Gemma 500K TPM/300 RPM                                                                                                        | 组织/模型；分钟、小时、日窗口按 Limits；当前 402 是 2026-08-31 的余额/试用耗尽观测                                                                                 | credits、账户计划及控制台要求；无 credits 停止请求，不重试                      | 按官方隐私政策和账户合同；本项目授权未知，默认公开资料                                                                   | authenticated `/v1/models` 与 public catalog、Versions、实际 Chat canary；Gemma 4 vision 仅支持 PNG/JPEG Data URI，Free Trial 最多 2 图、总计 10 MB，且处于 Public Preview | [pricing](https://www.cerebras.ai/pricing)、[rate limits](https://inference-docs.cerebras.ai/support/rate-limits)、[models](https://inference-docs.cerebras.ai/api-reference/models/public-models)、[image inputs](https://inference-docs.cerebras.ai/capabilities/image-inputs)                                                                                                                                                |
| Cloudflare Workers AI  | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`；Bearer token + Account ID                            | 无独立免费模型表；符合条件的目录模型共用每日 allocation；部分模型必须 billing                                                                                                   | 账户共享 `10,000 Neurons/day`，每日 00:00 UTC 重置；Paid overage `$0.011/1,000 Neurons`                                                                                                                                                                  | Account-scoped；Account ID 与 token 必须一致；allocation 按账户重置                                                                                                | 付费 overage 必须显式允许；Kimi/GLM/DeepSeek 指定模型需 billing                 | 未经明确同意不用于训练/改进；只有显式使用存储服务才存储内容                                                              | models catalog、account search（当前只取前 100）、limits 和 changelog；`@cf/google/gemma-4-26b-a4b-it` 明确支持 vision/function calling/reasoning，仍需图像 canary         | [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)、[models](https://developers.cloudflare.com/workers-ai/models/)、[Gemma 4](https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/)、[limits](https://developers.cloudflare.com/workers-ai/platform/limits/)                                    |
| Cohere                 | compatibility `https://api.cohere.ai/compatibility/v1`；Bearer；native `/v1`                                             | Evaluation key 免费且仅评估；新 Command 变体通常 1,000 calls/month；A+、Reasoning、Translate、Vision trial 20 RPM；A/R/R+/R7B/North Mini Code trial 20 RPM、production 500 RPM  | 试用月调用上限 1,000；RPM 见左；月度 reset 时刻 `unknown`，以账户 Limits 为准                                                                                                                                                                            | key type/account/model；production 与 trial 分开；具体 reset `unknown`                                                                                             | SaaS/条款确认、contact sales 和敏感用途 review；未授权不进公开生产              | Trial prompt/output 可用于 R&D，禁止个人信息；Enterprise 通常日志 30 天，可申请 opt-out/ZDR                              | native `/v1/models?endpoint=chat` 的 `is_deprecated`、compatibility canary、going-live 条款                                                                                | [rate limits](https://docs.cohere.com/v2/docs/rate-limits)、[list models](https://docs.cohere.com/v2/reference/list-models)、[enterprise data](https://cohere.com/enterprise-data-commitments)                                                                                                                                                                                                                                  |
| NVIDIA NIM hosted      | `https://integrate.api.nvidia.com/v1`；Bearer                                                                            | Hosted API Trial；无稳定公开免费模型表、credit 数或通用 quota                                                                                                                   | RPM/TPM/日额度 `unknown`；读取账户状态和 observed 429                                                                                                                                                                                                    | 账户/endpoint；reset `unknown`；hosted trial 不因换 Key 获得额外额度                                                                                               | Trial 仅内部测试/评估；生产流量和生成内容需 subscription；否则 blocked          | Trial 条款允许使用 User/Generated Content 改进产品/模型，禁止机密、敏感或个人数据；通常会话结束不保留，但有安全/滥用例外 | `/v1/models`、NIM endpoint 文档、Trial Terms；Riva Translate 当前使用共享 `/v1/chat/completions`；hosted 与自托管是不同 Provider                                           | [LLM APIs](https://docs.api.nvidia.com/nim/reference/llm-apis)、[models](https://integrate.api.nvidia.com/v1/models)、[Riva Translate](https://docs.api.nvidia.com/nim/re/reference/nvidia-riva-translate-4b-instruct-v2-infer)、[Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)                                                                        |
| SenseNova token-domain | `https://token.sensenova.cn/v1`；Bearer                                                                                  | Token Plan 公示 `¥0/月`、`Free·公测`，属于限时/限量 public beta；不得与 SenseCore 公共 API 混用                                                                                 | 公共页写 `60,000 points/5h`；账户控制台另显示通用池与 Flash-Lite 池各 `60,000 points/5h`、滚动周 `600,000`；早期 `1,500 calls/5h` 单位冲突，不能换算                                                                                                     | 账户级共享池：同一账户所有 API Key 共用 quota（`shared_account_pool`）；Flash-Lite 先扣专属窗口再扣通用池；bonus 按账户快照小时结算、30 天到期；reset 以控制台为准 | 公测/付费计划与生产授权需按账户条款确认；bonus 不自动解锁权限；默认不进公开生产 | 稳定 retention/training 合同未确认；默认 `public_market`，私人数据需单独授权                                             | token-domain `/models`、当前账户目录和精确 endpoint canary 共同决定；6.7 兼容重定向已过期，6.8 有容量/429 风险；U1.5/U1 Fast 图像走专用 API，不走 Chat                     | [Token Plan](https://www.sensenova.cn/token-plan)、[developer docs](https://platform.sensenova.cn/docs)、[OpenSenseNova skill](https://github.com/OpenSenseNova/SenseNova-Skills/blob/main/skills/sn-image-base/SKILL.md)、[SenseCore compatibility](https://www.sensecore.cn/help/docs/model-as-a-service/nova/overview/compatible-mode)、[terms](https://www.sensecore.cn/help/docs/model-as-a-service/nova/legaldoc/service) |
| OpenRouter             | `https://openrouter.ai/api/v1`；Bearer；Referer/Title 仅归因                                                             | `:free` 变体和 `openrouter/free` 零价但动态；无购买 credits 时免费模型 50 requests/day，累计购买至少 `$10` credits 后 1,000/day                                                 | 日免费额度 50/1,000；当前官方页面未稳定显示 RPM 和 reset 时刻，均 `unknown`；路由上游另有约束                                                                                                                                                            | 全局/账户级；额外 Key 或账户不提升全局限额；按官方日窗口和账户状态                                                                                                 | credits、BYOK、上游商业与模型条款；free 仅低保障，不作生产 SLA                  | OpenRouter prompt/response 默认不存储；上游 Provider 数据政策仍适用，可用 ZDR/provider filters                           | `GET /models` 提供 pricing、modalities、parameters、expiry；`:free` 池和 routed provider 动态，每日刷新                                                                    | [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)、[limits](https://openrouter.ai/docs/api/reference/limits)、[free variants](https://openrouter.ai/docs/guides/routing/model-variants/free)、[privacy](https://openrouter.ai/docs/guides/privacy/data-collection)                                                                                                                                   |

Cerebras 官方 FAQ 说明新账户添加已验证付款方式后可获得 `$5` Free Trial，授予后 30 天到期并可用于 public models；本项目仍要求当前账户 `/v1/models`、Limits、credits 和精确能力 canary 同时通过，不能仅凭 `$5` 文案激活路由。

#### 动态清单中的当前免费/活动模型（仅作核验输入，不得直接变成永久 allowlist）

- **B.AI 零 Credit 活动（限时）：**`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`hy3`、`mimo-v2.5`、`glm-5.3-flash`、`qwen3.8-flash`。Bonus Credits（含注册/充值赠送）发放后 30 天到期；活动资格、结束时间和结算以账户页面为准。
- **Gemini Free tier（2026-08-28 官方价格页核验）：**`gemini-3.7-flash`、`gemini-3.6-flash`、`gemini-3.5-flash`、`gemini-3.5-live-translate-preview`、`gemini-3.5-transcribe-live`、`gemini-3.5-transcribe`、`gemini-3.5-flash-lite`、`gemini-3.1-flash-lite`、`gemini-3.1-flash-live-preview`、`gemini-3.1-flash-tts-preview`、`gemini-3-flash-preview`、`gemini-2.5-pro`、`gemini-2.5-flash`、`gemini-2.5-flash-lite`、`gemini-2.5-flash-native-audio-preview-12-2025`、`gemini-2.5-flash-preview-tts`、`gemini-embedding-2`、`gemini-embedding-001`、`gemini-robotics-er-2-preview`、`gemini-robotics-er-2-streaming-preview`、`gemini-robotics-er-1.6-preview`。Gemma 4 的免费条目以当天目录 ID 为准，不复制成静态清单。
- **SiliconFlow 当前排除项：**旧免费清单不得继续使用。<code>tencent/Hunyuan-MT-7B</code> 的模型页虽显示零输入/输出价格，但生命周期为 Deprecated，已从当前 catalog/router 删除；<code>Qwen/Qwen2.5-7B-Instruct</code> 当前输入和输出均为 `$0.05/M tokens`，代码标记为 paid。其他模型也必须同时满足当前区域目录在线、生命周期有效、价格为零和账户资格，才能进入免费池。
- **Groq Free Plan：**完整数值表见 [rate limits](https://console.groq.com/docs/rate-limits)；Qwen3.8-27B 当前公开 TPD 为 `200K`，账户 Limits 仍是该凭据的最终值。
- **Cloudflare、Cerebras、Cohere、NVIDIA、OpenRouter、LiteLLM、OpenAI、Anthropic、DeepSeek、SenseNova：**没有可安全当作“永久免费模型清单”的统一静态列表；使用上表的账户、账单、条款、目录和 canary 证据。

Groq 当前 Free Plan 表的可复核快照如下。它是核验输入，不是绕过组织级 Limits 的承诺；`-` 表示该维度在官方表中未列出。

| 模型 ID                                                                      | RPM |   RPD |  TPM |  TPD |  ASH |   ASD | 生产状态                   |
| ---------------------------------------------------------------------------- | --: | ----: | ---: | ---: | ---: | ----: | -------------------------- |
| `canopylabs/orpheus-arabic-saudi`                                            |  10 |   100 | 1.2K | 3.6K |    - |     - | preview/evaluation         |
| `canopylabs/orpheus-v1-english`                                              |  10 |   100 | 1.2K | 3.6K |    - |     - | preview/evaluation         |
| `groq/compound`、`groq/compound-mini`                                        |  30 |   250 |  70K |    - |    - |     - | production                 |
| `meta-llama/llama-prompt-guard-2-22m`、`meta-llama/llama-prompt-guard-2-86m` |  30 | 14.4K |  15K | 500K |    - |     - | preview/evaluation         |
| `openai/gpt-oss-120b`、`openai/gpt-oss-20b`、`openai/gpt-oss-safeguard-20b`  |  30 |    1K |   8K | 200K |    - |     - | production（以模型页为准） |
| `qwen/qwen3.6-27b`                                                           |  30 |    1K |   8K | 200K |    - |     - | preview/evaluation         |
| `qwen/qwen3.8-27b`                                                           |  30 |    1K |   8K | 200K |    - |     - | preview/evaluation         |
| `whisper-large-v3`、`whisper-large-v3-turbo`                                 |  20 |    2K |    - |    - | 7.2K | 28.8K | production（语音端点）     |

公开表只是高层摘要；实际验证与并发控制始终以当前账户 Limits 和响应限流元数据为准。

#### Vercel AI SDK 与 Vercel AI Gateway 的边界（不计入上述 14 个 Provider）

- **AI SDK 不是 Provider、免费额度或商业授权。**它只是统一的 TypeScript 调用抽象；`generateText`、`streamText` 或 provider package 的成功，不改变上游 Key 的费用、数据和条款。
- **当前代码没有使用 Vercel AI Gateway 的默认字符串解析。**已安装 `ai@7.0.87` 与 `@ai-sdk/openai-compatible@3.0.41`；代码显式创建 `createOpenAICompatible({ name: "litellm", ... })`，传入 LiteLLM 的模型对象并调用 `generateText`，且 `maxRetries: 0`。因此本项目当前验证的是 LiteLLM 路径，不是 Vercel AI Gateway。Vercel 的每团队每月 `$5` Free Tier Credits 只覆盖官方 eligible 模型子集，不是全目录免费。
- **若启用 Vercel AI Gateway，必须当成新的边界：**单独注入 `AI_GATEWAY_API_KEY`（或按官方 OIDC 方式部署），重新核验 Gateway catalog、模型 capability、计费、数据处理、条款、限流和 fallback；Vercel Gateway 的健康或目录成功不能覆盖 LiteLLM/直连 Provider 的失败证据。当前 BYOK 文档还说明：BYOK credential 失败时会自动回退到 Vercel 系统凭据并消耗 Gateway Credits，且该回退目前不能关闭；因此没有显式费用授权时不能把 BYOK 失败交给 Gateway 静默兜底。
- 官方参考：[AI SDK docs](https://ai-sdk.dev/docs)、[AI SDK providers](https://ai-sdk.dev/providers)、[Vercel AI Gateway](https://vercel.com/docs/ai-gateway)、[Vercel Gateway BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)。

### 8.1 LiteLLM Gateway

- <strong>Base URL / Authentication：</strong>由本项目部署决定。应用用 Bearer virtual key 访问 OpenAI-compatible <code>/v1/chat/completions</code>。master key 只用于管理和签发受限 virtual key。
- <strong>Model discovery：</strong>应用可见别名用 <code>GET /v1/models</code>；管理和成本元数据用 <code>GET /model/info</code>。当前项目约定 fast、smart、vision、ocr 四个稳定别名。
- <strong>Minimal text：</strong>先对 fast 与 smart 各做一次最小请求。响应必须能证明实际上游 provider/model；一个别名成功不能证明其 fallback 链上的所有上游 Key 成功。
- <strong>Vision / OCR：</strong>vision 与 ocr 必须分别通过合成图片 canary，并确认实际落到支持图片的上游模型。不能因别名名称推断能力。
- <strong>Rate limit / errors：</strong>LiteLLM 把上游错误映射到 OpenAI-compatible 类别，并支持 retry、fallback、cooldown。应用必须同时区分 Gateway 自身故障和上游故障。
- <strong>Free / trial：</strong>LiteLLM 不提供任何上游免费额度；费用、配额、数据和商用权利由实际上游决定。
- <strong>Production：</strong>官方生产指南建议使用 Secret Manager、禁用 dotenv、配置超时、数据库/Redis 和一致的多副本限流，并固定版本。应用使用受限 virtual key，不使用 master key。
- <strong>Health：</strong><code>/health/readiness</code> 只看代理就绪；<code>/health</code> 会真实请求模型并可能收费。
- <strong>Official sources：</strong>[LiteLLM docs](https://docs.litellm.ai/)、[virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys)、[model management](https://docs.litellm.ai/docs/proxy/model_management)、[health](https://docs.litellm.ai/docs/proxy/health)、[production](https://docs.litellm.ai/docs/proxy/prod)、[reliability](https://docs.litellm.ai/docs/proxy/reliability)。

### 8.2 B.AI

- <strong>Base URL / Authentication：</strong><code>https://api.b.ai/v1</code>；Bearer 或 <code>x-api-key</code>。
- <strong>Model discovery：</strong><code>GET /models</code> 返回当前凭据可见目录。目录是候选集合，不是 capability contract。
- <strong>Minimal text：</strong>当前应用使用 <code>POST /chat/completions</code>；官方同时提供 Responses 与 Anthropic Messages。验收必须走应用实际协议。
- <strong>Vision / OCR：</strong>只对官方模型页声明图像输入、实时目录存在且合成图 canary 成功的模型开启。DeepSeek 的 text 与 vision 型号不能互换。
- <strong>Rate limit：</strong>官方没有承诺稳定的通用 RPM/TPM 或限流响应头。429 与 5xx 使用有界指数退避、抖动和降低并发。
- <strong>Error contract：</strong>400、401、403、404、413、429、500、502、503；401 隔离 Key，403 检查账户/权限，404 刷新目录，413 缩小请求。
- <strong>Free / trial：</strong>当前零 Credit 活动覆盖 <code>deepseek-v4-flash</code>、<code>deepseek-v4-flash-vision-exp</code>、<code>hy3</code>、<code>mimo-v2.5</code>、<code>glm-5.3-flash</code> 和 <code>qwen3.8-flash</code>；B.AI 预付换算为 <code>1 USD = 1,000,000 Credits</code>，Bonus Credits（注册或充值赠送）发放后 30 天到期。活动资格、结束时间与结算必须按账户页面实时核验，不能编码为永久免费。
- <strong>Production / lifecycle：</strong>按当前账户与平台条款使用；模型和促销页面必须定期复核。每次 404 或 capability 400 都触发目录刷新。
- <strong>Official sources：</strong>[API reference](https://docs.b.ai/llmservice/api/)、[pricing and usage](https://docs.b.ai/llmservice/pricing-and-usage/)、[promotions and pricing notices](https://docs.b.ai/llmservice/promotions-and-pricing-notices/)。

### 8.3 OpenAI（LiteLLM 上游）

- <strong>Base URL / Authentication：</strong><code>https://api.openai.com/v1</code>；Bearer。
- <strong>Model discovery：</strong><code>GET /v1/models</code>。目录仍需与模型文档、项目权限和实际 endpoint capability 结合。
- <strong>Minimal text：</strong>新开发优先使用 Responses API；如果 LiteLLM alias 使用 Chat Completions，则必须对那个实际协议单独验证。
- <strong>Vision / OCR：</strong>Responses 可用 image URL、data URL 或 file ID 传入 <code>input_image</code>；只有支持图像输入的模型才可路由。
- <strong>Rate limit：</strong>记录 <code>x-ratelimit-limit-_</code>、<code>x-ratelimit-remaining-_</code>、<code>x-ratelimit-reset-\*</code> 和 <code>x-request-id</code>。配额按组织、项目、模型与 usage tier 变化。
- <strong>Error contract：</strong>区分认证、请求、限流、额度和服务端错误；429 可能是速率也可能是 quota/billing，不能盲目重试。
- <strong>Free / commercial：</strong>没有通用免费 API 模型清单；账户专属 grant 只能以 Billing/Usage 页面为准，预付 credits 自购买起 1 年到期。API 数据默认不用于训练，除非客户主动 opt in；默认 abuse monitoring logs 最长保留 30 天，ZDR/MAM 需要资格与配置。
- <strong>Lifecycle：</strong>生产模型应固定 snapshot 并有 evals；持续检查官方 deprecations，不能长期依赖浮动别名。
- <strong>Code boundary：</strong>当前应用 registry 不读取 <code>OPENAI_API_KEY</code>；必须通过 LiteLLM alias 显式映射并验证上游归因。
- <strong>Official sources：</strong>[Models API](https://platform.openai.com/docs/api-reference/models)、[API reference](https://platform.openai.com/docs/api-reference)、[rate limits](https://platform.openai.com/docs/guides/rate-limits)、[error codes](https://platform.openai.com/docs/guides/error-codes)、[deprecations](https://platform.openai.com/docs/deprecations)、[data controls by endpoint](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)。

### 8.4 Anthropic（LiteLLM 上游）

- <strong>Base URL / Authentication：</strong><code>https://api.anthropic.com</code>；<code>x-api-key</code> 加 <code>anthropic-version: 2023-06-01</code>。
- <strong>Model discovery：</strong><code>GET /v1/models</code>。当前 Models API 可返回 image、PDF、structured output 等 capability metadata；仍需精确模型 canary。
- <strong>Minimal text：</strong><code>POST /v1/messages</code>，最小 <code>max_tokens</code>，固定无敏感 prompt。
- <strong>Vision / OCR：</strong>按 Messages vision 规范和具体模型能力测试；目录文本能力不能推导图片能力。
- <strong>Rate limit：</strong>429 携带 <code>retry-after</code>，并提供 <code>anthropic-ratelimit-\*</code>。限制按组织/工作区、usage tier、RPM、ITPM 和 OTPM 计算，token bucket 持续补充；月度 spend cap 在每月 1 日 00:00 UTC 恢复。
- <strong>Error contract：</strong>400、401、402、403、404、409、413、429、500、504、529。529 表示 overloaded，应冷却并 fallback；402 停止该账户。
- <strong>Free / commercial：</strong>没有永久免费 API 模型；新用户可能收到少量账户专属 trial。生产使用受 Commercial Terms 与 Usage Policy 约束；Start/Build/Scale 的公开月度 spend cap 分别为 <code>$500</code>、<code>$1,000</code>、<code>$200,000</code>，组织和工作区的 spend limit 也必须通过。
- <strong>Lifecycle：</strong>官方区分 Deprecated 与 Retired，并公布迁移期限。模型进入 deprecated 后应禁止新增路由，retired 前完成替换。
- <strong>Code boundary：</strong>当前应用 registry 不读取 <code>ANTHROPIC_API_KEY</code>；LiteLLM 必须把 OpenAI-compatible alias 正确翻译成 Messages，并保留能力语义。
- <strong>Official sources：</strong>[Messages](https://platform.claude.com/docs/en/api/messages/create)、[Models](https://platform.claude.com/docs/en/api/models/list)、[rate limits](https://platform.claude.com/docs/en/api/rate-limits)、[errors](https://platform.claude.com/docs/en/api/errors)、[model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)、[vision](https://platform.claude.com/docs/en/build-with-claude/vision)、[authentication](https://platform.claude.com/docs/en/manage-claude/authentication)。

### 8.5 DeepSeek（LiteLLM 上游）

- <strong>Base URL / Authentication：</strong>OpenAI-compatible <code>https://api.deepseek.com</code>；Anthropic-compatible <code>https://api.deepseek.com/anthropic</code>；Bearer。
- <strong>Model discovery：</strong><code>GET /models</code>。只使用当前目录返回的 ID，不从旧示例或其他聚合商复制模型名。
- <strong>Minimal text：</strong><code>POST /chat/completions</code>，并通过 LiteLLM alias 记录实际上游归因。
- <strong>Vision / OCR：</strong>当前官方目录可包含文本和实验性 vision 型号。图片只能发送给明确支持 vision 的 ID；实验型号不能自动进入生产主路由。
- <strong>Rate limit：</strong>官方 Models & Pricing 表公布的是账户级并发限制：Flash 2,500、Pro 500、Flash-Vision-Exp 2,500；该表未说明统一 RPM/TPM 单位或 reset 窗口。限制不是按 Key，429 时切换同账户 Key 没有意义，也不得用于规避限制。
- <strong>Error contract：</strong>400、401、402（余额不足）、422、429、500、503。402 立即停用该账户路由；422 修正请求；500/503 有界 retry/fallback。
- <strong>Free / commercial：</strong>以实时价格、余额和账户页为准。开放平台允许在符合服务条款、用途、标识、内容和安全规则的前提下集成，不能把聚合平台授权等同于直连授权。
- <strong>Lifecycle：</strong>当前官方目录包含 <code>deepseek-v4-flash</code>、<code>deepseek-v4-pro</code> 和 <code>deepseek-v4-flash-vision-exp</code>；<code>deepseek-chat</code> 与 <code>deepseek-reasoner</code> 已于 2026-07-24 停用。模型会升级、改别名或停用；持续查看 updates/changelog，目录 404 时立即撤出静态 allowlist。
- <strong>Code boundary：</strong>当前应用 registry 不读取 <code>DEEPSEEK_API_KEY</code>。B.AI、OpenRouter 或 SiliconFlow 中带 DeepSeek 名称的模型是不同计费和故障域，不能证明直连 DeepSeek Key 成功。
- <strong>Official sources：</strong>[API docs](https://api-docs.deepseek.com/)、[list models](https://api-docs.deepseek.com/api/list-models)、[chat completion](https://api-docs.deepseek.com/api/create-chat-completion/)、[rate limit](https://api-docs.deepseek.com/quick_start/rate_limit)、[errors](https://api-docs.deepseek.com/quick_start/error_codes/)、[pricing](https://api-docs.deepseek.com/quick_start/pricing/)、[updates](https://api-docs.deepseek.com/updates/)、[Open Platform Terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)。

### 8.6 Google Gemini

- <strong>Base URL / Authentication：</strong>native 为 <code>https://generativelanguage.googleapis.com/v1beta</code>，使用 <code>x-goog-api-key</code>；OpenAI compatibility 为 <code>https://generativelanguage.googleapis.com/v1beta/openai/</code>，使用 Bearer。
- <strong>Model discovery：</strong>native Models API 返回 supported actions 与上下文元数据；compatibility 的 <code>/models</code> 适合验证当前应用路径，但不是完整能力表。
- <strong>Minimal text：</strong>先验证应用使用的 compatibility path；必要时以 native <code>generateContent</code> 做差异诊断。
- <strong>Vision / OCR：</strong>支持 URL、base64 或 file 的方式随 API 与模型而变。只给明确支持 image 的模型，分别验证对象理解和精确 OCR。
- <strong>Rate limit：</strong>配额按 project，不按 Key，常见维度为 RPM、TPM、RPD 与 Spend；RPD 在太平洋时间午夜重置。Tier 1/2/3 滚动 10 分钟 spend ceiling 分别为 <code>$10</code>、<code>$50</code>、<code>$200</code>，月度 billing cap 为 Tier 1 <code>$250</code>、Tier 2 <code>$2,000</code>、Tier 3 <code>$20,000–$100,000</code>；模型 RPM/TPM/RPD 仍以 AI Studio 当前 Limits 为准。429 是 <code>RESOURCE_EXHAUSTED</code>。
- <strong>Error contract：</strong>按 Google API 的 400、403、404、429 和 5xx 语义分类；429/5xx 使用有界指数退避。不要依赖未承诺的通用 reset header。
- <strong>Free / commercial：</strong>Free tier 的内容可用于改进 Google 产品；Paid tier 内容不用于改进产品。免费/付费能力和价格逐模型变化，必须查当前项目 Billing 与 AI Studio。
- <strong>Lifecycle：</strong>stable、preview、experimental 的生产资格不同；官方 deprecations/shutdown 页面是淘汰依据。
- <strong>Code decision：</strong>当前代码使用 OpenAI compatibility。模型 ID 必须通过当前项目目录验证；项目级限流意味着增加同项目 Key 不会增加 quota。
- <strong>Official sources：</strong>[Models API](https://ai.google.dev/api/models)、[generateContent](https://ai.google.dev/api/generate-content)、[OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)、[rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)、[API errors](https://ai.google.dev/gemini-api/docs/generate-content/api-errors)、[troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)、[pricing](https://ai.google.dev/gemini-api/docs/pricing)、[deprecations](https://ai.google.dev/gemini-api/docs/deprecations)、[terms](https://ai.google.dev/gemini-api/terms)。

### 8.7 GroqCloud

- <strong>Base URL / Authentication：</strong><code>https://api.groq.com/openai/v1</code>；Bearer。
- <strong>Model discovery：</strong><code>GET /models</code> 返回账户当前可见模型；必须再看模型页的 lifecycle 与能力。
- <strong>Minimal text：</strong><code>POST /chat/completions</code>。Groq 对部分不支持的 OpenAI 字段会返回 400，不能假设兼容层会忽略。
- <strong>Vision / OCR：</strong>只有目录存在、模型页支持图片且实际 canary 通过的模型才可用。Preview 视觉模型只作评估或受控 fallback，不能作为生产主路由。
- <strong>Rate limit：</strong>按组织和模型限制。Free Plan 当前表中的 GPT-OSS、Qwen3.6 与 Qwen3.8 均为 30 RPM、1K RPD、8K TPM、200K TPD；Compound 为 30 RPM、250 RPD、70K TPM；Prompt Guard、Orpheus 和 Whisper 使用各自模型行。账户 Limits 仍是当前凭据的最终值。官方响应头包括 <code>retry-after</code>、<code>x-ratelimit-limit-_</code>、<code>x-ratelimit-remaining-_</code>、<code>x-ratelimit-reset-\*</code>；应精确消费。
- <strong>Error contract：</strong>400、401、403、404、413、422、424、429、498、499、500、502、503。424 可能是上游/工具依赖失败；498/499 按官方语义记录，不归类为普通 5xx。
- <strong>Free / commercial：</strong>免费计划按组织与模型限额，账户 Limits 页面权威。禁止用多账户或多组织编排规避限制。
- <strong>Lifecycle：</strong>Production 模型才可作为生产主路由；Preview 用于评估。弃用页会给 shutdown date 和 replacement。
- <strong>Official sources：</strong>[API reference](https://console.groq.com/docs/api-reference)、[models](https://console.groq.com/docs/models)、[rate limits](https://console.groq.com/docs/rate-limits)、[errors](https://console.groq.com/docs/errors)、[deprecations](https://console.groq.com/docs/deprecations)、[billing FAQ](https://console.groq.com/docs/billing-faqs)、[services agreement](https://console.groq.com/docs/legal/services-agreement)、[AI policy](https://console.groq.com/docs/legal/ai-policy)。

### 8.8 SiliconFlow

- <strong>Base URL / Authentication：</strong>全球官方示例为 <code>https://api.siliconflow.com/v1</code>；当前应用明确配置中国区 <code>https://api.siliconflow.cn/v1</code>；Bearer。
- <strong>Model discovery：</strong><code>GET /models</code>，可按 text、image、audio、video 过滤。必须以 Key 所属区域的目录为准，不能把 global Key 与 CN host 混用或跨区猜测。
- <strong>Minimal text：</strong><code>POST /chat/completions</code>。模型 ID 大小写、命名空间和 <code>Pro/</code> 前缀必须与实时目录完全一致。
- <strong>Vision / OCR：</strong>VLM 支持 image URL 或 base64；只对实时目录中的 VLM 发送图片。静态 vision 页面可能落后于目录，因此仍要做合成图和 OCR canary。
- <strong>Rate limit：</strong>按账户、逐模型实施，维度可含 RPM、RPH、RPD、TPM、TPD、IPM、IPD。429 信息会指出命中维度；没有稳定通用响应头契约。
- <strong>Error contract：</strong>400 参数/模型，401 Key，403 权限/实名，429 限额，500 服务错误，503/504 容量或节点。403 不重试；503/504 有界 fallback。
- <strong>Free / commercial：</strong>免费资格必须同时满足实时模型页零输入/输出价格、在线 lifecycle、账户资格与区域目录。<code>tencent/Hunyuan-MT-7B</code> 虽显示零价但已 Deprecated；<code>Qwen/Qwen2.5-7B-Instruct</code> 当前为输入/输出各 `$0.05/M tokens`，不是免费模型。有效限额可能变化，不能从旧名单推断免费或生产商用权利。
- <strong>Lifecycle：</strong>模型会下线、改能力或调整价格。Hunyuan-MT 已从当前静态 allowlist 和 translation 路由删除；目录刷新后仍须对 price、tools、JSON 和 vision 分别复核/canary。
- <strong>Code decision：</strong>保持 CN Base URL，除非运营方明确确认 Key 属于 global 区域。<code>Qwen/Qwen2.5-7B-Instruct</code> 在 catalog 中标为 paid，只能通过允许付费的成本策略；任何区域迁移都要当成新 Provider/新 credential 验收。
- <strong>Official sources：</strong>[list models](https://docs.siliconflow.com/en/api-reference/models/get-model-list)、[OpenAI-compatible use](https://docs.siliconflow.com/en/usercases/use-siliconcloud-in-chatbox)、[vision](https://docs.siliconflow.com/en/userguide/capabilities/vision)、[Hunyuan-MT-7B](https://www.siliconflow.com/models/tencent-hunyuan-mt-7b)、[Qwen2.5-7B-Instruct](https://www.siliconflow.com/models/qwen2-5-7b-instruct)、[rate limits](https://docs.siliconflow.com/en/userguide/rate-limits/rate-limit-and-upgradation)、[error codes](https://docs.siliconflow.com/en/faqs/error-codecopy)、[rate-limit FAQ](https://docs.siliconflow.com/en/faqs/misc_rate)。

### 8.9 Cerebras Cloud

- <strong>Base URL / Authentication：</strong><code>https://api.cerebras.ai/v1</code>；Bearer。
- <strong>Model discovery：</strong><code>GET /v1/models</code> 返回凭据可见模型；公共目录可辅助理解生命周期和能力，但不能替代凭据目录。
- <strong>Minimal text：</strong><code>POST /v1/chat/completions</code>。当前应用对 Cerebras 加 JSON Object request shape，必须用实际模型验证。
- <strong>Vision / OCR：</strong><code>gemma-4-31b</code> 当前通过 Chat Completions 提供 image input Public Preview，并已进入应用 image_analysis 候选。只接受 PNG/JPEG Base64 Data URI，不支持外部图片 URL；Free Trial 单请求最多 2 张图片，图片总 payload 不超过 10 MB。必须在发送前完成 provider-specific 编码、MIME/数量/大小校验，并对 V 与 O 分别执行 canary；普通 HTTPS 图片 URL 不能原样转发给 Cerebras。
- <strong>Rate limit：</strong>按组织、项目和模型，维度包括 RPM、RPH、RPD、TPM、TPH、TPD。响应提供日请求和分钟 token 的 <code>x-ratelimit-\*</code> 信息，应只记录官方字段。
- <strong>Error contract：</strong>400、401、402、403、404、422、429、500、503。官方 SDK 默认会对连接、408、429 和 5xx 重试两次；应用总重试次数必须与 SDK/Gateway 合并计算，防止重试放大。
- <strong>Free / commercial：</strong>新账户添加已验证付款方式后可获得 `$5` Free Trial，授予后 30 天到期；它不是可续的永久 Free tier。试用额度耗尽或到期会停止 API/Playground 并可能返回 402，在 credits/订阅恢复前停止该账户请求，不做重复 retry；模型和精确限制仍以账户 Limits 为准。
- <strong>Lifecycle：</strong>API validation 行为会随版本变化，持续检查 Versions 与模型目录。
- <strong>Code decision：</strong>catalog 已把 <code>gemma-4-31b</code> 标为 text+image，router 已把它加入 image_analysis；这只建立静态候选。当前 Gateway 只接受安全的公网 HTTPS 图片 URL，并通过 <code>URL_IMAGE_INCOMPATIBLE_MODELS</code> 在候选阶段本地排除 <code>cerebras:gemma-4-31b</code>，不会把不兼容的外部 URL 发给 Provider。只有新增受控 Data URI transport 后，才可在真实凭据目录、credits、数量/大小 guard 与 Chat+image canary 全部通过时移除该阻塞。
- <strong>Official sources：</strong>[authentication](https://inference-docs.cerebras.ai/api-reference/authentication)、[list models](https://inference-docs.cerebras.ai/api-reference/models/list-models)、[chat completions](https://inference-docs.cerebras.ai/api-reference/chat-completions)、[image inputs](https://inference-docs.cerebras.ai/capabilities/image-inputs)、[rate limits](https://inference-docs.cerebras.ai/support/rate-limits)、[errors](https://inference-docs.cerebras.ai/support/error)、[pricing](https://inference-docs.cerebras.ai/support/pricing)、[versions](https://inference-docs.cerebras.ai/api-reference/versions)。

### 8.10 Cloudflare Workers AI

- <strong>Base URL / Authentication：</strong><code>https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1</code>；Bearer API token，Account ID 必须放在 URL 中并与 token 所属账户一致。
- <strong>Model discovery：</strong>官方 models catalog 为能力权威；当前代码使用 account-scoped <code>/ai/models/search</code>。Account ID 无效时在发请求前失败。
- <strong>Minimal text：</strong>OpenAI-compatible <code>POST /ai/v1/chat/completions</code>；原生调用为 <code>POST /ai/run</code>。当前应用必须先验证 compatibility path。
- <strong>Vision / OCR：</strong>当前 image_analysis 路由包含 <code>@cf/meta/llama-3.2-11b-vision-instruct</code> 与 <code>@cf/google/gemma-4-26b-a4b-it</code>。Gemma 4 官方模型页明确标注 vision、function calling 与 reasoning；两者仍都要通过 account-scoped 目录、兼容端点和合成图片 V/O canary，不能由文本成功外推图像成功。
- <strong>Rate limit：</strong>不同任务和模型限额不同，Beta 通常更低。错误可能包含 daily allocation exhausted 或 capacity exceeded；不要依赖未承诺的通用 reset header。
- <strong>Error contract：</strong>Cloudflare 还返回内部错误码。无模型/参数通常为 400，权限/付费为 403，另有 404、408、413、429。保留脱敏内部码有助于区分每日额度与容量。
- <strong>Free / commercial：</strong>Workers AI Free 与 Paid 计划当前共享每日 10,000 Neurons 免费分配，00:00 UTC 重置；Paid 超出后按 <code>$0.011/1,000 Neurons</code> 计费。<code>@cf/moonshotai/kimi-k2.6</code>、<code>@cf/moonshotai/kimi-k2.7-code</code>、<code>@cf/zai-org/glm-5.2</code>、<code>@cf/zai-org/glm-5.3</code>、<code>@cf/zai-org/glm-5.3-flash</code>、<code>@cf/deepseek-ai/deepseek-v4-flash-0731</code> 与 <code>@cf/deepseek-ai/deepseek-v4-pro-0813</code> 当前要求 billing。若没有显式 overage 授权，预算门必须 fail closed。
- <strong>Lifecycle：</strong>模型目录和 changelog 持续变化，不固定模型 ID。模型删除或 Beta 变化时重新跑能力 canary。
- <strong>Code decision：</strong><code>CLOUDFLARE_ACCOUNT_ID</code> 是必要身份，不可从 token 猜测。成本层级为 paid 时仍需显式 <code>CLOUDFLARE_AI_ALLOW_OVERAGE</code> 才能过付费门。
- <strong>Official sources：</strong>[REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)、[AI Gateway REST formats](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)、[pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[limits](https://developers.cloudflare.com/workers-ai/platform/limits/)、[errors](https://developers.cloudflare.com/workers-ai/platform/errors/)、[models](https://developers.cloudflare.com/workers-ai/models/)、[Gemma 4](https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/)、[changelog](https://developers.cloudflare.com/workers-ai/changelog/)。

### 8.11 Cohere

- <strong>Base URL / Authentication：</strong>OpenAI compatibility 为 <code>https://api.cohere.ai/compatibility/v1</code>；Bearer。当前应用可加 <code>X-Client-Name</code>，但它不代替鉴权。
- <strong>Model discovery：</strong>native <code>GET https://api.cohere.ai/v1/models?endpoint=chat</code>；读取模型能力和 <code>is_deprecated</code>。
- <strong>Minimal text：</strong>compatibility <code>POST /chat/completions</code>。目录与 native API 成功不等于 compatibility payload 成功。
- <strong>Vision / OCR：</strong>compatibility 支持图片的前提是具体模型支持；必须以合成图 canary 验证，不能把 Command 系列全部当作 vision。
- <strong>Rate limit：</strong>Trial 和 Production 限额不同。A+、Reasoning、Translate、Vision 的 trial 为 20 RPM；A/R/R+/R7B/North Mini Code 的 trial 为 20 RPM、production 为 500 RPM；新 Command 变体常见月度上限为 1,000 calls。月度 reset 时刻未公开，必须以账户与官方 limits 页核验。
- <strong>Error contract：</strong>400、401、402、403、404、422、429、498、499、500、501、503、504。402 停止账单路由，501 是功能未实现，不做相同 payload 重试。
- <strong>Free / commercial：</strong>Trial/evaluation Key 免费但仅用于评估；Production Key 付费。新 Command A 变体即使使用 Production Key，也可能仍需联系 sales 获得生产使用权。
- <strong>Lifecycle：</strong>模型目录的 <code>is_deprecated</code> 与 changelog 决定淘汰，不能只依赖静态 allowlist。
- <strong>Code decision：</strong>只有 <code>COHERE_INTERNAL_EVALUATION=true</code> 的非生产环境，或已确认 <code>COHERE_PRODUCTION_AUTHORIZED=true</code> 的生产环境才可激活；私有数据还需单独授权。
- <strong>Official sources：</strong>[Compatibility API](https://docs.cohere.com/docs/compatibility-api)、[list models](https://docs.cohere.com/v2/reference/list-models)、[errors](https://docs.cohere.com/v2/reference/errors)、[rate limits](https://docs.cohere.com/v2/docs/rate-limits)、[going live](https://docs.cohere.com/v1/docs/going-live)。

### 8.12 NVIDIA NIM hosted

- <strong>Base URL / Authentication：</strong><code>https://integrate.api.nvidia.com/v1</code>；Bearer。
- <strong>Model discovery：</strong>当前通用 LLM API reference 未确认一个适用于所有 hosted NIM 的通用 <code>GET /v1/models</code> 契约。使用动态 API Catalog 与精确 NIM reference；观测到的目录响应只算当前账户证据，不是通用官方保证。
- <strong>Minimal text / translation：</strong><code>POST /chat/completions</code>；必须对每个当前配置的 Nemotron chat candidate 做最小验证。<code>nvidia/riva-translate-4b-instruct-v2</code> 的当前官方 inference reference 也使用同一共享 Chat Completions endpoint，因此它是 translation 候选，不是专用协议排除项。
- <strong>Vision / OCR：</strong>部分 NIM endpoint 支持 OpenAI content parts，但当前应用 NVIDIA image_analysis 路由为空。若将来启用，必须按具体 multimodal NIM 文档建独立 capability canary。
- <strong>Rate limit：</strong>托管 catalog 没有稳定的通用 RPM/TPM/免费额度契约；记录当前账户状态和 429，使用模型级或账户级冷却。
- <strong>Error contract：</strong>具体 NIM 文档常列 200/202/422/500；运营层仍需识别 401、403、429、余额、Trial 权限与服务端错误。
- <strong>Free / commercial：</strong>Hosted API 默认受 NVIDIA API Trial Terms 约束，仅用于内部测试和评估，禁止把 Trial 服务或其生成内容用于生产。生产需要单独订阅，或自托管 NIM。
- <strong>Lifecycle：</strong>API Catalog 会变化；自托管与 hosted 是不同 Provider、不同条款和不同故障域，不能共用一次验收。
- <strong>Code decision：</strong>router 已把 Riva 放在 NVIDIA translation 候选首位，但仍需实时目录命中和精确 translation canary。Hosted Trial 只允许内部测试/评估；除非明确确认 subscription 并设置 <code>NVIDIA_PRODUCTION_AUTHORIZED=true</code>，NVIDIA（包括 Riva）都不得进入公开生产，私有数据还需独立授权。
- <strong>Official sources：</strong>[LLM APIs](https://docs.api.nvidia.com/nim/reference/llm-apis)、[Riva Translate inference](https://docs.api.nvidia.com/nim/re/reference/nvidia-riva-translate-4b-instruct-v2-infer)、[API Trial Terms PDF](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)、[deployment](https://docs.api.nvidia.com/nim/docs/deployment)。

### 8.13 SenseNova 日日新

- <strong>Base URL / Authentication：</strong>当前代码使用商汤官方 OpenSenseNova 示例中的 token-domain：<code>https://token.sensenova.cn/v1</code>；Bearer；Chat 为 <code>/chat/completions</code>，OpenAI-compatible。
- <strong>Model discovery：</strong>当前 Token Plan 官方文档确认认证 <code>GET /v1/models</code>。目录仍按账户与凭据动态发现，不能用营销套餐卡代替。
- <strong>Minimal text：</strong>2026-08-31，main 与 translation 两个 credential alias 使用 <code>sensenova-6.7-flash-lite</code> 均完成 HTTP 200 JSON completion，因此两项分别有历史成功证据；该模型不计入当前静态候选。
- <strong>Vision / OCR：</strong><code>sensenova-6.8-flash-lite</code> 官方确认支持图像理解，当前应用已将其配置为 image_analysis 候选；图像理解成功不等于 OCR 成功，两项仍需独立 canary，并受商业授权和数据门禁约束。U1 Fast 是图像生成模型，不属于 Chat Completions 候选。
- <strong>Rate limit / errors：</strong>当前账户证据已确认 main 与 translation 属于同一 <code>shared_account_pool</code>，所有 API Key 共用额度；Flash-Lite 先扣专属窗口再扣通用窗口。任一 429 都按账户范围冷却，绝不使用另一个 Key 绕过。公共页与账户页的 points/calls 单位不一致时保留 <code>unknown</code>，仅做有界退避，未经文档确认不依赖 header。
- <strong>Free / commercial：</strong>以 token-domain 账户、官方服务条款和实际套餐为准，不假设免费或生产权利。
- <strong>Lifecycle：</strong><code>sensenova-6.7-flash-lite</code> 仅保留为 2026-08-31 的历史成功证据；兼容重定向已过期，不能继续作为 2026-09-01 起的稳定默认。<code>sensenova-6.8-flash-lite</code> 在 2026-08-31 的探针中超时，只保留为目录/后续复测候选；<code>u1-fast</code> 在同日对当前 Chat 路径返回 404，不进入路由。
- <strong>平台消歧：</strong>SenseCore 公共平台的 OpenAI-compatible Base 为 <code>https://api.sensenova.cn/compatible-mode/v2</code>，原生模型目录是 <code>GET https://api.sensenova.cn/v1/llm/models</code>。这些端点、鉴权与 token-domain 不是可随意拼接的同一套 API。
- <strong>Official sources：</strong>[Token Plan](https://www.sensenova.cn/token-plan)、[Token Plan developer docs](https://platform.sensenova.cn/docs)、[SenseCore compatibility mode](https://www.sensecore.cn/help/docs/model-as-a-service/nova/overview/compatible-mode)、[service terms](https://www.sensecore.cn/help/docs/model-as-a-service/nova/legaldoc/service)。

### 8.14 OpenRouter

- <strong>Base URL / Authentication：</strong><code>https://openrouter.ai/api/v1</code>；Bearer。HTTP-Referer 与 X-Title 用于应用归因，不是认证替代。
- <strong>Model discovery：</strong><code>GET /models</code> 返回 modalities、supported parameters、pricing、context 与 expiry 等丰富元数据。先按能力过滤，再做实际 canary。
- <strong>Minimal text：</strong><code>POST /chat/completions</code>。必须记录实际 routed provider；同一 OpenRouter 模型切换上游后，数据、限流和失败可能改变。
- <strong>Vision / OCR：</strong>使用 OpenAI content parts；要求目录 input modalities 含 image，并对精确模型和当前上游做 canary。
- <strong>Rate limit：</strong>无 credits 购买时免费模型合计 50 requests/day，累计购买至少 <code>$10</code> credits 后为 1,000/day；当前官方页面未稳定公开通用 RPM 或 reset 时刻，记为 <code>unknown</code>。429 要按返回 error type 分类；免费模型限额、付费 credits、BYOK 和上游约束可能同时生效。
- <strong>Error contract：</strong>认证、credits、moderation、context、rate limit 和 upstream error 必须分开；模型 fallback 不可静默降低所需 tools、JSON 或 vision 能力。
- <strong>Free / commercial：</strong><code>:free</code> 与 <code>openrouter/free</code> 可为零成本，但低限额且可用性变化。无 Credits 购买时，官方 FAQ 当前说明免费模型为 50 requests/day；累计购买至少 10 美元 Credits 后为 1,000 requests/day。该规则仍需实时账户核验。
- <strong>Lifecycle：</strong>生产固定已验证模型和 fallback，不使用随机 free router 作为主路由。模型 expiry、价格和上游必须每日刷新。
- <strong>Code decision：</strong>2026-08-31，<code>minimax/minimax-m3:free</code> completion 为 200，<code>z-ai/glm-5.2:free</code> 为 429。该历史证据只代表探针时刻，不能由 <code>:free</code> 或 <code>modelIsFree</code> 推断生产可用性。
- <strong>Official sources：</strong>[quickstart](https://openrouter.ai/docs/quickstart)、[Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)、[models overview](https://openrouter.ai/docs/guides/overview/models)、[free variants](https://openrouter.ai/docs/guides/routing/model-variants/free)、[free router](https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground)、[FAQ](https://openrouter.ai/docs/faq)。

## 9. 当前 41 个模型候选的验证矩阵

以下来自当前 <code>ai-model-catalog.ts</code> 快照：LiteLLM 4、B.AI 6、OpenRouter 6、Gemini 3、Groq 4、SiliconFlow 4、Cerebras 2、Cloudflare 5、Cohere 3、NVIDIA 3、SenseNova 1，共 41 个当前静态候选。另有 1 个 <code>sensenova-6.7-flash-lite</code> 的 2026-08-31 历史成功证据，不属于当前静态目录，也不计入 41。首轮已确认所有直连凭据/别名的目录端点为 200，但只对“首轮实测”列明确点名的模型完成了 completion；不得把 2026-08-31 的凭据级目录成功外推为 41 个候选在 2026-09-01 全部成功。

能力缩写：T = 最小文本；J = JSON/schema；V = 视觉对象理解；O = OCR。V/O 只适用于当前路由声明图像输入的候选。

| Provider    | 当前候选模型或别名                                                                                                                                                      | 必须 canary                                                     | 2026-08-31 首轮实测与剩余门槛                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| LiteLLM     | fast；smart；vision；ocr                                                                                                                                                | fast/smart: T+J；vision/ocr: T+J+V+O                            | fast/smart T+J 200；vision 合成图对象/颜色/SKU 200；ocr 429 待复测；上游仍需独立归因                        |
| B.AI        | mimo-v2.5；glm-5.3-flash；deepseek-v4-flash-vision-exp；qwen3.8-flash；deepseek-v4-flash；hy3                                                                           | 进入 image route 的四个候选 T+J+V+O；其余 T+J                   | mimo T+J 200；其余候选和 vision/OCR 未逐项签名；promotion 仍需当天证据                                      |
| OpenRouter  | deepseek/deepseek-v4-flash；deepseek/deepseek-v4-flash-vision-exp；z-ai/glm-5.2:free；minimax/minimax-m3:free；nvidia/nemotron-3-ultra-550b-a55b:free；qwen/qwen3-coder | vision-exp: T+J+V+O；其余 T+J                                   | MiniMax T+J 200；GLM 429；其余候选与实际 routed upstream 待逐项验证                                         |
| Gemini      | gemini-3.5-flash-lite；gemini-flash-lite-latest；gemini-3.7-flash                                                                                                       | 3.7: T+J+V+O；其余 T+J                                          | 目录 200；两个候选 completion 均 429，配额恢复前没有 T/J 成功签名                                           |
| Groq        | openai/gpt-oss-20b；openai/gpt-oss-120b；qwen/qwen3.8-27b；groq/compound                                                                                                | qwen candidate: T+J+V+O；其余 T+J                               | GPT-OSS 20B T+J 200；其余模型及 V/O 待验证                                                                  |
| SiliconFlow | Qwen/Qwen2.5-7B-Instruct；Qwen/Qwen3-VL-8B-Instruct；deepseek-ai/DeepSeek-V4-Flash；Qwen/Qwen3-Coder-30B-A3B-Instruct                                                   | Qwen VL: T+J+V+O；其余 T+J                                      | Qwen 2.5 在 2026-08-31 T+J 200，但当前为 paid；Hunyuan-MT 已 Deprecated 并移出候选；其余待验证              |
| Cerebras    | gpt-oss-120b；gemma-4-31b                                                                                                                                               | GPT-OSS: T+J；Gemma: T+J；未来 V+O 需 Data URI/2 图/10 MB guard | 2026-08-31 目录 200、两个 completion 均 402；当前 URL transport 已本地排除 Gemma 图像，credits 恢复前不重试 |
| Cloudflare  | @cf/zai-org/glm-4.7-flash；@cf/google/gemma-4-26b-a4b-it；@cf/nvidia/nemotron-3-120b-a12b；@cf/openai/gpt-oss-120b；@cf/meta/llama-3.2-11b-vision-instruct              | Gemma/Llama vision: T+J+V+O；其余 T+J                           | Gemma 在 2026-08-31 仅 T+J 200，Gemma/Llama V/O 均待验证；继续受 account/overage 门控制                     |
| Cohere      | command-a-plus-05-2026；command-a-translate-08-2025；command-a-reasoning-08-2025                                                                                        | A+: T+J+V+O；其余 T+J                                           | A+ T+J 200，但仅 evaluation；V/O 和其他候选待验证                                                           |
| NVIDIA      | nvidia/nemotron-3-nano-30b-a3b；nvidia/nemotron-3-super-120b-a12b；nvidia/riva-translate-4b-instruct-v2                                                                 | Nemotron: T+J；Riva: 共享 Chat T+J+translation                  | Nano 在 2026-08-31 T+J 200，但仅 evaluation；Super/Riva 待验证，全部仍受 Trial/生产授权门控                 |
| SenseNova   | sensenova-6.8-flash-lite                                                                                                                                                | main 与 translation 各 T+J                                      | 当前候选 6.8 超时；6.7 仅有 2026-08-31 历史 T+J 200 证据且不计入当前候选；u1-fast Chat 404                  |

验证集合必须采用：

    live_catalog ∩ static_allowlist ∩ commercial_gate ∩ data_gate ∩ capability_canary

静态 allowlist 中但不在目录的模型记为 <code>CATALOG_MISSING</code>；目录中但未在 allowlist 的模型只进入观察列表，不能自动进入生产。

## 10. 统一错误分类与重试规则

| HTTP / 事件                 | 统一类别                                 | 默认动作                                 | 是否 retry                  |
| --------------------------- | ---------------------------------------- | ---------------------------------------- | --------------------------- |
| 缺变量                      | missing                                  | 不创建 runtime                           | 否                          |
| Base URL / Account ID 无效  | invalid_config                           | 修复配置，禁止请求                       | 否                          |
| 400 payload                 | invalid_request                          | 修正参数；可能触发 capability cache 失效 | 否                          |
| 400 capability/model        | unsupported_capability / model_not_found | 刷新目录，隔离模型                       | 否                          |
| 401                         | auth_invalid                             | 隔离该 credential alias，通知轮换        | 否                          |
| 402 或官方余额码            | credits_exhausted                        | 停止该账户付费请求                       | 否                          |
| 403                         | permission_denied                        | 检查项目、实名、计划、地区、生产授权     | 否                          |
| 404 endpoint                | endpoint_not_found                       | 检查 Base URL 与 API 版本                | 否                          |
| 404 model                   | model_not_found                          | 刷新目录并撤出路由                       | 否                          |
| 408 / timeout               | timeout                                  | 有界 retry，然后 fallback                | 是，最多策略上限            |
| 409                         | conflict                                 | 按 Provider 文档判断                     | 条件性                      |
| 413                         | payload_too_large                        | 缩图、分块、减上下文                     | 否，修改后新请求            |
| 422                         | invalid_request                          | 修正 schema 或字段                       | 否                          |
| 424                         | dependency_failed                        | 切依赖或 Provider                        | 条件性                      |
| 429                         | rate_limited / quota_exhausted           | 消费官方 reset；按账户范围冷却           | 是，但不得换同账户 Key 绕过 |
| 498 / 499                   | provider_specific_client_failure         | 保留官方子类，人工/策略处理              | 默认否                      |
| 500 / 502 / 503 / 504 / 529 | provider_5xx / overloaded                | 抖动退避、熔断、fallback                 | 是，有界                    |
| DNS / TLS / connection      | network                                  | 固定脱敏类别；检查网络                   | 是，有界                    |
| 2xx 但无文本                | empty_response                           | 隔离 model/request shape                 | 否                          |
| 2xx 但非预期 JSON           | invalid_json_output                      | 隔离 JSON capability                     | 否                          |

额外规则：

- Provider SDK、LiteLLM、应用 Gateway 和业务层的 retry 必须合并计算；总尝试次数不能相乘失控。
- 已执行有副作用的 tool call 后，不自动重放整个生成请求。
- OpenAI、Anthropic、Groq、Cerebras 的文档化限流头可白名单记录；其他 Provider 不依赖未承诺 header。
- 429 的作用域必须记录为 credential、account、project、organization、model 或 unknown。unknown 默认按更宽的 Provider/账户范围冷却。

## 11. 当前实现与剩余验收事项

### 已落实

1. <strong>安全 validator 已实现。</strong><code>pnpm ai:validate</code> 默认只做目录探针；只有显式 <code>--completion</code> 才发起可能计费的最小生成。它按 provider、credential alias 和 model 记录结果，不依赖业务 fallback 推断单项成功。
2. <strong>inactive 诊断不改变生产激活。</strong><code>--include-inactive</code> 只为当前诊断构建临时 runtime，绕过 evaluation/production activation switch；应用路由仍使用 fail-closed 的正常 runtime。
3. <strong>报告已脱敏。</strong>validator 不保留 Key、响应正文或完整 header，并有假 Key/错误响应测试；普通网络异常也已归一为固定消息，不再持久化任意底层 Error.message。
4. <strong>官方 host 已设安全门。</strong>Provider URL 默认只允许对应官方 host；自定义 endpoint 必须有显式授权环境变量。
5. <strong>六项 Product AI 已接入。</strong>Crawler、China-market、AnalysisService 与物流均通过 Product AI facade 或受保护的内部 Product AI endpoint 调用。
6. <strong>已知配置漂移已修复。</strong>环境示例已补齐 tier/data/authorization 字段；同步脚本保留 DeepSeek 上游 Key、恢复 LiteLLM-first order，并把 SenseNova 统一到 token-domain 与当前 6.8 候选；6.7 只保留历史证据。模型目录与账户状态仍需持续刷新，避免新增漂移。

### 当前 P0

以下 live blocker 均来自 2026-08-31 的脱敏观测；本文没有补做真实请求。官方规则和代码状态按 2026-09-01 截止证据解释这些观测。

1. <strong>Gemini 配额：</strong>目录 200、completion 429。先在当前 Google project 恢复 quota/usage tier，再复测文本、JSON 与 vision。
2. <strong>Cerebras credits 与图像 contract：</strong>2026-08-31 目录 200、两个 completion 402。充值或恢复 credits 前保持 Provider 不可路由，不做重复 retry；恢复后先复测文本/JSON。当前代码已把 Gemma 4 从外部 HTTPS 图片 transport 中本地剔除；若要真正启用其 image route，还必须补齐 PNG/JPEG Data URI 转换、2 图/10 MB 本地 guard 与 V/O canary。
3. <strong>LiteLLM OCR：</strong>首次合成图为 429。冷却后用同一固定图复测；在结果为 200 且 OCR 字段校验通过前，不标记 ocr alias 成功。
4. <strong>生产授权：</strong>Cohere A+ 与 NVIDIA Nano 的技术探针为 200，但当前只允许 evaluation。除非取得并记录生产合同/订阅，不进入公开生产池。
5. <strong>上游独立归因：</strong>LiteLLM alias 成功尚不能分别证明 OpenAI、Anthropic、DeepSeek Key。若这些 Key 是必须验收项，需要一对一 alias 或专用上游探针。
6. <strong>SenseNova 生命周期：</strong>Token Plan 的 6.7 兼容重定向只记录到 2026-08-31；自 2026-09-01 起不得继续把 6.7 当稳定默认。先从当前账户目录确认 6.8 或替代模型，并通过同一 Chat canary 后再切换。

### 当前 P1

1. <strong>单凭据成功不等于全模型成功。</strong>首轮只签名了明确列出的模型；41 个当前静态候选仍需按实际业务能力逐项收敛，6.7 的历史证据不能替代 6.8 的当前验收。
2. <strong>同一账户可能被重复撞击。</strong>Gemini/Groq 等 Key 若同时作为 LiteLLM 上游和应用直连，两个路径应共享 account/project limiter 与 circuit。
3. <strong>NVIDIA Riva 验收未完成。</strong><code>nvidia/riva-translate-4b-instruct-v2</code> 已通过共享 <code>/chat/completions</code> 进入 translation 候选，不再按专用协议排除；仍需实时目录命中、精确 translation canary、Trial 内部评估开关或已确认的生产订阅。技术成功不能绕过生产授权门。
4. <strong>Cloudflare 模型发现只取前 100 项。</strong>当前 account-scoped search 没有分页；目标模型不在第一页时可能被误判缺失。
5. <strong>默认 free_only 与 unknown tier 会形成空路由。</strong>Key、目录和 completion 成功都不自动改变成本等级；必须由运营证据定级。
6. <strong>多数路由没有协议级 structured output。</strong>除统一附加 JSON Object 的 Provider 外，其余主要依赖 prompt 后解析；每个业务模型仍需 J canary 和本地 schema 校验。
7. <strong>多 Key 必须有明确额度域。</strong>SenseNova runtime 已绑定 main/translation/secondary，并只允许跨已声明的独立账号组处理 402/429；其他直连 Provider 仍只绑定一个凭据变量。任何新增 Key 都需要显式别名、独立验收与已核实的限流域。

### 当前运行时 caveat（不是已完成项）

- 默认 Compose/`deploy.ps1` 不启用 LiteLLM 所在的 `ai-gateway` profile；只有显式 `--profile ai-gateway` 才会启动 Gateway。未启动时，应用会按成本和能力门控进入直连后备。
- Cloudflare account-scoped model search 当前只取前 100 项，没有分页；目标模型不在第一页时不能直接记为 `CATALOG_MISSING`。
- `free_only` 与 `unknown` 成本等级相交后可能产生空路由。目录 200 或 completion 200 都不会自动把模型标成免费，必须有当天账户/价格证据。
- 同一账户可能同时被 LiteLLM 上游和应用直连路径撞击；Gemini、Groq、SiliconFlow、Cloudflare 等必须共享 account/project limiter 与 circuit，不能靠多 Key 或多路径规避额度。
- SenseNova 当前账户证据确认 main 与 translation 共享 token-domain 账户 quota（`account-primary`）；任一 402/429 都会同时冷却这两个别名，不得用 main→translation 绕过。secondary 明确属于第二账号（`account-secondary`），可在主账号额度组受限时独立接续；它自己的额度错误不会冷却主账号。该能力不改变各账号条款，也不替代 secondary 的逐模型 live 验收。公共 points/calls 单位若发生冲突，保留 `unknown`，不做未经证实的换算。
- 模型 ID 在 catalog、router、环境示例、同步脚本与 Render 中仍有重复来源；每次变更都要跑交集非空测试，并把目录/价格快照与代码 revision 一起记录。

### P2：稳定性与成本优化

1. 每日刷新目录、价格、lifecycle 和 capability，404/429/capability 400 时立即失效缓存。
2. 为每个 workload 建经过验证的 provider/model fallback 链，不做随机 free 路由。
3. 记录 p50/p95 延迟、有效 token、schema 通过率、OCR 准确率、fallback 率和每成功任务成本。
4. 对 translation、classification 与历史补全使用批处理/低价模型；vision、复杂分析和诊断只在证据需要时升级。
5. LiteLLM 的 <code>drop_params</code> 行为不能代替 capability 判定；任何被丢弃但业务必需的字段都应让 canary 失败。
6. 当前重试需要加入 jitter，并建立共享 account/project/organization limiter，避免多个直连与聚合路由同步重试形成惊群。

## 12. 脱敏报告格式

每个 credential/model/capability 生成一行，不写 raw header、raw body、prompt、图片、完整 URL path、Key 前缀、Key 长度或 Key hash。

    {
      "runId": "opaque-run-id",
      "environment": "development|test|production",
      "provider": "provider-id",
      "credentialEnvironmentName": "ENV_NAME_ONLY",
      "credentialAlias": "provider/safe-alias",
      "present": true,
      "active": true,
      "activationReason": "ready",
      "apiTier": "free|promotion|paid|unknown",
      "baseHost": "official-host-only",
      "catalog": {
        "status": "success|failure|skipped",
        "httpStatus": 200,
        "modelCount": 0
      },
      "model": "model-id",
      "capability": "text|json|vision|ocr",
      "result": "success|failure|blocked|skipped",
      "failureCategory": null,
      "latencyMs": 0,
      "inputTokens": null,
      "outputTokens": null,
      "providerRequestId": null,
      "rateLimitScope": "credential|account|project|organization|model|unknown",
      "safeResetAt": null,
      "commercialGate": "allowed|evaluation_only|blocked|unknown",
      "dataGate": "public_only|private_allowed|blocked|unknown",
      "checkedAt": "ISO-8601",
      "sourceRevision": "git-revision"
    }

允许的最终状态：

- <code>NOT_CONFIGURED</code>
- <code>CONFIGURED_UNPROBED</code>
- <code>CATALOG_OK</code>
- <code>TEXT_OK</code>
- <code>CAPABILITY_OK</code>
- <code>LIVE_VERIFIED</code>
- <code>BLOCKED_AUTH</code>
- <code>BLOCKED_BILLING</code>
- <code>BLOCKED_POLICY</code>
- <code>BLOCKED_MODEL</code>
- <code>BLOCKED_RATE</code>
- <code>TRANSIENT_FAILURE</code>

报告聚合时，任何一个成功项都不能覆盖同一凭据的失败项。Provider 总状态取最严格的必需能力状态。

## 13. “完美成功调用”的完成定义

只有全部满足，才能对外宣称完成：

- 每个已配置 credential alias 都有独立记录；SenseNova main/translation/secondary 分开，secondary 已接入 runtime 但仍必须另行完成 live 验收，LiteLLM app key 与每个上游 Key 分开。
- 当前 41 个静态候选逐一得到目录命中、明确淘汰，或明确的成本、授权与 capability 阻塞结论，不能留作“应该能用”；SenseNova 6.7 的历史证据不计入当前候选验收。
- 每个目录命中的文本候选至少有一次最小 T canary；业务需要 JSON 的路由必须有 J canary。
- 每个 image route 候选分别通过 V 与 O；没有图像能力的 Provider 被本地拒绝，未发送请求。
- 六项 Product AI 操作都有端到端合成验收，并且每项都能在当前代码的生产调用路径或受保护内部 Product AI endpoint 中追溯；合成验收成功不替代逐模型、逐凭据 live 证据。
- 所有直接 Gateway 调用方与 Product AI facade 使用同一数据、成本、商用、目录和 capability gate。
- 401/402/403/404/429/5xx、超时和无效 JSON 的 mock 故障测试全部通过，且不会把一个 Provider 故障扩散为全站失败。
- Cohere/NVIDIA 的 Trial 与生产授权、Gemini Free/Paid 数据边界、Cloudflare overage、B.AI promotion、OpenRouter free 状态均有当前运营证据，并在到期或目录变化时自动降级为 `unknown`。
- 探针日志、数据库、错误监控、缓存、CI 制品和 Git diff 的 leak scan 为零发现。
- 结果包含时间、代码 revision、模型 ID、能力、账户作用域与失效时间；超过验证 TTL 或模型兼容重定向到期后自动退回 <code>CONFIGURED_UNPROBED</code>。

在这些条件完成之前，准确表述只能是：“Provider 官方规则已核验；部分凭据、模型或能力仍受配额、credits、生产授权、协议或冷却门阻塞，不能宣称全量成功。”
