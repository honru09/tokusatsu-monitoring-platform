import { isIP } from "node:net";

const PRIVATE_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
];

/**
 * Image URLs are dereferenced by the AI gateway, not merely displayed. Keep
 * obvious local-network and credential-bearing targets out of that outbound
 * request. DNS-level egress policy remains the final SSRF boundary.
 */
export function safePublicHttpsImageUrl(value: string, base?: string) {
  if (!value || value.length > 4_096) return undefined;
  try {
    const url = new URL(value, base);
    const hostname = url.hostname
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "")
      .toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !hostname ||
      isIP(hostname) !== 0 ||
      !hostname.includes(".") ||
      hostname === "localhost" ||
      PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    )
      return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}
