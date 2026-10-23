import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AI_PROVIDER_IDS, isAiProvider } from "./ai-model-catalog.js";
import {
  validateAiProviderCredentials,
  type LiveValidationOptions,
} from "./ai-provider-live-validator.js";

export type AiProviderValidatorCliOptions = {
  envPath: string;
  completion: boolean;
  includeInactive: boolean;
  providers: Array<(typeof AI_PROVIDER_IDS)[number]>;
  timeoutMs?: number;
  maxTokens?: number;
  model?: string;
};

const PROVIDER_ENV_PREFIXES = [
  "OPENAI_",
  "ANTHROPIC_",
  "DEEPSEEK_",
  "LITELLM_",
  "BAI_",
  "GEMINI_",
  "GROQ_",
  "SILICONFLOW_",
  "CEREBRAS_",
  "CLOUDFLARE_",
  "COHERE_",
  "NVIDIA_",
  "SENSENOVA_",
  "OPENROUTER_",
  "OVO_",
] as const;

function invalidRequest(): never {
  throw new Error("INVALID_REQUEST");
}

function parsePositiveInteger(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed <= 0)
    invalidRequest();
  return parsed;
}

function requiredValue(argv: string[], index: number) {
  const value = argv[index];
  if (!value || value.startsWith("--")) invalidRequest();
  return value;
}

function validModel(value: string | undefined) {
  return Boolean(
    value && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(value),
  );
}

export function parseAiProviderValidatorArguments(
  argv: string[],
): AiProviderValidatorCliOptions {
  const result: AiProviderValidatorCliOptions = {
    envPath: ".env",
    completion: false,
    includeInactive: false,
    providers: [],
  };
  let seenEnv = false;
  let seenModel = false;
  let seenTimeout = false;
  let seenMaxTokens = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--completion") result.completion = true;
    else if (argument === "--include-inactive") result.includeInactive = true;
    else if (argument === "--env") {
      if (seenEnv) invalidRequest();
      seenEnv = true;
      result.envPath = requiredValue(argv, ++index);
    } else if (argument === "--provider") {
      const values = requiredValue(argv, ++index)
        .split(",")
        .map((provider) => provider.trim().toLowerCase());
      if (
        values.some((provider) => !provider || !isAiProvider(provider)) ||
        new Set([...result.providers, ...values]).size !==
          result.providers.length + values.length
      )
        invalidRequest();
      result.providers.push(...values.filter(isAiProvider));
    } else if (argument === "--timeout-ms") {
      if (seenTimeout) invalidRequest();
      seenTimeout = true;
      result.timeoutMs = parsePositiveInteger(requiredValue(argv, ++index));
    } else if (argument === "--max-tokens") {
      if (seenMaxTokens) invalidRequest();
      seenMaxTokens = true;
      result.maxTokens = parsePositiveInteger(requiredValue(argv, ++index));
    } else if (argument === "--model") {
      if (seenModel) invalidRequest();
      seenModel = true;
      result.model = requiredValue(argv, ++index).trim();
    } else invalidRequest();
  }
  if (result.model != null && !validModel(result.model)) invalidRequest();
  if (
    result.completion &&
    (result.providers.length !== 1 || !validModel(result.model))
  )
    invalidRequest();
  if (!result.completion && (result.model != null || result.maxTokens != null))
    invalidRequest();
  return result;
}

function isAiEnvironmentName(name: string) {
  if (name === "LITELLM_MASTER_KEY") return false;
  return (
    name === "NODE_ENV" ||
    name === "OPENAI_API_KEY" ||
    name === "ANTHROPIC_API_KEY" ||
    name === "DEEPSEEK_API_KEY" ||
    name.startsWith("AI_") ||
    PROVIDER_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

function isSecretEnvironmentName(name: string) {
  return (
    /(?:_API_KEY|_API_TOKEN|_TOKEN|_MASTER_KEY)$/.test(name) ||
    name === "AI_INTERNAL_TOKEN"
  );
}

function containsSecret(value: string, secrets: readonly string[]) {
  const normalized = value.toLocaleLowerCase("en-US");
  return secrets.some(
    (secret) =>
      secret && normalized.includes(secret.toLocaleLowerCase("en-US")),
  );
}

function scrubReport<T>(
  report: T,
  environment: Record<string, string | undefined>,
): T {
  const secrets = Object.entries(environment)
    .filter(([name, value]) => isSecretEnvironmentName(name) && value?.trim())
    .map(([, value]) => value!.trim());
  if (!secrets.length) return report;
  const visit = (value: unknown): unknown => {
    if (typeof value === "string")
      return containsSecret(value, secrets) ? "[REDACTED]" : value;
    if (Array.isArray(value))
      return value
        .filter(
          (entry) =>
            !(typeof entry === "string" && containsSecret(entry, secrets)),
        )
        .map(visit);
    if (value && typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        const safeKey = containsSecret(key, secrets) ? "[REDACTED_KEY]" : key;
        output[safeKey] = visit(entry);
      }
      return output;
    }
    return value;
  };
  return visit(report) as T;
}

function dotenvValue(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    let escaped = false;
    for (let index = 1; index < value.length; index += 1) {
      const character = value[index];
      if (quote === '"' && character === "\\" && !escaped) {
        escaped = true;
        continue;
      }
      if (character === quote && !escaped) {
        const remainder = value.slice(index + 1).trim();
        if (remainder && !remainder.startsWith("#")) invalidRequest();
        return value.slice(1, index);
      }
      escaped = false;
    }
    invalidRequest();
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function loadAiProviderEnvironment(
  path: string,
  readText: (absolutePath: string) => string = (absolutePath) =>
    readFileSync(absolutePath, "utf8"),
  environment: Record<string, string | undefined> = process.env,
) {
  let content: string;
  try {
    content = readText(resolve(path));
  } catch {
    invalidRequest();
  }
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const name = match?.[1];
    if (!name || !isAiEnvironmentName(name)) continue;
    const value = dotenvValue(match[2] ?? "");
    if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) invalidRequest();
    const previous = values.get(name);
    if (previous != null && previous !== value) invalidRequest();
    values.set(name, value);
  }
  for (const [name, value] of values) {
    if (!environment[name]?.trim() && value) environment[name] = value;
  }
}

export async function runAiProviderValidatorCli(
  argv: string[],
  dependencies: {
    readText?: (absolutePath: string) => string;
    environment?: Record<string, string | undefined>;
    validate?: typeof validateAiProviderCredentials;
    write?: (text: string) => void;
  } = {},
) {
  const options = parseAiProviderValidatorArguments(argv);
  loadAiProviderEnvironment(
    options.envPath,
    dependencies.readText,
    dependencies.environment,
  );
  const selectedProviders = options.providers.length
    ? options.providers
    : [...AI_PROVIDER_IDS];
  const validationOptions: LiveValidationOptions = {
    providers: selectedProviders,
    completion: options.completion,
    includeInactive: options.includeInactive,
    timeoutMs: options.timeoutMs,
    maxTokens: options.maxTokens,
    modelOverrides:
      options.model && selectedProviders[0]
        ? { [selectedProviders[0]]: options.model }
        : undefined,
  };
  const report = await (dependencies.validate ?? validateAiProviderCredentials)(
    validationOptions,
  );
  const safeReport = scrubReport(
    report,
    dependencies.environment ?? process.env,
  );
  (dependencies.write ?? ((text: string) => process.stdout.write(text)))(
    `${JSON.stringify(safeReport, null, 2)}\n`,
  );
  if (
    report.summary.failedCredentials > 0 ||
    report.summary.skippedCredentials > 0
  )
    process.exitCode = 1;
}

const invokedPath = process.argv[1]
  ? resolve(process.argv[1]).toLowerCase()
  : "";
const modulePath = resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (invokedPath === modulePath) {
  runAiProviderValidatorCli(process.argv.slice(2)).catch(() => {
    process.stdout.write(`${JSON.stringify({ status: "INVALID_REQUEST" })}\n`);
    process.exitCode = 1;
  });
}
