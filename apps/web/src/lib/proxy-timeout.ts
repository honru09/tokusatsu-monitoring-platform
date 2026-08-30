export function proxyTimeoutMs(path: string[]) {
  if (path[0] !== "ai") return 60_000;
  const configured = Number(process.env.AI_PROXY_TIMEOUT_MS ?? 270_000);
  return Math.max(
    250_000,
    Math.min(Number.isFinite(configured) ? configured : 270_000, 300_000),
  );
}
