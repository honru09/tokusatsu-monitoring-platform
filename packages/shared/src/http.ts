/**
 * Normalize an internal HTTP service address from environment/config input.
 * Render may expose a private service as `host:port` without a scheme. Keep
 * this helper strict so a malformed or non-HTTP value cannot silently route a
 * worker to an unintended protocol or host.
 */
export function normalizeHttpBaseUrl(
  value: string | undefined,
  fallback = "http://localhost:3001",
) {
  const raw = (value?.trim() || fallback).trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Internal service URL must use HTTP(S): ${raw}`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  )
    throw new Error(
      `Internal service URL must use HTTP(S) without credentials`,
    );
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}
