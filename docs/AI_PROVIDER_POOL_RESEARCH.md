# AI provider pool research

Accessed: 2026-08-30 (Asia/Tokyo)

Scope: B.AI (`api.b.ai`), OpenRouter, Google Gemini Developer API, GroqCloud API, SiliconFlow, Cerebras Cloud, Cloudflare Workers AI, Cohere, and NVIDIA NIM. This note uses first-party API references, provider documentation, pricing pages, and model catalogs only. No credential file or credential value was read while preparing it.

## Executive conclusions

- Treat model IDs, capability support, price, and quota as runtime data. Every provider changes models. OpenRouter and Cerebras expose useful public model metadata, but authenticated catalog discovery and a capability canary still decide route eligibility.
- Do not put one global RPM or TPM value on the pool. B.AI does not publish fixed numeric API limits; Gemini, Groq, SiliconFlow, Cerebras, Cloudflare, Cohere, NVIDIA, and OpenRouter each apply different account, model, plan, or routed-provider constraints.
- The safest zero-cost paths are for development and spillover, not production guarantees. OpenRouter explicitly says its free models are low-limit and not suitable for production. B.AI's free models are limited-time promotions. Groq and Gemini free service is quota restricted. SiliconFlow combines a small signup credit with selected fixed-limit free models.
- Capability-gate every request. A model that accepts text must not automatically be assumed to accept images, tools, or JSON Schema. Reject locally when a route has not been verified for the required capabilities.
- On `429`, consume a provider's documented reset signal when one exists. Groq has a documented header contract. For the other four providers, no stable retry-header contract was found in the official documentation, so use bounded exponential backoff with jitter and a circuit breaker. Do not automatically replay a request after a mutating tool has executed.

## Connection and discovery matrix

| Provider              | Production base URL                                                                                                                  | OpenAI compatibility                                                                  | Authentication                                                    | Model discovery                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| B.AI                  | `https://api.b.ai/v1`                                                                                                                | OpenAI Chat Completions and Responses; also Anthropic Messages                        | `Authorization: Bearer ...` or equivalent `x-api-key: ...`        | Authenticated `GET https://api.b.ai/v1/models`; the result is scoped to the current credential                                  |
| OpenRouter            | `https://openrouter.ai/api/v1`                                                                                                       | OpenAI Completions and Chat Completions; Responses is also available                  | `Authorization: Bearer ...`; app attribution headers are optional | `GET https://openrouter.ai/api/v1/models`; rich metadata includes modalities, prices, context, supported parameters, and expiry |
| Gemini Developer API  | Native: `https://generativelanguage.googleapis.com/v1beta`; OpenAI layer: `https://generativelanguage.googleapis.com/v1beta/openai/` | OpenAI compatibility is beta and does not expose every native Gemini feature          | Native REST: `x-goog-api-key`; OpenAI layer: Bearer API key       | Native `GET /v1beta/models`; OpenAI layer `GET /v1beta/openai/models`                                                           |
| GroqCloud             | `https://api.groq.com/openai/v1`                                                                                                     | Mostly OpenAI compatible; unsupported fields can return `400`                         | `Authorization: Bearer ...`                                       | Authenticated `GET https://api.groq.com/openai/v1/models`                                                                       |
| SiliconFlow           | `https://api.siliconflow.com/v1`                                                                                                     | OpenAI-style Chat Completions, Completions, images, embeddings, and related endpoints | `Authorization: Bearer ...`                                       | Authenticated `GET https://api.siliconflow.com/v1/models`; optional `type` filter: `text`, `image`, `audio`, or `video`         |
| Cerebras Cloud        | `https://api.cerebras.ai/v1`                                                                                                         | OpenAI-compatible Chat Completions and Models                                         | `Authorization: Bearer ...`                                       | Authenticated `GET /v1/models`; public metadata at `GET https://api.cerebras.ai/public/v1/models`                               |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`                                                                   | OpenAI-compatible Chat Completions for compatible Workers AI models                   | `Authorization: Bearer ...` plus Account ID in the URL            | Account-scoped model search endpoint; the current Workers AI model catalog remains authoritative                                |
| Cohere                | `https://api.cohere.ai/compatibility/v1`                                                                                             | OpenAI Compatibility API for Chat Completions, tools, and structured outputs          | `Authorization: Bearer ...`                                       | Authenticated native `GET https://api.cohere.ai/v1/models?endpoint=chat`                                                        |
| NVIDIA NIM            | `https://integrate.api.nvidia.com/v1`                                                                                                | OpenAI-compatible Chat Completions for catalog LLMs                                   | `Authorization: Bearer ...`                                       | Authenticated `GET /v1/models`; model capability still requires its exact NIM reference and a canary                            |

Sources: [B.AI API reference](https://docs.b.ai/llmservice/api/), [OpenRouter quickstart](https://openrouter.ai/docs/quickstart), [OpenRouter Models API](https://openrouter.ai/docs/api/api-reference/models/get-models), [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Gemini native Models API](https://ai.google.dev/api/models), [Gemini authentication reference](https://ai.google.dev/api), [Groq OpenAI compatibility](https://console.groq.com/docs/openai), [Groq supported models](https://console.groq.com/docs/models), [SiliconFlow quickstart](https://docs.siliconflow.com/en/userguide/quickstart), [SiliconFlow List models](https://docs.siliconflow.com/en/api-reference/models/get-model-list), [Cerebras authentication](https://inference-docs.cerebras.ai/api-reference/authentication), [Cloudflare Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [Cohere Compatibility API](https://docs.cohere.com/docs/compatibility-api), [NVIDIA LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis).

## B.AI

### API and model rules

B.AI exposes three protocols behind one credential: `/v1/chat/completions`, `/v1/responses`, and `/v1/messages`. The authenticated `/v1/models` response is the authoritative list of model IDs available to that credential. It does not publish a full machine-readable capability matrix, so protocol compatibility and features must be held in a provider-specific registry derived from the current model pages and verified by a non-billable or minimal probe before activation. Responses and Chat Completions expose tools and structured-output fields, but their availability depends on the selected model. [B.AI API reference](https://docs.b.ai/llmservice/api/)

Examples of current capability combinations:

- `qwen3.8-flash`: text, image, and video input; text output; function calling and structured output; 1M context. [B.AI Qwen3.8-Flash](https://docs.b.ai/llmservice/models/qwen3-8-flash/)
- `glm-5.3-flash`: text, image, video, and file input; text output; function calling, streamed tool calls, and JSON structured output; 1M context. Thinking is always enabled, with `low`, `high`, and `max` effort. [B.AI GLM-5.3-Flash](https://docs.b.ai/llmservice/models/glm-5-3-flash/)
- `mimo-v2.5`: text, image, video, and audio input; text output; function calling and structured output; 1M context. Preserve returned `reasoning_content` across thinking-mode tool turns. [B.AI MiMo-V2.5](https://docs.b.ai/llmservice/models/mimo-v2.5/)
- `deepseek-v4-flash`: text only, function calling, large context, optimized for high-volume text. [B.AI DeepSeek-V4-Flash](https://docs.b.ai/llmservice/models/deepseek-v4-flash/)

### Free credits and limits

B.AI is prepaid and uses Credits, with `1 USD = 1,000,000 Credits`. Free bonus Credits, including registration and top-up bonuses, expire 30 days after issue. Current zero-Credit API promotions include DeepSeek-V4-Flash, DeepSeek-V4-Flash-Vision-Exp, Hy3, MiMo-V2.5, GLM-5.3-Flash, and Qwen3.8-Flash. These are expressly limited-time offers; end time, eligibility, and final settlement are controlled by the platform display. They must not be encoded as permanent free models. [B.AI pricing and usage](https://docs.b.ai/llmservice/pricing-and-usage/), [B.AI promotions](https://docs.b.ai/llmservice/promotions-and-pricing-notices/)

No official fixed RPM, TPM, RPD, or retry-reset values were found. The API reference documents `429` handling as exponential backoff plus reduced concurrency, but does not define `Retry-After` or `x-ratelimit-*` response headers. Discover available models per credential, obtain current account capacity and promotion state from the platform, and keep conservative local concurrency until measured. [B.AI API error and retry guidance](https://docs.b.ai/llmservice/api/)

Safe use: use the current free Flash-class models for translation, classification, and noncritical image extraction while the promotion is active. Prefer `glm-5.3-flash` or `qwen3.8-flash` when vision, tools, or schema output is required. Do not route a vision job to `deepseek-v4-flash`. Use a paid, stronger text model or a verified Flash model at high reasoning effort for system diagnosis, with a second provider as fallback.

## OpenRouter

### API and model rules

OpenRouter is the easiest provider in this set to route dynamically. `/api/v1/models` exposes `architecture.input_modalities`, `architecture.output_modalities`, `supported_parameters`, pricing, context length, per-request limits when present, and expiration date. Filter on `supported_parameters=tools` or inspect `structured_outputs` and `response_format` before selecting a model. Image inputs use the OpenAI-style multipart message content for a vision-capable model. Tools and structured output are standardized across compatible models, but remain model and upstream-provider dependent. [OpenRouter models guide](https://openrouter.ai/docs/guides/overview/models), [image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding), [tool calling](https://openrouter.ai/docs/guides/features/tool-calling), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)

The `openrouter/free` router filters the current free pool for required image understanding, tools, and structured output, then chooses a matching model at random. It is appropriate for experiments and low-volume fallback, but not for deterministic quality or production availability. A specific `:free` model variant gives model stability but retains low and variable availability. [OpenRouter Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)

For production, use a curated paid model list plus the `models` fallback array. OpenRouter will also fail over among upstream providers for a model. Model fallbacks can trigger on rate limits, downtime, context errors, and moderation refusals. Require the needed parameters in routing rather than allowing a fallback that silently drops a tool or schema requirement. [OpenRouter model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

### Free credits and limits

- The Free plan is currently 50 requests per day across free models.
- After at least $10 in Credits has been purchased, the free-model daily allowance becomes 1,000 requests.
- New users receive a very small test allowance. Free models are explicitly described as low-limit and generally unsuitable for production.
- Credits are denominated in USD; OpenRouter reserves the right to expire unused purchased Credits after one year.

The official FAQ and pricing page do not publish a general TPM value or a stable paid-plan RPM. Paid throughput is a pooled routing concern and can also be governed by the chosen upstream or a BYOK provider. Do not use the deprecated `rate_limit` field returned by `GET /api/v1/key`; the API reference marks it safe to ignore. [OpenRouter FAQ](https://openrouter.ai/docs/faq), [OpenRouter pricing](https://openrouter.ai/pricing), [current key API](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)

The API documents `429` responses and a `rate_limit_exceeded` error code, but no stable `Retry-After` or `x-ratelimit-*` response-header contract was found. Use bounded exponential backoff with jitter. Prefer OpenRouter's provider and model fallbacks before retrying the same route, and never replay a request whose tool call already caused a side effect. [OpenRouter Responses API](https://openrouter.ai/docs/api/api-reference/responses/create-responses)

Safe use: choose models at runtime from capability metadata. Sort low-cost models for translation and bulk classification, require `structured_outputs`, and pin a tested model in production. For image analysis, require `image` input plus text output. For seller or market analysis, require tools and use the current web-search server tool or an application-owned data function. For chat and diagnosis, use a curated quality tier with model fallbacks; do not use the random free router where consistent answers are required.

## Google Gemini Developer API

### API and model rules

Use the native Gemini API for full feature access. The OpenAI compatibility layer is still beta and Google notes that advanced native features can require extra mapping or be unavailable. Native model discovery returns model IDs, token limits, and supported actions. The OpenAI-compatible models endpoint is useful for SDK discovery but is not a complete capability registry. [Gemini partner integration guidance](https://ai.google.dev/gemini-api/docs/partner-integration), [Gemini Models API](https://ai.google.dev/api/models), [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)

Authentication needs near-term attention. Native calls use `x-goog-api-key`; the OpenAI layer accepts the API key as a Bearer token. Google now creates authorization keys by default, rejects unrestricted standard keys, and states that standard keys will be rejected in September 2026. Migrate any remaining standard key before that cutoff. [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)

Current routing anchors:

- `gemini-3.7-flash` is GA, accepts text, image, video, audio, and PDF, and outputs text. It supports function calling, structured outputs, search grounding, Maps grounding, URL context, code execution, and file search, with low, medium, and high thinking. [Gemini 3.7 Flash model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)
- `gemini-3.1-flash-lite` is the documented cost-efficient model for high-volume agentic tasks, translation, and simple data processing. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Model availability and deprecation change. Use stable IDs for production and check the deprecation page during catalog refresh. [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations)

### Free tier and limits

The Free tier provides no-charge input and output for selected models; some advanced models have no free API tier. Free-tier content can be used to improve Google's products, while paid-tier content is not. Batch processing is generally paid-only. Exact free and paid RPM, TPM, and RPD are no longer safe static constants: limits are per project rather than per key, vary by model and usage tier, and update with account status. RPD resets at midnight Pacific time. Preview and experimental models have tighter limits. Google directs clients to the live AI Studio limits page. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini billing](https://ai.google.dev/gemini-api/docs/billing)

The documented quota dimensions are RPM, input TPM, RPD, and sometimes model-specific IPM or TPD. Paid tiers may also have a rolling 10-minute spend cap. A limit violation returns `429 RESOURCE_EXHAUSTED`. No stable retry response header is promised in the cited API docs. Google's official SDKs automatically retry transient `429` and `5xx` errors with exponential backoff; the Python SDK is documented as up to four retries, about one second initially and at most 60 seconds. Direct REST clients should use exponential backoff, jitter, and bounded retries. [Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting), [Gemini API errors](https://ai.google.dev/gemini-api/docs/generate-content/api-errors)

Safe use: route translation and simple classification to `gemini-3.1-flash-lite`; use paid Batch for large offline jobs. Route image analysis and general assistant work to the stable `gemini-3.7-flash`, normally with low or medium thinking. Use high thinking, tools, and structured output for system diagnosis. For seller or market analysis, use search grounding only when the selected tier permits it, return citations, and fall back to application-owned marketplace data tools when grounding is unavailable.

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
| `qwen/qwen3.8-27b`                          |  30 | 1,000 |  8,000 |  2,000,000 |

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

### Free credits and limits

The global pricing page currently advertises $1 in signup Credits. Normal serverless use is pay-as-you-go with no minimum commitment. Selected free models have fixed limits; some models expose a paid `Pro/` variant with higher limits. [SiliconFlow pricing](https://www.siliconflow.com/pricing), [SiliconFlow rate-limit FAQ](https://docs.siliconflow.com/en/faqs/misc_rate)

Rate limits apply at account level, not per key, and are separate per model. The nominal paid usage tiers are L0 through L5. The current published tier table starts at L0 with 1,000 RPM and 40,000 TPM and reaches L5 with 10,000 RPM and 2,000,000 TPM, but the same page says exact limits vary by model type and parameter size and must be read from the model page. The generic ranges are not safe model defaults. Special current rules for `deepseek-ai/DeepSeek-R1` and `deepseek-ai/DeepSeek-V3` are 30 requests per hour for all users and 100 requests per day for users without identity verification. These rules may be adjusted with traffic and load. [SiliconFlow rate limits](https://docs.siliconflow.com/en/userguide/rate-limits/rate-limit-and-upgradation)

On quota exhaustion SiliconFlow returns `429`, and the error message indicates which dimension was hit, such as RPM, TPM, RPD, TPD, IPM, or IPD. No stable `Retry-After` or `x-ratelimit-*` header contract is documented. Use the error dimension to open the matching local limiter, then apply bounded exponential backoff with jitter. For `503` or `504`, the provider recommends retrying later or switching backup model nodes. [SiliconFlow error handling](https://docs.siliconflow.com/en/faqs/error-codecopy), [SiliconFlow text-generation retry guidance](https://docs.siliconflow.com/en/userguide/capabilities/text-generation)

Safe use: prefer the dedicated `tencent/Hunyuan-MT-7B` route for translation when present in `/models`; use a small Qwen or GLM text model with Structured Outputs for bulk classification; select image models only from a canary-tested VLM allowlist; use a tool-capable GLM, Qwen, or DeepSeek route for seller analysis and diagnosis. Preserve `reasoning_content` exactly in tool loops for models that require it. Do not assume a model is free based on an old static list; obtain its current price and `Pro/` status from the model catalog.

## Cerebras Cloud

### API, catalogue, and model eligibility

Cerebras uses Bearer API keys and an OpenAI-compatible base URL at `https://api.cerebras.ai/v1`. Keys are created in the Inference Cloud Console and must remain server-side. The authenticated `GET /v1/models` endpoint is credential-scoped; the unauthenticated `GET /public/v1/models` endpoint adds current pricing, capability, context, lifecycle, and architecture metadata. [Cerebras authentication](https://inference-docs.cerebras.ai/api-reference/authentication), [List models](https://inference-docs.cerebras.ai/api-reference/models/list-models), [Public models](https://inference-docs.cerebras.ai/api-reference/models/public-models)

`gpt-oss-120b` is a current production model on the shared public API and supports text reasoning, tools, function calling, JSON mode, and structured output. `gemma-4-31b` appears in Cerebras's model-selection guidance for dedicated enterprise endpoints rather than the current shared public-model list. Keep it as a catalogue-gated candidate: it is eligible only if the current credential actually returns it and a request canary passes. Neither configured Cerebras model is treated as an image route. [Supported models](https://inference-docs.cerebras.ai/models/overview), [Choose a model](https://inference-docs.cerebras.ai/models/choose-a-model)

### Free tier, limits, and data boundary

Cerebras publishes a `$0` Free tier with lower limits. Exact limits apply at organization and project levels, vary by model, and are ultimately controlled by the account's Limits page. Its current example Free row for `gpt-oss-120b` is 30 RPM, 64K TPM, 14.4K RPD, and 1M TPD, but these are not safe permanent constants. Responses expose `x-ratelimit-*` request and token headers; use those observed values and stop the route on `429`. [Cerebras pricing](https://inference-docs.cerebras.ai/support/pricing), [Rate limits](https://inference-docs.cerebras.ai/support/rate-limits), [Usage and monitoring](https://inference-docs.cerebras.ai/console/usage-monitoring)

The Cerebras privacy policy states that inputs and outputs for training, inference, and chatbot services are not retained as described by that policy. Even so, account tier and contractual coverage are unknown in a copied key file, so this project defaults `CEREBRAS_API_TIER=unknown` and `CEREBRAS_PRIVATE_DATA_AUTHORIZED=false`. Only an operator may mark a verified free tier or authorize private data. [Cerebras Cloud privacy policy](https://cloud.cerebras.ai/privacy)

## Cloudflare Workers AI

### API, account identity, and model roles

Cloudflare REST access requires both an API token with Workers AI permissions and the account's 32-character hexadecimal Account ID. The OpenAI-compatible chat endpoint is `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions`; the Account ID is part of the URL and must never be guessed from a token. [Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [AI Gateway REST formats](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)

Current configured candidates are separated by job rather than randomly interchanged:

- `@cf/zai-org/glm-4.7-flash`: multilingual translation, chat, and tool-capable analysis.
- `@cf/google/gemma-4-26b-a4b-it`: lighter classification and ordinary text processing.
- `@cf/nvidia/nemotron-3-120b-a12b`: complex agentic reasoning and tool use.
- `@cf/openai/gpt-oss-120b`: complex text and diagnosis fallback.
- `@cf/meta/llama-3.2-11b-vision-instruct`: image-analysis-only candidate, subject to a live catalogue and image canary.

The model catalogue and changelog are authoritative because model availability and paid-plan requirements change. [Workers AI models](https://developers.cloudflare.com/workers-ai/models/), [Workers AI changelog](https://developers.cloudflare.com/workers-ai/changelog/), [Nemotron model reference](https://developers.cloudflare.com/workers-ai/models/nemotron-3-120b-a12b/)

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

Cohere distinguishes evaluation/Trial keys from Production keys. Trial keys are free but limited; Command A+, Reasoning, and Translate are currently documented at 20 Chat requests per minute, and trial keys plus Production keys on newer Chat variants are limited to 1,000 API calls per month. Cohere directs production users of newer variants to contact sales. A Production key is paid and does not by itself prove that a newer Command A variant is production-authorized. [Cohere rate limits](https://docs.cohere.com/v2/docs/rate-limits), [Going live](https://docs.cohere.com/v1/docs/going-live)

Consequently, Cohere defaults to `COHERE_API_TIER=unknown`, `COHERE_INTERNAL_EVALUATION=false`, `COHERE_PRODUCTION_AUTHORIZED=false`, and `COHERE_PRIVATE_DATA_AUTHORIZED=false`. The provider is absent from the runtime pool until an operator explicitly authorizes internal evaluation or confirms production rights. Trial/evaluation must never serve public production traffic, and private data requires separate authorization under the applicable Cohere agreement.

## NVIDIA NIM hosted API

### API, model discovery, and roles

NVIDIA's hosted catalog exposes an OpenAI-compatible chat endpoint at `https://integrate.api.nvidia.com/v1/chat/completions`. The authenticated `GET /v1/models` response is the source of truth for the models available to the current credential; the catalog changes and must not be reduced to a permanent static list. [NVIDIA LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis), [API Catalog quickstart](https://docs.api.nvidia.com/nim/re/docs/api-quickstart)

The current credential was canary-tested without recording its value. At verification time, the catalog returned 83 models, and these text routes completed successfully:

- `nvidia/nemotron-3-nano-30b-a3b`: low-cost, low-latency classification, extraction, and ordinary chat candidate.
- `nvidia/nemotron-3-super-120b-a12b`: complex seller, market, and diagnostic reasoning candidate.
- `nvidia/riva-translate-4b-instruct-v2`: observed in the catalogue only. It uses a dedicated translation protocol that the shared `chat/completions` gateway does not yet implement, so it is deliberately excluded from every runtime route.

Keep `nvidia:<model>` distinct from `openrouter:<model>`. A Nemotron model reached through OpenRouter has different billing, quota, retention, and failure state from the direct NVIDIA route. The NVIDIA catalog also contains multimodal and retrieval models, but a model appearing in `/models` is not enough to prove chat payload, image input, tools, or schema support. Each capability requires a canary through the exact endpoint and request shape before routing production work.

### Trial, privacy, and production eligibility

The hosted catalog is governed by NVIDIA's API Trial Terms unless the account has a separate NVIDIA or service-provider subscription. The terms limit trial access and credits to internal testing and evaluation and explicitly prohibit using the trial API service or its generated content in production. Credits and access duration are account- and service-specific, and NVIDIA may change or terminate availability. Therefore the application must classify hosted trial capacity as `promotion` or `unknown`, never permanent `free`, and must keep NVIDIA out of production candidates unless an operator explicitly confirms a production subscription. [NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)

The same trial terms state that NVIDIA may collect session metrics, error and execution logs, user content, and generated content to operate and improve its services and models. Treat the direct hosted trial route as public-data-only. Do not send purchases, notes, payment screenshots, contact details, credentials, private conversations, or other user-private data. A separately contracted or self-hosted NIM deployment may use a different policy, but it must be represented as a separate provider configuration rather than silently inheriting trial assumptions.

No stable universal RPM, TPM, daily quota, or credit amount is documented for the hosted catalog. Read availability from `/models`, observe account state, honor `429`, and use a model-level cooldown unless the response proves an account-wide restriction. Use provider-level cooldown for `401` and `402`. Do not hard-code historical promotional credit figures.

## Recommended routing policy for this platform

| Workload                           | Preferred route                                                                                                          | Fallbacks and safety constraints                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Translation                        | Gemini Flash-Lite; Cloudflare GLM 4.7 Flash; SiliconFlow Hunyuan-MT; B.AI Qwen/GLM Flash; catalogue-gated Cerebras Gemma | Temperature near zero; preserve names, SKUs, and Japanese punctuation. Cohere Translate requires separate authorization. NVIDIA Riva remains catalogue observation only until its dedicated protocol is implemented.                         |
| Bulk classification and extraction | Groq GPT-OSS strict Structured Outputs; Cerebras GPT-OSS/Gemma; Cloudflare Gemma/GLM; Gemini Flash-Lite                  | Require JSON Schema and validate locally. Do not combine Groq strict Structured Outputs with tools or streaming. Respect each account's live free quota and stop instead of overage.                                                         |
| Image analysis                     | Gemini Flash; B.AI Qwen/GLM/MiMo; Cloudflare Llama Vision; canary-tested SiliconFlow VLM                                 | Cohere A+ is eligible only when separately authorized. Groq vision remains preview spillover. Require an image-input capability flag and enforce image-count and size guards.                                                                |
| Seller and market analysis         | Application-owned marketplace/search tools plus Gemini, Groq Compound, Cloudflare GLM/Nemotron, or Cerebras GPT-OSS      | The model must not invent price, inventory, seller, or market facts. Require tool evidence and source URLs. Search-grounding availability and cost are tier specific.                                                                        |
| Assistant chat                     | Groq GPT-OSS for speed; Cloudflare GLM; Cerebras GPT-OSS; Gemini at low or medium thinking                               | B.AI, NVIDIA, Cohere, SiliconFlow, and OpenRouter remain capability-, authorization-, privacy-, and cost-gated fallbacks. Maintain session stickiness only where supported.                                                                  |
| System diagnosis                   | Gemini at high thinking with tools/schema; Groq or Cerebras GPT-OSS 120B; Cloudflare Nemotron/GPT-OSS                    | NVIDIA Nemotron, Cohere Reasoning, B.AI, OpenRouter, and SiliconFlow require their corresponding authorization/cost gates. Bound tool iterations, separate read-only diagnosis from mutations, and require approval for destructive actions. |

## What must be discovered dynamically

The application should refresh these values at startup and at least daily, and invalidate immediately after `404`, `429`, capability-related `400`, or a provider deprecation notice:

1. Available model IDs for the current credential from each provider's models endpoint.
2. Model lifecycle and deprecation status. Groq's August 2026 retirements show why old examples are unsafe.
3. Capability flags: input and output modalities, tools, tool choice, JSON Object, JSON Schema, reasoning-state rules, context, and output limits.
4. Current free status, promotion end time, token price, and remaining credit. B.AI promotions and OpenRouter's free pool are particularly volatile.
5. Exact account quota. Gemini must come from AI Studio; Groq and Cerebras from account Limits plus response headers; Cloudflare from the Workers AI usage dashboard; Cohere from key type, account status, and its monthly cap; SiliconFlow from account tier plus model detail; B.AI from the platform/account state; OpenRouter from account state and routed provider behavior; NVIDIA from the current catalog/account state and observed responses because the hosted trial has no stable universal quota contract.
6. Retry timing. Only Groq provides a documented response-header contract. For all other providers, make the backoff policy configurable and use observed response metadata without depending on undocumented header names.

Suggested local data model per route: `provider`, `model_id`, `lifecycle`, `input_modalities`, `output_modalities`, `tools`, `json_object`, `json_schema`, `reasoning_state_rule`, `context_tokens`, `max_output_tokens`, `cost`, `free_until`, `quota_source`, `last_verified_at`, and `canary_status`. A route is eligible only when every required capability is explicitly true and the canary is current.
