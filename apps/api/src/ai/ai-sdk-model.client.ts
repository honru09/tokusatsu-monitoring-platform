import { Injectable } from "@nestjs/common";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  generateText,
  InvalidArgumentError,
  type ModelMessage,
} from "ai";
import { isIP } from "node:net";
import type { ProviderRuntime } from "./ai-provider-registry.js";

export type AiSdkModelRequest = {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  maxTokens: number;
  temperature?: number;
  imageUrls?: string[];
};

export type AiSdkModelResponse = {
  model?: string;
  choices: Array<{ message: { content: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    neurons?: number;
  };
};

type ResponsesPayload = {
  model?: unknown;
  output_text?: unknown;
  output?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
};

export class AiSdkHttpError extends Error {
  constructor(
    readonly statusCode: number | undefined,
    readonly responseBody: string,
    readonly responseHeaders: Headers,
    message: string,
  ) {
    super(message);
    this.name = "AiSdkHttpError";
  }
}

function ipv4Bytes(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return undefined;
  const bytes = parts.map(Number);
  return bytes.every(
    (part) => Number.isInteger(part) && part >= 0 && part <= 255,
  )
    ? bytes
    : undefined;
}

function ipv6Bytes(hostname: string) {
  const sections = hostname.toLowerCase().split("::");
  if (sections.length > 2) return undefined;
  const left = sections[0] ? sections[0].split(":") : [];
  const right = sections[1] ? sections[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if (
    (sections.length === 1 && omitted !== 0) ||
    (sections.length === 2 && omitted < 1)
  )
    return undefined;
  const groups = [...left, ...Array(omitted).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))
  )
    return undefined;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function isNonPublicIpv4(bytes: number[]) {
  const [first = 0, second = 0, third = 0] = bytes;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isNonPublicIpv6(bytes: number[]) {
  const allZero = bytes.every((byte) => byte === 0);
  const loopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const uniqueLocal = (bytes[0]! & 0xfe) === 0xfc;
  const linkOrSiteLocal =
    bytes[0] === 0xfe &&
    ((bytes[1]! & 0xc0) === 0x80 || (bytes[1]! & 0xc0) === 0xc0);
  const multicast = bytes[0] === 0xff;
  const mappedIpv4 =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  const compatibleIpv4 = bytes.slice(0, 12).every((byte) => byte === 0);
  return (
    allZero ||
    loopback ||
    uniqueLocal ||
    linkOrSiteLocal ||
    multicast ||
    ((mappedIpv4 || compatibleIpv4) && isNonPublicIpv4(bytes.slice(12)))
  );
}

function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return [
    "localhost",
    ".localhost",
    ".localhost.localdomain",
    ".local",
    ".internal",
    ".home.arpa",
  ].some(
    (suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix),
  );
}

export function isSafeExternalImageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.hostname
  )
    return false;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isLocalHostname(hostname)) return false;
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const bytes = ipv4Bytes(hostname);
    return Boolean(bytes && !isNonPublicIpv4(bytes));
  }
  if (ipVersion === 6) {
    const bytes = ipv6Bytes(hostname);
    return Boolean(bytes && !isNonPublicIpv6(bytes));
  }
  return true;
}

export function assertSafeExternalImageUrls(imageUrls: string[]) {
  for (const [index, imageUrl] of imageUrls.entries()) {
    if (isSafeExternalImageUrl(imageUrl)) continue;
    throw new InvalidArgumentError({
      parameter: `imageUrls[${index}]`,
      value: "[redacted]",
      message: "must be a public HTTPS URL without credentials",
    });
  }
}

function modelPrompt(request: AiSdkModelRequest) {
  const instructions = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const messages: ModelMessage[] = request.messages.flatMap((message) =>
    message.role === "system"
      ? []
      : [{ role: message.role, content: message.content }],
  );
  const imageUrls = request.imageUrls ?? [];
  if (imageUrls.length) {
    let userIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex >= 0) {
      const user = messages[userIndex];
      if (user?.role === "user") {
        const text =
          typeof user.content === "string"
            ? user.content
            : user.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n");
        messages[userIndex] = {
          role: "user",
          content: [
            { type: "text", text },
            ...imageUrls.map((url) => ({
              type: "file" as const,
              mediaType: "image",
              data: new URL(url),
            })),
          ],
        };
      }
    }
  }
  return { instructions: instructions || undefined, messages };
}

function responsesInput(request: AiSdkModelRequest) {
  const imageUrls = request.imageUrls ?? [];
  const nonSystem = request.messages.filter(
    (message) => message.role !== "system",
  );
  let lastUserIndex = -1;
  for (let index = nonSystem.length - 1; index >= 0; index -= 1) {
    if (nonSystem[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return nonSystem.map((message, index) => ({
    type: "message",
    role: message.role,
    content: [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content,
      },
      ...(index === lastUserIndex
        ? imageUrls.map((imageUrl) => ({
            type: "input_image",
            image_url: imageUrl,
          }))
        : []),
    ],
  }));
}

function responseOutputText(payload: ResponsesPayload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const content = (entry as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? [text] : [];
      });
    })
    .join("");
}

function finiteUsage(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

@Injectable()
export class AiSdkModelClient {
  async generate(
    provider: ProviderRuntime,
    model: string,
    request: AiSdkModelRequest,
    credentialId: string,
    abortSignal: AbortSignal,
  ): Promise<AiSdkModelResponse> {
    assertSafeExternalImageUrls(request.imageUrls ?? []);
    if (provider.wireApi === "responses") {
      const instructions = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const body = provider.normalizeRequestBody({
        model,
        ...(instructions ? { instructions } : {}),
        input: responsesInput(request),
        max_output_tokens: request.maxTokens,
        store: false,
        stream: false,
      });
      const response = await fetch(`${provider.apiUrl}/responses`, {
        method: "POST",
        headers: provider.headers(true, undefined, credentialId),
        body: JSON.stringify(body),
        redirect: "error",
        signal: abortSignal,
      });
      const responseText = await response.text().catch(() => "");
      if (!response.ok)
        throw new AiSdkHttpError(
          response.status,
          responseText,
          response.headers,
          `Responses API request failed with HTTP ${response.status}`,
        );
      let payload: ResponsesPayload;
      try {
        payload = JSON.parse(responseText) as ResponsesPayload;
      } catch {
        throw new AiSdkHttpError(
          response.status,
          responseText,
          response.headers,
          "Responses API returned invalid JSON",
        );
      }
      return {
        model: typeof payload.model === "string" ? payload.model : model,
        choices: [{ message: { content: responseOutputText(payload) } }],
        usage: {
          prompt_tokens: finiteUsage(payload.usage?.input_tokens),
          completion_tokens: finiteUsage(payload.usage?.output_tokens),
        },
      };
    }
    const gateway = createOpenAICompatible({
      name: "litellm",
      baseURL: provider.apiUrl,
      headers: provider.headers(true, undefined, credentialId),
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
        }),
      supportedUrls: () => ({ "image/*": [/^https:\/\//i] }),
    });
    const prompt = modelPrompt(request);
    try {
      const result = await generateText({
        model: gateway.chatModel(model),
        instructions: prompt.instructions,
        messages: prompt.messages,
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature ?? 0.1,
        maxRetries: 0,
        abortSignal,
      });
      return {
        model: result.finalStep.response.modelId,
        choices: [{ message: { content: result.text } }],
        usage: {
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens,
        },
      };
    } catch (error) {
      if (!APICallError.isInstance(error)) throw error;
      throw new AiSdkHttpError(
        error.statusCode,
        error.responseBody ?? "",
        new Headers(error.responseHeaders),
        error.message,
      );
    }
  }
}
