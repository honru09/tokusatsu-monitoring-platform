import { isIP } from "node:net";

function normalizeForwardedIp(value: string | null) {
  if (!value) return undefined;
  const first = value.split(",", 1)[0]?.trim();
  if (!first) return undefined;
  const mapped = first.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const normalized = mapped ?? first.toLowerCase();
  return isIP(normalized) ? normalized : undefined;
}

export function forwardedClientIp(headers: Headers) {
  const cloudflare = headers.get("cf-connecting-ip");
  if (cloudflare !== null) return normalizeForwardedIp(cloudflare);
  return normalizeForwardedIp(headers.get("x-forwarded-for"));
}
