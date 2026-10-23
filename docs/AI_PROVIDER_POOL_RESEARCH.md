# AI provider pool research

Accessed: 2026-09-01 (Asia/Tokyo)

Scope: Vercel AI Gateway, SenseNova Token Plan, B.AI (`api.b.ai`), OpenRouter, Google Gemini Developer API, GroqCloud API, SiliconFlow, Cerebras Cloud, Cloudflare Workers AI, Cohere, and NVIDIA NIM. This note uses first-party API references, provider documentation, pricing pages, and model catalogs only. No credential file or credential value was read while preparing it.

## Executive conclusions

- Treat model IDs, capability support, price, and quota as runtime data. Every provider changes models. OpenRouter and Cerebras expose useful public model metadata, but authenticated catalog discovery and a capability canary still decide route eligibility.
- Do not put one global RPM or TPM value on the pool. B.AI does not publish fixed numeric API limits; Gemini, Groq, SiliconFlow, Cerebras, Cloudflare, Cohere, NVIDIA, and OpenRouter each apply different account, model, plan, or routed-provider constraints.
- The safest zero-cost paths are for development and spillover, not production guarantees. OpenRouter explicitly says its free models are low-limit and not suitable for production. B.AI's free models are limited-time promotions. Groq and Gemini free service is quota restricted. SiliconFlow combines a small signup credit with selected fixed-limit free models. Vercel AI Gateway's monthly credit is a gateway allowance, not a free upstream model, and ends for an account after it purchases credits.
- SenseNova's Token Plan is a public beta/limited-release offer. Its public page and the supplied account console use different quota units, so neither may be silently converted into a request quota; an account-level read is required before enabling a route.
- Capability-gate every request. A model that accepts text must not automatically be assumed to accept images, tools, or JSON Schema. Reject locally when a route has not been verified for the required capabilities.
- On `429`, consume a provider's documented reset signal when one exists. Groq has a documented header contract. For the other providers, no stable retry-header contract was found in the cited official documentation, so use bounded exponential backoff with jitter and a circuit breaker. Do not automatically replay a request after a mutating tool has executed.

## Connection and discovery matrix

| Provider              | Production base URL                                                                                                                  | OpenAI compatibility                                                                  | Authentication                                                        | Model discovery                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Vercel AI Gateway     | `https://ai-gateway.vercel.sh/v1`                                                                                                    | OpenAI Chat Completions/Responses and Anthropic Messages through one endpoint         | `AI_GATEWAY_API_KEY` Bearer key, or Vercel OIDC on Vercel deployments | `GET https://ai-gateway.vercel.sh/v1/models`; catalog and pricing are dynamic and account/routing dependent                     |
| SenseNova Token Plan  | `https://token.sensenova.cn/v1`                                                                                                      | OpenAI-compatible Chat Completions for the Token Plan models                          | `Authorization: Bearer <API_KEY>`                                     | `GET https://token.sensenova.cn/v1/models` (credential/account scoped); do not mix with legacy SenseNova endpoints              |
| B.AI                  | `https://api.b.ai/v1`                                                                                                                | OpenAI Chat Completions and Responses; also Anthropic Messages                        | `Authorization: Bearer ...` or equivalent `x-api-key: ...`            | Authenticated `GET https://api.b.ai/v1/models`; the result is scoped to the current credential                                  |
| OpenRouter            | `https://openrouter.ai/api/v1`                                                                                                       | OpenAI Completions and Chat Completions; Responses is also available                  | `Authorization: Bearer ...`; app attribution headers are optional     | `GET https://openrouter.ai/api/v1/models`; rich metadata includes modalities, prices, context, supported parameters, and expiry |
| Gemini Developer API  | Native: `https://generativelanguage.googleapis.com/v1beta`; OpenAI layer: `https://generativelanguage.googleapis.com/v1beta/openai/` | OpenAI compatibility is beta and does not expose every native Gemini feature          | Native REST: `x-goog-api-key`; OpenAI layer: Bearer API key           | Native `GET /v1beta/models`; OpenAI layer `GET /v1beta/openai/models`                                                           |
| GroqCloud             | `https://api.groq.com/openai/v1`                                                                                                     | Mostly OpenAI compatible; unsupported fields can return `400`                         | `Authorization: Bearer ...`                                           | Authenticated `GET https://api.groq.com/openai/v1/models`                                                                       |
| SiliconFlow           | `https://api.siliconflow.com/v1`                                                                                                     | OpenAI-style Chat Completions, Completions, images, embeddings, and related endpoints | `Authorization: Bearer ...`                                           | Authenticated `GET https://api.siliconflow.com/v1/models`; optional `type` filter: `text`, `image`, `audio`, or `video`         |
| Cerebras Cloud        | `https://api.cerebras.ai/v1`                                                                                                         | OpenAI-compatible Chat Completions and Models                                         | `Authorization: Bearer ...`                                           | Authenticated `GET /v1/models`; public metadata at `GET https://api.cerebras.ai/public/v1/models`                               |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`                                                                   | OpenAI-compatible Chat Completions for compatible Workers AI models                   | `Authorization: Bearer ...` plus Account ID in the URL                | Account-scoped model search endpoint; the current Workers AI model catalog remains authoritative                                |
| Cohere                | `https://api.cohere.ai/compatibility/v1`                                                                                             | OpenAI Compatibility API for Chat Completions, tools, and structured outputs          | `Authorization: Bearer ...`                                           | Authenticated native `GET https://api.cohere.ai/v1/models?endpoint=chat`                                                        |
| NVIDIA NIM            | `https://integrate.api.nvidia.com/v1`                                                                                                | OpenAI-compatible Chat Completions for catalog LLMs                                   | `Authorization: Bearer ...`                                           | Use the dynamic API Catalog and each exact NIM reference; a universal hosted `GET /v1/models` contract is not confirmed         |

Sources: [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), [Vercel AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing), [AI SDK Gateway provider](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway), [SenseNova Token Plan](https://www.sensenova.cn/token-plan), [SenseNova developer docs](https://platform.sensenova.cn/docs), [SenseNova enterprise credit commitment](https://platform.sensenova.cn/statement.html), [B.AI API reference](https://docs.b.ai/llmservice/api/), [OpenRouter quickstart](https://openrouter.ai/docs/quickstart), [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models), [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Gemini native Models API](https://ai.google.dev/api/models), [Gemini authentication reference](https://ai.google.dev/api), [Groq OpenAI compatibility](https://console.groq.com/docs/openai), [Groq supported models](https://console.groq.com/docs/models), [SiliconFlow quickstart](https://docs.siliconflow.com/en/userguide/quickstart), [SiliconFlow List models](https://docs.siliconflow.com/en/api-reference/models/get-model-list), [Cerebras authentication](https://inference-docs.cerebras.ai/api-reference/authentication), [Cloudflare Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [Cohere Compatibility API](https://docs.cohere.com/docs/compatibility-api), [NVIDIA LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis).

## Vercel AI Gateway and AI SDK boundary

The Vercel AI Gateway is a routing and billing layer, not a model provider's free quota. AI SDK 7.0.87 includes the Gateway provider; the SDK itself is open-source and supplies a common interface, but it does not grant model access or credits. The `$5/month` Free Tier applies only to the current Free Tier eligible model subset, not the whole catalogue. Use the exact model ID from the current Gateway catalogue, or call `gateway.getAvailableModels()` at runtime. The model's provider page controls capability, price, retention, and terms.

The Gateway pricing page currently gives each Vercel team a `$5/month` AI Gateway credit allowance. The allowance begins with the first Gateway request and is available only until the team purchases credits; after a purchase the team is on the paid tier and the monthly free allowance no longer applies. Requests are charged at the provider list price (no Gateway token markup). BYOK removes Gateway markup but still requires the team to hold Gateway Credits. If a BYOK credential fails, the Gateway automatically falls back to system credentials and consumes Gateway Credits; the cited BYOK documentation says this fallback cannot currently be disabled. These are account and policy facts, not an upstream “free model” guarantee. [Vercel AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing), [BYOK](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)

Gateway routing supports provider `order`/`only`, model fallback arrays, per-provider timeouts, usage `user`/`tags`, request-scoped BYOK, and `zeroDataRetention`. Record the actual provider/model returned, token usage, and Gateway cost metadata. For sensitive requests, require an explicit ZDR/provider allowlist; Vercel's Gateway policy does not override upstream provider terms. Treat the free credit as `gateway_credit`, not `free_model`, and stop when the account balance or policy gate is unknown.

## SenseNova Token Plan

The Token Plan endpoint (`https://token.sensenova.cn/v1`) is a distinct service from the legacy `api.sensenova.cn/v1/llm/chat-completions`, SenseCore compatibility paths, and older image APIs. Keys, model IDs, quota, and terms must not be mixed across those endpoints. The Token Plan uses a Bearer API key and an account-scoped model catalogue. Refresh the catalogue before routing and prefer the currently listed `sensenova-6.8-flash-lite`, `sensenova-u1.5-lite`, `sensenova-u1-fast`, `deepseek-v4-flash`, and `glm-5.2` only when the current credential returns them and a capability canary passes.

The public Token Plan page fetched on 2026-09-01 describes a `Free · 公测` limited-release offer at `¥0/month`, advertises `60,000 积分 / 5 小时` (with special-model exceptions), allows at most 20 API Keys, and says paid tiers are forthcoming. The account overview text supplied by the user is account-specific evidence and explicitly states that all API Keys under the same account share that account's quota; adding Keys therefore increases neither the rolling-window nor weekly allowance. Record this as a known `account_key_scope=shared_account_pool`, not as an unknown. That account console separately reports rolling 5-hour/weekly `60,000` points pools for the general pool and a separate Flash-Lite pool. A separate/earlier public quota rendering has shown a “1,500 calls/5 hours” statement; its time, scope, and conversion to points cannot be established from the current page. These are different units and sources; preserve `public_quota_text`, `account_points_quota`, and `account_key_scope` as separate fields and do not convert points to calls without a provider-confirmed formula. [SenseNova Token Plan](https://www.sensenova.cn/token-plan)

Evidence reconciliation (as of 2026-09-01):

| Evidence source                                    | Observed rule                                                                                                                           | Classification and implementation consequence                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Current public Token Plan page                     | `¥0/month`, `60,000` points / 5 hours, special-model exception, limited release                                                         | `dynamic/public`; use for public offer text only, not an account quota or production SLA                               |
| User-supplied account overview                     | General and Flash-Lite pools each show `60,000` points / 5 hours and `600,000` / rolling week; all Keys in the account share the pools  | `account-specific/known`; set `account_key_scope=shared_account_pool` and aggregate all Keys before reserving quota    |
| User-supplied Token Plan documentation snapshot    | Flash-Lite dedicated→general deduction order; 1:1 bonus points, hourly settlement, 30-day expiry; permissions are not unlocked by bonus | `static snapshot`; apply only while the account's current console/notice agrees, and retain expiry/settlement metadata |
| Earlier/separate “1,500 calls / 5 hours” rendering | Request-count wording with no published points conversion                                                                               | `conflicting/unknown unit`; retain as an observation and never derive a request budget from it                         |

The 2026-08-28 account rule states that Flash-Lite consumes its dedicated rolling window before the general window, while other models use the general window. Actual dedicated-pool consumption is returned 1:1 as general bonus points: usage is aggregated by natural day, settled hourly, and the bonus expires after 30 days. Bonus points do not consume the rolling window and do not unlock model permissions. These rules are account/promotion state and may change. The August 31 service notice acknowledges failures, latency, and `429` responses for 6.8 Flash Lite during capacity expansion. Treat the service as `public_beta`, not a production SLA. The 6.7 compatibility redirect ended on 2026-08-31; as of 2026-09-01 it is expired and must not remain a stable default.

`sensenova-6.8-flash-lite` is a multimodal Chat Completions model with documented image understanding support. U1.5 Lite and U1 Fast are image-generation models that use dedicated image APIs rather than Chat Completions; their temporary image URLs have short lifetimes (about 24 hours and 1 hour respectively). `watermark=false` is free only during public beta and may become chargeable. Keep image generation separate from multimodal chat, and canary vision and OCR independently.

The published [SenseNova enterprise credit commitment](https://platform.sensenova.cn/statement.html) is a general legal/compliance statement (lawful operation, compliance with China's generative-AI rules, lawful training data, IP respect, safety, supervision, and complaint handling). It is not a Token Plan commercial license, data-processing agreement, production authorization, capacity promise, or SLA. Therefore default the route to `production_unknown`, `commercial_authorization_unknown`, and `private_data_unauthorized` until the applicable service terms and account contract are confirmed.

## B.AI

### API and model rules

B.AI exposes three protocols behind one credential: `/v1/chat/completions`, `/v1/responses`, and `/v1/messages`. The authenticated `/v1/models` response is the authoritative list of model IDs available to that credential. It does not publish a full machine-readable capability matrix, so protocol compatibility and features must be held in a provider-specific registry derived from the current model pages and verified by a non-billable or minimal probe before activation. Responses and Chat Completions expose tools and structured-output fields, but their availability depends on the selected model. [B.AI API reference](https://docs.b.ai/llmservice/api/)

Examples of current capability combinations:

- `qwen3.8-flash`: text, image, and video input; text output; function calling and structured output; 1M context. [B.AI Qwen3.8-Flash](https://docs.b.ai/llmservice/models/qwen3-8-flash/)
- `glm-5.3-flash`: text, image, video, and file input; text output; function calling, streamed tool calls, and JSON structured output; 1M context. Thinking is always enabled, with `low`, `high`, and `max` effort. [B.AI GLM-5.3-Flash](https://docs.b.ai/llmservice/models/glm-5-3-flash/)
- `mimo-v2.5`: text, image, video, and audio input; text output; function calling and structured output; 1M context. Preserve returned `reasoning_content` across thinking-mode tool turns. [B.AI MiMo-V2.5](https://docs.b.ai/llmservice/models/mimo-v2.5/)
- `deepseek-v4-flash`: text only, function calling, large context, optimized for high-volume text. [B.AI DeepSeek-V4-Flash](https://docs.b.ai/llmservice/models/deepseek-v4-flash/)

### Free credits and limits

B.AI is prepaid and uses Credits, with `1 USD = 1,000,000 Credits`. Free bonus Credits, including registration and top-up bonuses, expire 30 days after issue. Current official zero-Credit evidence covers only DeepSeek-V4-Flash, DeepSeek-V4-Flash-Vision-Exp, MiMo-V2.5, and Qwen3.8-Flash. Hy3 and GLM-5.3-Flash currently have only non-zero standard-price evidence, so they must not remain in a static promotion list. These offers publish no fixed end date and revert to standard pricing when the promotion ends. Final settlement is controlled by the platform display. None of these states may be encoded as a permanent free model. [B.AI pricing and usage](https://docs.b.ai/llmservice/pricing-and-usage/), [B.AI promotions](https://docs.b.ai/llmservice/promotions-and-pricing-notices/)

No official fixed RPM, TPM, RPD, or retry-reset values were found. The API reference documents `429` handling as exponential backoff plus reduced concurrency, but does not define `Retry-After` or `x-ratelimit-*` response headers. Discover available models per credential, obtain current account capacity and promotion state from the platform, and keep conservative local concurrency until measured. [B.AI API error and retry guidance](https://docs.b.ai/llmservice/api/)

The B.AI API documentation does not provide a general service-wide commercial license, data-processing addendum, or production SLA. Model pages can carry different upstream licenses: for example, some open-weight pages state MIT terms while others (such as MiniMax M2.7) state non-commercial weights and require a separate commercial agreement. Check the exact model/provider terms before public or resale use; API availability or a zero-Credit promotion is not proof of commercial authorization or private-data retention terms.

Safe use: use the current free Flash-class models for translation, classification, and noncritical image extraction while the promotion is active. Prefer `glm-5.3-flash` or `qwen3.8-flash` when vision, tools, or schema output is required. Do not route a vision job to `deepseek-v4-flash`. Use a paid, stronger text model or a verified Flash model at high reasoning effort for system diagnosis, with a second provider as fallback.

## OpenRouter

### API and model rules

OpenRouter is the easiest provider in this set to route dynamically. `/api/v1/models` exposes `architecture.input_modalities`, `architecture.output_modalities`, `supported_parameters`, pricing, context length, per-request limits when present, and expiration date. Filter on `supported_parameters=tools` or inspect `structured_outputs` and `response_format` before selecting a model. Image inputs use the OpenAI-style multipart message content for a vision-capable model. Tools and structured output are standardized across compatible models, but remain model and upstream-provider dependent. [OpenRouter models guide](https://openrouter.ai/docs/guides/overview/models), [image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding), [tool calling](https://openrouter.ai/docs/guides/features/tool-calling), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

The `openrouter/free` router filters the current free pool for required image understanding, tools, and structured output, then chooses a matching model at random. It is appropriate for experiments and low-volume fallback, but not for deterministic quality or production availability. A specific `:free` model variant gives model stability but retains low and variable availability. [OpenRouter Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)

An unauthenticated public-catalog read on 2026-09-01 verified that the three static free IDs configured by this repository—`minimax/minimax-m3:free`, `z-ai/glm-5.2:free`, and `nvidia/nemotron-3-ultra-550b-a55b:free`—all existed and reported both prompt and completion prices as zero. `openrouter/free` also existed and reported zero prices, but it is a dynamic router rather than a fourth static model. The configured DeepSeek V4, DeepSeek V4 Vision Exp, and Qwen3 Coder IDs existed with nonzero prices. This is a dated catalogue observation, not an availability or completion guarantee; refresh it before route activation. [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)

For production, use a curated paid model list plus the `models` fallback array. OpenRouter will also fail over among upstream providers for a model. Model fallbacks can trigger on rate limits, downtime, context errors, and moderation refusals. Require the needed parameters in routing rather than allowing a fallback that silently drops a tool or schema requirement. [OpenRouter model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

### Free credits and limits

- The Free plan is currently 50 requests per day across free models.
- After at least $10 in Credits has been purchased, the free-model daily allowance becomes 1,000 requests.
- New users receive a very small test allowance. Free models are explicitly described as low-limit and generally unsuitable for production.
- Credits are denominated in USD; OpenRouter reserves the right to expire unused purchased Credits after one year.

The current free-router guide additionally states 20 RPM and says failed attempts count against the daily free allowance. The FAQ and pricing page guarantee the daily allowance but do not publish a general TPM value or a stable paid-plan RPM, so retain the 20-RPM observation as dynamic documentation rather than a permanent contract. Paid throughput is a pooled routing concern and can also be governed by the chosen upstream or a BYOK provider. Do not use the deprecated `rate_limit` field returned by `GET /api/v1/key`; the API reference marks it safe to ignore. [OpenRouter Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router), [OpenRouter FAQ](https://openrouter.ai/docs/faq), [OpenRouter pricing](https://openrouter.ai/pricing), [current key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)

The API documents `429` responses and a `rate_limit_exceeded` error code, but no stable `Retry-After` or `x-ratelimit-*` response-header contract was found. Use bounded exponential backoff with jitter. Prefer OpenRouter's provider and model fallbacks before retrying the same route, and never replay a request whose tool call already caused a side effect. [OpenRouter Responses API](https://openrouter.ai/docs/api/api-reference/responses/create-responses)

Safe use: choose models at runtime from capability metadata. Sort low-cost models for translation and bulk classification, require `structured_outputs`, and pin a tested model in production. For image analysis, require `image` input plus text output. For seller or market analysis, require tools and use the current web-search server tool or an application-owned data function. For chat and diagnosis, use a curated quality tier with model fallbacks; do not use the random free router where consistent answers are required.

## Google Gemini Developer API

### API and model rules

Use the native Gemini API for full feature access. The OpenAI compatibility layer is still beta and Google notes that advanced native features can require extra mapping or be unavailable. Native model discovery returns model IDs, token limits, and supported actions. The OpenAI-compatible models endpoint is useful for SDK discovery but is not a complete capability registry. [Gemini partner integration guidance](https://ai.google.dev/gemini-api/docs/partner-integration), [Gemini Models API](https://ai.google.dev/api/models), [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)

Authentication needs near-term attention. Native calls use `x-goog-api-key`; the OpenAI layer accepts the API key as a Bearer token. Google now creates authorization keys by default, rejects unrestricted standard keys, and states that standard keys will be rejected in September 2026. Migrate any remaining standard key before that cutoff. [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)

Current routing anchors:

- `gemini-3.7-flash` is GA, accepts text, image, video, audio, and PDF, and outputs text. It supports function calling, structured outputs, search grounding, Maps grounding, URL context, code execution, and file search, with low, medium, and high thinking. [Gemini 3.7 Flash model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)
- `gemini-3.5-flash-lite` is the current cost-efficient routing anchor for high-volume agentic tasks, translation, and simple data processing. [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Model availability and deprecation change. Use stable IDs for production and check the deprecation page during catalog refresh. [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations)

### Free tier and limits

The Free tier provides no-charge input and output for selected models; `gemini-3.7-flash` currently has free-tier input and output, while some advanced models have no free API tier. Search and Maps grounding are unavailable on the 3.7 Flash Free tier. Free-tier content can be used to improve Google's products, while paid-tier content is not. Batch processing is generally paid-only. The paid-tier 3.7 Flash prices shown on 2026-09-01 are introductory through 2026-12-31; Google states that input and output prices double on 2027-01-01. Exact free and paid RPM, TPM, and RPD are no longer safe static constants: limits are per project rather than per key, vary by model and usage tier, and update with account status. RPD resets at midnight Pacific time. Preview and experimental models have tighter limits. Google directs clients to the live AI Studio limits page. [Gemini 3.7 Flash model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini billing](https://ai.google.dev/gemini-api/docs/billing)

The documented quota dimensions are RPM, input TPM, RPD, and sometimes model-specific IPM or TPD. Paid tiers may also have a rolling 10-minute spend cap. A limit violation returns `429 RESOURCE_EXHAUSTED`. No stable retry response header is promised in the cited API docs. Google's official SDKs automatically retry transient `429` and `5xx` errors with exponential backoff; the Python SDK is documented as up to four retries, about one second initially and at most 60 seconds. Direct REST clients should use exponential backoff, jitter, and bounded retries. [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [Gemini API errors](https://ai.google.dev/gemini-api/docs/generate-content/api-errors)

Safe use: route translation and simple classification to `gemini-3.5-flash-lite`; use paid Batch for large offline jobs. Route image analysis and general assistant work to the stable `gemini-3.7-flash`, normally with low or medium thinking. Use high thinking, tools, and structured output for system diagnosis. For seller or market analysis, use search grounding only when the selected tier permits it; the Free tier does not. Return citations and fall back to application-owned marketplace data tools when grounding is unavailable.

## GroqCloud

### API and model rules

Groq is mostly OpenAI compatible at `https://api.groq.com/openai/v1`; unsupported OpenAI fields return `400` rather than being silently ignored. The authenticated Models API lists active models, while feature selection still requires the current model pages. [Groq OpenAI compatibility](https://console.groq.com/docs/openai), [Groq API reference](https://console.groq.com/docs/api-reference), [Groq supported models](https://console.groq.com/docs/models)

Current useful capability anchors:

- `openai/gpt-oss-20b` and `openai/gpt-oss-120b` are production text models. Both are the currently documented strict Structured Outputs models. Groq's structured-output mode cannot currently be combined with streaming or tool use. JSON Object mode is broader but does not guarantee schema adherence. [Groq Structured Outputs](https://console.groq.com/docs/structured-outputs)
- `qwen/qwen3.6-27b` and `qwen/qwen3.8-27b` accept text and images and support tools and JSON mode, but appear in the Preview section of the current catalog. They should not be the sole production image route. [Groq vision](https://console.groq.com/docs/vision), [Groq supported models](https://console.groq.com/docs/models)
- `groq/compound` and `groq/compound-mini` are systems with built-in tools such as web search and code execution. [Groq built-in tools](https://console.groq.com/docs/tool-use/built-in-tools)

Do not use recently retired Llama or Qwen IDs from older examples. Groq shut down `meta-llama/llama-4-scout-17b-16e-instruct` and `qwen/qwen3-32b` for Free and Developer tiers on July 17, 2026, and shut down `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` on August 16, 2026. [Groq deprecations](https://console.groq.com/docs/deprecations)

### Free-plan limits and headers

Groq's Free plan is controlled by organization-level, per-model quotas. The documentation says its public table is a high-level summary and that the account Limits page is authoritative. Relevant current Free-plan rows are:

| Model                                       | RPM |   RPD |    TPM |        TPD |
| ------------------------------------------- | --: | ----: | -----: | ---------: |
| `groq/compound`, `groq/compound-mini`       |  30 |   250 | 70,000 | not listed |
| `openai/gpt-oss-20b`, `openai/gpt-oss-120b` |  30 | 1,000 |  8,000 |    200,000 |
| `qwen/qwen3.6-27b`                          |  30 | 1,000 |  8,000 |    200,000 |
| `qwen/qwen3.8-27b`                          |  30 | 1,000 |  8,000 |    200,000 |

The Free plan remains quota-limited. Upgrading to Developer requires a payment method, moves usage to pay-as-you-go, and unlocks higher limits, Batch, and Flex. Promotional credits can exist but are event-specific. [Groq rate limits](https://console.groq.com/docs/rate-limits), [Groq billing FAQ](https://console.groq.com/docs/billing-faqs)

Groq is the only provider in this group with a clear documented rate-header contract:

- `retry-after`: seconds, present only on a rate-limited `429`.
- `x-ratelimit-limit-requests` and `x-ratelimit-remaining-requests`: RPD.
- `x-ratelimit-reset-requests`: request reset duration.
- `x-ratelimit-limit-tokens` and `x-ratelimit-remaining-tokens`: TPM.
- `x-ratelimit-reset-tokens`: token reset duration.

Always honor `retry-after`. Otherwise schedule against the tighter of the token and request reset values. [Groq rate-limit headers](https://console.groq.com/docs/rate-limits)

Safe use: route low-latency chat and ordinary text to `gpt-oss-20b`; route harder diagnosis to `gpt-oss-120b`; route strict bulk classification to either GPT-OSS model with strict Structured Outputs and no tools or streaming. Use `compound` for web-backed seller or market analysis, respecting its lower 250 RPD. Treat Qwen vision as preview and retain Gemini, B.AI, SiliconFlow, or OpenRouter as the production image fallback.

## SiliconFlow

### API and model rules

SiliconFlow exposes an OpenAI-style Chat Completions API and authenticated `/v1/models`. The catalog changes periodically; the API reference explicitly says models and service capabilities may be added, removed, or adjusted. The models endpoint can filter by broad media type but does not return a complete tool, JSON, and modality capability matrix. [SiliconFlow Chat Completions API](https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions), [SiliconFlow List models](https://docs.siliconflow.com/en/api-reference/models/get-model-list)

The provider documents:

- Image URL and base64 image input for verified VLMs through `/chat/completions`; the current model catalog must be checked because the static vision list can lag the API catalog. [SiliconFlow vision](https://docs.siliconflow.com/en/userguide/capabilities/vision)
- OpenAI-compatible function calling for a documented, changing subset of DeepSeek, Qwen, and GLM models. [SiliconFlow function calling](https://docs.siliconflow.com/en/userguide/guides/function-calling)
- JSON Schema Structured Outputs across currently online language models, with explicit warnings to validate edge cases and truncation. JSON Object mode is broader than schema enforcement, but the separate JSON-mode page excludes DeepSeek R1 and V3. [SiliconFlow Structured Outputs](https://docs.siliconflow.com/en/userguide/guides/structured_outputs), [SiliconFlow JSON mode](https://docs.siliconflow.com/en/userguide/guides/json-mode)
- Thinking tool workflows on models such as DeepSeek V3.2 and GLM-4.7 can require exact preservation and replay of `reasoning_content`. [SiliconFlow interleaved thinking](https://docs.siliconflow.com/en/userguide/guides/interleaved-thinking)

Because the static capability pages and API catalog can move at different speeds, maintain a tested allowlist keyed by model ID and capability, refresh `/models`, then canary each tool, vision, or JSON-Schema combination before putting it in the live pool.

The current model pages invalidate two older free-routing assumptions. `tencent/Hunyuan-MT-7B` still displays zero input and output prices but is marked `Deprecated`; stop selecting it and retain it only as a catalogue observation while waiting for a supported replacement. `Qwen/Qwen2.5-7B-Instruct` is not free: its current page lists `$0.05` per million input tokens and `$0.05` per million output tokens. A zero displayed price and an online lifecycle state must both be true before a route may be classified as a usable free model. [Hunyuan-MT-7B model page](https://www.siliconflow.com/models/tencent-hunyuan-mt-7b), [Qwen2.5-7B-Instruct model page](https://www.siliconflow.com/models/qwen2-5-7b-instruct)

### Free credits and limits

The global pricing page currently advertises $1 in signup Credits. Normal serverless use is pay-as-you-go with no minimum commitment. Selected free models have fixed limits; some models expose a paid `Pro/` variant with higher limits. [SiliconFlow pricing](https://www.siliconflow.com/pricing), [SiliconFlow rate-limit FAQ](https://docs.siliconflow.com/en/faqs/misc_rate)

Rate limits apply at account level, not per key, and are separate per model. The nominal paid usage tiers are L0 through L5. The current published tier table starts at L0 with 1,000 RPM and 40,000 TPM and reaches L5 with 10,000 RPM and 2,000,000 TPM, but the same page says exact limits vary by model type and parameter size and must be read from the model page. The generic ranges are not safe model defaults. Special current rules for `deepseek-ai/DeepSeek-R1` and `deepseek-ai/DeepSeek-V3` are 30 requests per hour for all users and 100 requests per day for users without identity verification. These rules may be adjusted with traffic and load. [SiliconFlow rate limits](https://docs.siliconflow.com/en/userguide/rate-limits/rate-limit-and-upgradation)

On quota exhaustion SiliconFlow returns `429`, and the error message indicates which dimension was hit, such as RPM, TPM, RPD, TPD, IPM, or IPD. No stable `Retry-After` or `x-ratelimit-*` header contract is documented. Use the error dimension to open the matching local limiter, then apply bounded exponential backoff with jitter. For `503` or `504`, the provider recommends retrying later or switching backup model nodes. [SiliconFlow error handling](https://docs.siliconflow.com/en/faqs/error-codecopy), [SiliconFlow text-generation retry guidance](https://docs.siliconflow.com/en/userguide/capabilities/text-generation)

SiliconFlow's international-site standard Terms of Use prohibit commercial use and use for another person's benefit. Until a separate written commercial agreement applicable to the account is confirmed, the international direct route is restricted to non-commercial internal evaluation with public data. A free model or signup credit does not establish production, resale, or private-data authorization; keep cost, production, and privacy authorization as separate gates. [SiliconFlow Terms of Use](https://docs.siliconflow.com/en/legals/terms-of-service)

Safe use: remove `tencent/Hunyuan-MT-7B` from preferred translation routes while it is deprecated. Select a supported replacement from the live catalogue, then verify lifecycle, price, and translation quality before activation. Use a small Qwen or GLM text model with Structured Outputs for bulk classification only when its current price passes policy; select image models only from a canary-tested VLM allowlist; use a tool-capable GLM, Qwen, or DeepSeek route for seller analysis and diagnosis. Preserve `reasoning_content` exactly in tool loops for models that require it. Do not assume a model is free based on an old static list; obtain its current lifecycle, price, and `Pro/` status from the model catalog.

## Cerebras Cloud

### API, catalogue, and model eligibility

Cerebras uses Bearer API keys and an OpenAI-compatible base URL at `https://api.cerebras.ai/v1`. Keys are created in the Inference Cloud Console and must remain server-side. The authenticated `GET /v1/models` endpoint is credential-scoped; the unauthenticated `GET /public/v1/models` endpoint adds current pricing, capability, context, lifecycle, and architecture metadata. [Cerebras authentication](https://inference-docs.cerebras.ai/api-reference/authentication), [List models](https://inference-docs.cerebras.ai/api-reference/models/list-models), [Public models](https://inference-docs.cerebras.ai/api-reference/models/public-models)

The current shared public-model overview lists both `gpt-oss-120b` and `gemma-4-31b`; their documented Free/Paid context windows are 65K/131K. `gpt-oss-120b` is a production text model with reasoning, tools, function calling, JSON mode, and structured output. `gemma-4-31b` accepts image input in Public Preview through Chat Completions: PNG or JPEG must be supplied as a Base64 Data URI, external image URLs are unsupported, Free Trial requests allow at most two images, and total image payload is limited to 10 MB. Keep Gemma catalogue- and capability-canary-gated despite its public listing, and enforce those image guards locally. [Supported models](https://inference-docs.cerebras.ai/models/overview), [Cerebras image inputs](https://inference-docs.cerebras.ai/capabilities/image-inputs)

### Free Trial, limits, and data boundary

Cerebras does not offer a permanently free tier or an automatically renewing no-cost allowance. A new account receives `$5` in Free Trial credits only after adding a verified payment method; the credits expire 30 days after they are granted and can be used across the public models. API and Playground access remain inactive until the payment method is added, and stop again when the trial credits are exhausted or expire unless the account purchases credits. [Cerebras pricing](https://www.cerebras.ai/pricing), [Rate limits: Free Trial FAQ](https://inference-docs.cerebras.ai/support/rate-limits#faq)

The current Free Trial table gives the same example limits for `gpt-oss-120b` and `gemma-4-31b`: 5 RPM, 30K TPM, 1M TPH, and 1M TPD. Limits are organization- and model-scoped, specific cases may vary, and the account's Limits section remains authoritative. The current rate-limit page documents a `429` error whose message identifies the exceeded token bucket, but does not promise a stable response-header contract; stop the route at the quota boundary and use bounded retry policy only where the error category permits it. [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits#limits-by-tier), [Cerebras rate-limit notes](https://inference-docs.cerebras.ai/support/rate-limits#notes)

The Cerebras privacy policy states that inputs and outputs for training, inference, and chatbot services are not retained as described by that policy. Even so, account tier and contractual coverage are unknown in a copied key file, so this project defaults `CEREBRAS_API_TIER=unknown` and `CEREBRAS_PRIVATE_DATA_AUTHORIZED=false`. Only an operator may mark a verified Free Trial/promotion tier or authorize private data. [Cerebras Cloud privacy policy](https://cloud.cerebras.ai/privacy)

## Cloudflare Workers AI

### API, account identity, and model roles

Cloudflare REST access requires both an API token with Workers AI permissions and the account's 32-character hexadecimal Account ID. The OpenAI-compatible chat endpoint is `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions`; the Account ID is part of the URL and must never be guessed from a token. [Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [AI Gateway REST formats](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)

Current configured candidates are separated by job rather than randomly interchanged:

- `@cf/zai-org/glm-4.7-flash`: multilingual translation, chat, and tool-capable analysis.
- `@cf/google/gemma-4-26b-a4b-it`: lighter classification, vision, function calling, and reasoning; image eligibility still requires a live canary.
- `@cf/nvidia/nemotron-3-120b-a12b`: complex agentic reasoning and tool use.
- `@cf/openai/gpt-oss-120b`: complex text and diagnosis fallback.
- `@cf/meta/llama-3.2-11b-vision-instruct`: image-analysis-only candidate, subject to a live catalogue and image canary.

The model catalogue and changelog are authoritative because model availability and paid-plan requirements change. The current “payment method required” list does not include the five configured candidates, but that list is dynamic and must be checked before activation. [Workers AI models](https://developers.cloudflare.com/workers-ai/models/), [Workers AI changelog](https://developers.cloudflare.com/workers-ai/changelog/), [Gemma 4 model reference](https://developers.cloudflare.com/ai/models/%40cf/google/gemma-4-26b-a4b-it/), [Nemotron model reference](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/)

### Free Neurons, overage, and data boundary

Workers AI currently gives both Free and Paid Workers plans 10,000 Neurons per day at no charge, resetting at 00:00 UTC. A Paid plan charges `$0.011` per 1,000 Neurons above that allocation, and some models require a paid billing method. Therefore `CLOUDFLARE_AI_API_TIER` defaults to `unknown`, `CLOUDFLARE_AI_ALLOW_OVERAGE=false`, the local fail-closed budget defaults to 8,000 Neurons, and the global policy remains `free_only`; the route must stop instead of crossing into paid overage. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

Cloudflare says Workers AI customer content is not exposed to other customers and is not used to train models or improve Cloudflare or third-party services without explicit consent. It can be stored when the customer deliberately combines Workers AI with a storage service. This project still defaults `CLOUDFLARE_AI_PRIVATE_DATA_AUTHORIZED=false` so a copied account token cannot silently widen the data boundary. [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)

## Cohere

### Compatibility API and model roles

Cohere's official OpenAI Compatibility API uses `https://api.cohere.ai/compatibility/v1`. It supports chat completions, streaming, tools, structured outputs, and image input where the chosen model supports them; the authenticated native model catalogue is `GET https://api.cohere.ai/v1/models?endpoint=chat`. [Cohere Compatibility API](https://docs.cohere.com/docs/compatibility-api), [List Models](https://docs.cohere.com/v2/reference/list-models)

The curated roles are:

- `command-a-plus-05-2026`: general multilingual, vision, tool, and agentic work.
- `command-a-translate-08-2025`: dedicated translation across Japanese, Chinese, and 21 other documented languages.
- `command-a-reasoning-08-2025`: complex reasoning and agentic diagnosis.

These model IDs and capabilities are documented by Cohere, but live account eligibility still comes from the authenticated model catalogue. [Command A+ release](https://docs.cohere.com/v1/changelog/command-a-plus-05-2026), [Command A Translate release](https://docs.cohere.com/v1/changelog/2025-08-28-command-a-translate), [Command A Reasoning release](https://docs.cohere.com/changelog/2025-08-21-command-a-reasoning)

### Trial and production authorization

Cohere distinguishes evaluation/Trial keys from Production keys. Command A+, Reasoning, and Translate are currently documented at 20 Chat requests per minute, and Trial plus Production keys on newer Chat variants are limited to 1,000 API calls per month. The current pages for all three models say use is free for Trial and Production keys within those rate limits. That hosted price statement is not a production authorization: Cohere directs production users of newer variants to contact sales or obtain access through Model Vault, and no permanent end date for the free hosted state is published. Treat it as dynamic and revocable. [Cohere rate limits](https://docs.cohere.com/v2/docs/rate-limits), [Command A+](https://docs.cohere.com/docs/command-a-plus), [Command A Reasoning](https://docs.cohere.com/docs/command-a-reasoning), [Command A Translate](https://docs.cohere.com/v2/docs/command-a-translate), [Going live](https://docs.cohere.com/v1/docs/going-live)

Consequently, Cohere defaults to `COHERE_API_TIER=unknown`, `COHERE_INTERNAL_EVALUATION=false`, `COHERE_PRODUCTION_AUTHORIZED=false`, and `COHERE_PRIVATE_DATA_AUTHORIZED=false`. The provider is absent from the runtime pool until an operator explicitly authorizes internal evaluation or confirms production rights. Trial/evaluation must never serve public production traffic, and private data requires separate authorization under the applicable Cohere agreement.

## NVIDIA NIM hosted API

### API, model discovery, and roles

NVIDIA's hosted catalog exposes an OpenAI-compatible chat endpoint at `https://integrate.api.nvidia.com/v1/chat/completions`. The current general LLM API reference does not confirm one universal hosted `GET /v1/models` contract for every NIM. Discover models from the dynamic API Catalog and the exact NIM reference, then require a capability canary; do not promote an observed authenticated response into a universal official guarantee. [NVIDIA LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis)

Prior project validation recorded a credential-scoped catalogue result without storing its value in this document. At that verification time, the catalogue returned 83 models, and the two Nemotron text routes completed successfully. Current eligibility still requires a fresh authenticated catalogue read and capability canary:

- `nvidia/nemotron-3-nano-30b-a3b`: low-cost, low-latency classification, extraction, and ordinary chat candidate.
- `nvidia/nemotron-3-super-120b-a12b`: complex seller, market, and diagnostic reasoning candidate.
- `nvidia/riva-translate-4b-instruct-v2`: the current official inference reference uses the shared `https://integrate.api.nvidia.com/v1/chat/completions` endpoint. It is therefore a catalogue- and canary-gated translation candidate, not a separate-protocol exclusion. [Riva Translate inference reference](https://docs.api.nvidia.com/nim/re/reference/nvidia-riva-translate-4b-instruct-v2-infer)

Keep `nvidia:<model>` distinct from `openrouter:<model>`. A Nemotron model reached through OpenRouter has different billing, quota, retention, and failure state from the direct NVIDIA route. The NVIDIA catalog also contains multimodal and retrieval models, but a model appearing in `/models` is not enough to prove chat payload, image input, tools, or schema support. Each capability requires a canary through the exact endpoint and request shape before routing production work.

### Trial, privacy, and production eligibility

The hosted catalog is governed by NVIDIA's API Trial Terms unless the account has a separate NVIDIA or service-provider subscription. The terms limit trial access and credits to internal testing and evaluation and explicitly prohibit using the trial API service or its generated content in production. Credits and access duration are account- and service-specific, and NVIDIA may change or terminate availability. Therefore the application must classify hosted trial capacity as `promotion` or `unknown`, never permanent `free`, and must keep NVIDIA out of production candidates unless an operator explicitly confirms a production subscription. [NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)

The same trial terms state that NVIDIA may collect session metrics, error and execution logs, user content, and generated content to operate and improve its services and models. Treat the direct hosted trial route as public-data-only. Do not send purchases, notes, payment screenshots, contact details, credentials, private conversations, or other user-private data. A separately contracted or self-hosted NIM deployment may use a different policy, but it must be represented as a separate provider configuration rather than silently inheriting trial assumptions.

No stable universal RPM, TPM, daily quota, or credit amount is documented for the hosted catalog. Read availability from the dynamic API Catalog and exact NIM reference, observe account state, honor `429`, and use a model-level cooldown unless the response proves an account-wide restriction. Use provider-level cooldown for `401` and `402`. Do not hard-code historical promotional credit figures.

## Recommended routing policy for this platform

| Workload                           | Preferred route                                                                                                         | Fallbacks and safety constraints                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translation                        | Gemini 3.5 Flash-Lite; Cloudflare GLM 4.7 Flash; B.AI Qwen/GLM Flash; catalogue-gated NVIDIA Riva                       | Temperature near zero; preserve names, SKUs, and Japanese punctuation. Cohere Translate requires separate authorization. SiliconFlow Hunyuan-MT is deprecated and must not be selected.                                                      |
| Bulk classification and extraction | Groq GPT-OSS strict Structured Outputs; Cerebras GPT-OSS/Gemma; Cloudflare Gemma/GLM; Gemini 3.5 Flash-Lite             | Require JSON Schema and validate locally. Do not combine Groq strict Structured Outputs with tools or streaming. Respect each account's live free quota and stop instead of overage.                                                         |
| Image analysis                     | Gemini Flash; B.AI Qwen/GLM/MiMo; Cloudflare Gemma/Llama Vision; catalogue-gated Cerebras Gemma; tested SiliconFlow VLM | Cohere A+ is eligible only when separately authorized. Groq vision remains preview spillover. Require an image-input capability flag and enforce provider-specific image-count, encoding, and size guards.                                   |
| Seller and market analysis         | Application-owned marketplace/search tools plus Gemini, Groq Compound, Cloudflare GLM/Nemotron, or Cerebras GPT-OSS     | The model must not invent price, inventory, seller, or market facts. Require tool evidence and source URLs. Search-grounding availability and cost are tier specific.                                                                        |
| Assistant chat                     | Groq GPT-OSS for speed; Cloudflare GLM; Cerebras GPT-OSS; Gemini at low or medium thinking                              | B.AI, NVIDIA, Cohere, SiliconFlow, and OpenRouter remain capability-, authorization-, privacy-, and cost-gated fallbacks. Maintain session stickiness only where supported.                                                                  |
| System diagnosis                   | Gemini at high thinking with tools/schema; Groq or Cerebras GPT-OSS 120B; Cloudflare Nemotron/GPT-OSS                   | NVIDIA Nemotron, Cohere Reasoning, B.AI, OpenRouter, and SiliconFlow require their corresponding authorization/cost gates. Bound tool iterations, separate read-only diagnosis from mutations, and require approval for destructive actions. |

## What must be discovered dynamically

The application should refresh these values at startup and at least daily, and invalidate immediately after `404`, `429`, capability-related `400`, or a provider deprecation notice:

1. Available model IDs for the current credential from each provider's models endpoint.
2. Model lifecycle and deprecation status. Groq's August 2026 retirements show why old examples are unsafe.
3. Capability flags: input and output modalities, tools, tool choice, JSON Object, JSON Schema, reasoning-state rules, context, and output limits.
4. Current free status, promotion end time, token price, and remaining credit. B.AI promotions and OpenRouter's free pool are particularly volatile.
5. Exact account quota. SenseNova comes from the account's shared pools rather than individual Keys; Gemini from AI Studio; Groq and Cerebras from account Limits plus documented response metadata; Cloudflare from the Workers AI usage dashboard; Cohere from key type, account status, and its monthly cap; SiliconFlow from account tier plus model detail; B.AI from the platform/account state; OpenRouter from account state and routed-provider behavior; NVIDIA from the current catalog/account state and observed responses because the hosted trial has no stable universal quota contract; Vercel Gateway from team Credits and upstream provider state.
6. Retry timing. Only Groq provides a documented response-header contract. For all other providers, make the backoff policy configurable and use observed response metadata without depending on undocumented header names.

Suggested local data model per route: `provider`, `model_id`, `lifecycle`, `input_modalities`, `output_modalities`, `tools`, `json_object`, `json_schema`, `reasoning_state_rule`, `context_tokens`, `max_output_tokens`, `cost`, `free_until`, `quota_source`, `last_verified_at`, and `canary_status`. A route is eligible only when every required capability is explicitly true and the canary is current.
