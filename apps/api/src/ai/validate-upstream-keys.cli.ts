import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UPSTREAM_PROVIDER_IDS,
  isUpstreamProvider,
  validateUpstreamApiKeys,
  type UpstreamProvider,
} from "./upstream-key-live-validator.js";

export type UpstreamValidatorCliOptions = {
  envPath: string;
  completion: boolean;
  providers: UpstreamProvider[];
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
};

const CREDENTIAL_NAMES = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
]);

function positiveInteger(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error("INVALID_REQUEST");
  return parsed;
}

function requiredValue(argv: string[], index: number) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error("INVALID_REQUEST");
  return value;
}

function validModel(value: string | undefined) {
  return Boolean(
    value && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(value),
  );
}

export function parseUpstreamValidatorArguments(
  argv: string[],
): UpstreamValidatorCliOptions {
  let envPath = ".env";
  let completion = false;
  let model: string | undefined;
  let timeoutMs: number | undefined;
  let maxTokens: number | undefined;
  const requestedProviders: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--completion") completion = true;
    else if (argument === "--env") {
      envPath = requiredValue(argv, ++index);
    } else if (argument === "--provider") {
      requestedProviders.push(
        ...requiredValue(argv, ++index)
          .split(",")
          .map((value) => value.trim().toLowerCase()),
      );
    } else if (argument === "--model") {
      model = requiredValue(argv, ++index).trim();
    } else if (argument === "--timeout-ms") {
      timeoutMs = positiveInteger(requiredValue(argv, ++index));
    } else if (argument === "--max-tokens") {
      maxTokens = positiveInteger(requiredValue(argv, ++index));
    } else throw new Error("INVALID_REQUEST");
  }
  if (
    requestedProviders.some((provider) => !isUpstreamProvider(provider)) ||
    new Set(requestedProviders).size !== requestedProviders.length
  )
    throw new Error("INVALID_REQUEST");
  const providers = requestedProviders.length
    ? requestedProviders.filter(isUpstreamProvider)
    : [...UPSTREAM_PROVIDER_IDS];
  if (model != null && !validModel(model)) throw new Error("INVALID_REQUEST");
  if (completion && (providers.length !== 1 || !validModel(model)))
    throw new Error("INVALID_REQUEST");
  if (!completion && (model != null || maxTokens != null))
    throw new Error("INVALID_REQUEST");
  return { envPath, completion, providers, model, timeoutMs, maxTokens };
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
        if (remainder && !remainder.startsWith("#"))
          throw new Error("INVALID_REQUEST");
        return value.slice(1, index);
      }
      escaped = false;
    }
    throw new Error("INVALID_REQUEST");
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function loadUpstreamEnvironment(
  path: string,
  readText: (absolutePath: string) => string = (absolutePath) =>
    readFileSync(absolutePath, "utf8"),
  environment: Record<string, string | undefined> = process.env,
) {
  const values = new Map<string, string>();
  let content: string;
  try {
    content = readText(resolve(path));
  } catch {
    throw new Error("INVALID_REQUEST");
  }
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const name = match?.[1];
    if (!name || !CREDENTIAL_NAMES.has(name)) continue;
    const value = dotenvValue(match[2] ?? "");
    const previous = values.get(name);
    if (previous != null && previous !== value)
      throw new Error("INVALID_REQUEST");
    values.set(name, value);
  }
  for (const [name, value] of values) {
    if (!environment[name]?.trim() && value) environment[name] = value;
  }
}

function reportFailed(
  report: Awaited<ReturnType<typeof validateUpstreamApiKeys>>,
) {
  return report.results.some(
    (result) =>
      result.catalogue.status !== "OK" ||
      (result.completion != null && result.completion.status !== "OK"),
  );
}

export async function runUpstreamValidatorCli(argv: string[]) {
  const options = parseUpstreamValidatorArguments(argv);
  loadUpstreamEnvironment(options.envPath);
  const report = await validateUpstreamApiKeys({
    providers: options.providers,
    completion: options.completion,
    model: options.model,
    timeoutMs: options.timeoutMs,
    maxTokens: options.maxTokens,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (reportFailed(report)) process.exitCode = 1;
}

const invokedPath = process.argv[1]
  ? resolve(process.argv[1]).toLowerCase()
  : "";
const modulePath = resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (invokedPath === modulePath) {
  runUpstreamValidatorCli(process.argv.slice(2)).catch(() => {
    process.stdout.write(`${JSON.stringify({ status: "INVALID_REQUEST" })}\n`);
    process.exitCode = 1;
  });
}
