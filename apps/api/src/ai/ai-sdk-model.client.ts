import { isIP } from "node:net";

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
