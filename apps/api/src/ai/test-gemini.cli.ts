import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGeminiProbe } from "./gemini-live-probe.js";
import { loadAiProviderEnvironment } from "./validate-ai-providers.cli.js";

function argumentValue(argv: string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function runGeminiProbeCli(
  argv = process.argv.slice(2),
  write: (value: string) => void = (value) => process.stdout.write(value),
) {
  const envPath = argumentValue(argv, "--env") ?? "../../.env";
  // Production containers receive secrets through their environment and do not
  // copy the host .env file into the image. Prefer the file when it exists, but
  // allow the same diagnostic command to run safely inside such a container.
  if (existsSync(resolve(envPath)) || !process.env.GEMINI_API_KEY?.trim())
    loadAiProviderEnvironment(envPath);
  const report = await runGeminiProbe({
    apiKey: process.env.GEMINI_API_KEY,
    baseUrl: process.env.GEMINI_API_URL,
  });
  const lines = [
    `Gemini API key: ${report.configured ? "configured" : "not configured"}`,
    "",
    "Base URL:",
    report.baseUrl,
    "",
    "Checking models...",
    report.catalogueOk ? "OK" : "FAILED",
    "",
    "Available preferred models:",
    ...report.preferred.map(
      (entry) =>
        `${entry.label}: ${entry.available ? `YES (${entry.model})` : "NO"}`,
    ),
    "",
  ];
  for (const candidate of report.candidates) {
    if (!candidate.model) continue;
    lines.push(
      "Testing candidate:",
      candidate.model,
      "",
      "Result:",
      candidate.ok ? "OK" : "FAILED",
      ...(candidate.failure
        ? [
            `HTTP status: ${candidate.failure.status ?? "n/a"}`,
            `error code: ${candidate.failure.code ?? "n/a"}`,
            `error type: ${candidate.failure.type ?? "n/a"}`,
            `error message: ${candidate.failure.message}`,
            `quota metric: ${candidate.failure.quotaMetric ?? "n/a"}`,
            `retry delay: ${candidate.failure.retryDelay ?? "n/a"}`,
          ]
        : []),
      "",
    );
  }
  lines.push(
    "Selected model:",
    report.selectedModel ?? "NONE",
    "",
    "Response:",
    report.response ?? report.catalogueFailure?.message ?? "NO_VALID_MODEL",
    "",
  );
  write(`${lines.join("\n")}\n`);
  if (!report.selectedModel) process.exitCode = 1;
  return report;
}

const invokedPath = process.argv[1]
  ? resolve(process.argv[1]).toLowerCase()
  : "";
if (invokedPath === fileURLToPath(import.meta.url).toLowerCase())
  void runGeminiProbeCli();
