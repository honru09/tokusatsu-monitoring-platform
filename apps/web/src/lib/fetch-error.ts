/** Read a human-facing message from a failed fetch Response (proxy JSON or plain). */
export async function readFetchError(
  response: Response,
  fallback: string,
): Promise<string> {
  const raw = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) {
      const joined = parsed.message.filter(Boolean).join("；").trim();
      if (joined) return calmStatusMessage(joined, response.status, fallback);
    }
    if (typeof parsed.message === "string" && parsed.message.trim())
      return calmStatusMessage(
        parsed.message.trim(),
        response.status,
        fallback,
      );
  } catch {
    /* plain text */
  }
  const trimmed = raw.trim();
  if (trimmed && trimmed.length < 180 && !trimmed.startsWith("<"))
    return calmStatusMessage(trimmed, response.status, fallback);
  return calmStatusMessage("", response.status, fallback);
}

/** Prefer calm Chinese copy over raw "API 502" / status-only strings. */
export function calmStatusMessage(
  message: string,
  status: number,
  fallback: string,
): string {
  const trimmed = message.trim();
  if (/^API\s*[45]\d{2}$/i.test(trimmed) || /^[45]\d{2}$/.test(trimmed)) {
    if (status === 504 || trimmed.endsWith("504"))
      return "后台服务响应超时，请稍后重试";
    if (status === 502 || status === 503 || /502|503/.test(trimmed))
      return "后台服务暂时无法连接，请稍后重试";
    return fallback;
  }
  if (trimmed) return trimmed;
  if (status === 502 || status === 503)
    return "后台服务暂时无法连接，请稍后重试";
  if (status === 504) return "后台服务响应超时，请稍后重试";
  return fallback;
}
