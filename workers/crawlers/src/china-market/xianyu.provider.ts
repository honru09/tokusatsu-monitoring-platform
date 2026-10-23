import { createHash } from "node:crypto";
import { normalizeHttpBaseUrl } from "@tokusatsu/shared";
import type { ChinaMarketProvider, RawChinaMarketOffer } from "./types.js";
import { safePublicHttpsImageUrl } from "./url-safety.js";

type ActorRow = Record<string, unknown>;

type OfferObservationContext = {
  freshSuccessfulApifySearchAt?: string;
};

/** A provider response indicates login, CAPTCHA, verification, or risk control.
 *
 * This is deliberately a small, typed error so the comparison processor can
 * distinguish an operator/provider block from a successful search that simply
 * returned no matching rows. The response body is never retained on the error.
 */
export class XianyuProviderBlockedError extends Error {
  readonly code = "provider_blocked" as const;

  constructor(context: string, signal: string) {
    super(`Xianyu ${context} blocked by provider (${signal})`);
    this.name = "XianyuProviderBlockedError";
  }
}

export class XianyuProviderRateLimitError extends Error {
  readonly code = "provider_rate_limited" as const;

  constructor(
    context: string,
    readonly retryAfterMs: number,
  ) {
    super(
      `Xianyu ${context} rate limited the request; retry after ${Math.ceil(retryAfterMs / 1_000)} seconds`,
    );
    this.name = "XianyuProviderRateLimitError";
  }
}

const PROVIDER_BLOCK_SIGNALS: Array<[RegExp, string]> = [
  [/captcha/i, "captcha"],
  [/(?:verification|verify|challenge)/i, "verification"],
  [/risk[-_ ]?control|risk_control|riskcontrol/i, "risk-control"],
  [
    /(?:\blogin\b|login[_-]?(?:required|expired)|logged[_-]?in["']?\s*:\s*false|auth(?:entication)?[_-]?required|sign[ -]?in|登录|登入|未登录|请先登录|需要登录|登录(?:失效|过期|已失效))/i,
    "login",
  ],
  [
    /滑块|验证码|安全验证|安全校验|身份验证|人机验证|风控|访问受限|异常流量/i,
    "中文风控",
  ],
];

const MAX_PROVIDER_RESPONSE_BYTES = 4_000_000;
const MAX_PROVIDER_STATUS_NODES = 20_000;
const MAX_PROVIDER_STATUS_DEPTH = 64;
const MAX_PROVIDER_STATUS_TEXT = 250_000;
const MAX_LISTING_TITLE_LENGTH = 500;
const MAX_LISTING_CONDITION_LENGTH = 240;

type ProviderFailureKind = "rate_limit" | "failure";

function nonEmptyProviderError(value: unknown) {
  if (value == null || value === false) return false;
  if (typeof value === "string")
    return !/^(?:|false|none|null|ok|success)$/i.test(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function providerFailureKind(
  envelope: Record<string, unknown>,
): ProviderFailureKind | undefined {
  const explicitFailure = [
    envelope.success,
    envelope.ok,
    envelope.succeeded,
  ].some((value) => value === false || value === "false");
  const rawCode =
    envelope.errorCode ??
    envelope.error_code ??
    envelope.code ??
    envelope.errno;
  const code =
    typeof rawCode === "string" || typeof rawCode === "number"
      ? String(rawCode).trim()
      : "";
  const successfulCode = /^(?:0|200|ok|success|succeeded)$/i.test(code);
  const failureCode = Boolean(code) && !successfulCode;
  const message = stringValue(
    envelope.errorMessage,
    envelope.error_message,
    envelope.message,
    envelope.msg,
    envelope.reason,
    typeof envelope.error === "string" ? envelope.error : undefined,
  );
  const rateLimitSignal = `${code}\n${message}`;
  if (
    /(?:^|[^a-z])(?:rate[_ -]?limit(?:ed)?|too[_ -]?many[_ -]?requests|http[_ -]?429)(?:[^a-z]|$)|(?:请求)?(?:过于)?频繁|限流/i.test(
      rateLimitSignal,
    )
  )
    return "rate_limit";
  const failureMessage =
    /(?:error|fail(?:ed|ure)?|exception|unavailable|system[_ -]?busy|timeout|try[_ -]?again|denied|forbidden|unauthori[sz]ed|invalid[_ -]?(?:request|response)|系统(?:繁忙|异常|错误)|服务(?:繁忙|异常|不可用)|请求失败|操作失败|稍后重试)/i.test(
      message,
    );
  if (
    explicitFailure ||
    failureCode ||
    failureMessage ||
    nonEmptyProviderError(envelope.error) ||
    nonEmptyProviderError(envelope.errors)
  )
    return "failure";
  return undefined;
}

function providerBlockSignal(body: string) {
  const raw = body.trim();
  let searchable = raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const values: string[] = [];
    const stack: Array<{ value: unknown; key?: string; depth: number }> = [
      { value: parsed, depth: 0 },
    ];
    let visited = 0;
    let textLength = 0;
    while (stack.length) {
      const { value, key: rawKey, depth } = stack.pop()!;
      visited += 1;
      if (
        visited > MAX_PROVIDER_STATUS_NODES ||
        depth > MAX_PROVIDER_STATUS_DEPTH
      )
        return "excessive status envelope";
      const key = rawKey?.replace(/[^a-z\d]/gi, "").toLowerCase() ?? "";
      if (
        value === false &&
        /^(?:loggedin|isloggedin|authenticated|isauthenticated|sessionvalid|tokenvalid)$/.test(
          key,
        )
      )
        return "login";
      if (value === true) {
        if (
          /^(?:loginrequired|requireslogin|needlogin|authrequired|loginexpired|sessionexpired|tokenexpired)$/.test(
            key,
          )
        )
          return "login";
        if (/^(?:captcharequired|needcaptcha|hascaptcha)$/.test(key))
          return "captcha";
        if (
          /^(?:verificationrequired|requiresverification|challengerequired|needverification)$/.test(
            key,
          )
        )
          return "verification";
        if (/^(?:riskcontrol|riskcontrolled|accessrestricted)$/.test(key))
          return "risk-control";
      }
      if (typeof value === "string") {
        if (
          !rawKey ||
          /message|msg|hint|notice|error|code|status|reason|detail|login|auth|verify|captcha|challenge|risk/i.test(
            rawKey,
          )
        ) {
          values.push(value);
          textLength += value.length;
          if (textLength > MAX_PROVIDER_STATUS_TEXT)
            return "excessive status text";
        }
        continue;
      }
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1)
          stack.push({ value: value[index], key: rawKey, depth: depth + 1 });
        continue;
      }
      if (value && typeof value === "object") {
        const entries = Object.entries(value);
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const [childKey, childValue] = entries[index]!;
          stack.push({ value: childValue, key: childKey, depth: depth + 1 });
        }
      }
    }
    searchable = values.join("\n");
  } catch {
    // HTML/challenge pages are not JSON, so inspect their complete body.
  }
  for (const [pattern, label] of PROVIDER_BLOCK_SIGNALS)
    if (pattern.test(searchable)) return label;
  return undefined;
}

async function readResponseBodyWithinLimit(
  response: Response,
  context: string,
) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_RESPONSE_BYTES
  )
    throw new Error(`Xianyu ${context} response exceeded the size limit`);
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel("provider response size limit exceeded");
        throw new Error(`Xianyu ${context} response exceeded the size limit`);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

/** Read a provider response once, checking its contents without persisting it. */
async function readProviderPayload(
  response: Response,
  context: string,
): Promise<unknown> {
  const body = await readResponseBodyWithinLimit(response, context);
  let redirectSignal: string | undefined;
  if (response.redirected && response.url) {
    try {
      const redirected = new URL(response.url);
      const redirectTarget = `${redirected.pathname}\n${redirected.search}`;
      for (const [pattern, label] of PROVIDER_BLOCK_SIGNALS) {
        if (pattern.test(redirectTarget)) {
          redirectSignal = label;
          break;
        }
      }
    } catch {
      redirectSignal = "invalid redirect";
    }
  }
  const signal = redirectSignal ?? providerBlockSignal(body);
  if (signal) throw new XianyuProviderBlockedError(context, signal);
  if (!body.trim()) return {};
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    if (
      response.headers.get("content-type")?.toLowerCase().includes("text/html")
    )
      throw new XianyuProviderBlockedError(context, "html challenge");
    // Preserve status-specific errors for non-JSON error bodies while still
    // checking the raw text above for provider block signals.
    if (!response.ok) return body;
    throw new Error(`Xianyu ${context} returned invalid JSON`);
  }
  // Preserve HTTP 429/401/etc. so callers retain their cooldown/auth handling.
  if (!response.ok) return payload;
  // Inspect envelopes only: listing content must not decide request success.
  const envelopes = [payload];
  for (let index = 0; index < envelopes.length; index += 1) {
    if (index >= MAX_PROVIDER_STATUS_NODES)
      throw new Error(
        `Xianyu ${context} response envelope exceeded the size limit`,
      );
    const envelope = record(envelopes[index]);
    const failureKind = providerFailureKind(envelope);
    if (failureKind === "rate_limit")
      throw new XianyuProviderRateLimitError(
        context,
        retryAfterMilliseconds(response),
      );
    if (failureKind === "failure")
      throw new Error(`Xianyu ${context} reported an unsuccessful response`);
    for (const key of ["data", "result", "payload", "response"]) {
      const nested = envelope[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested))
        envelopes.push(nested);
    }
  }
  return payload;
}

function retryAfterMilliseconds(response: Response) {
  const raw = response.headers.get("retry-after")?.trim();
  let milliseconds = Number.NaN;
  if (raw && /^\d+(?:\.\d+)?$/.test(raw)) milliseconds = Number(raw) * 1_000;
  else if (raw) milliseconds = Date.parse(raw) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0)
    milliseconds = 15 * 60_000;
  return Math.max(60_000, Math.min(Math.ceil(milliseconds), 6 * 60 * 60_000));
}

function throwProviderHttpError(response: Response, context: string) {
  if (response.status === 401 || response.status === 403)
    throw new XianyuProviderBlockedError(context, "authentication");
  if (response.status === 409)
    throw new XianyuProviderBlockedError(context, "verification");
  if (response.status === 429)
    throw new XianyuProviderRateLimitError(
      context,
      retryAfterMilliseconds(response),
    );
  if (!response.ok)
    throw new Error(`Xianyu ${context} returned ${response.status}`);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return "";
}

function priceValue(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    return priceValue(
      value
        .map((entry) =>
          entry && typeof entry === "object"
            ? stringValue(
                record(entry).text,
                record(entry).value,
                record(entry).amount,
              )
            : String(entry ?? ""),
        )
        .join(""),
    );
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    return priceValue(row.amount ?? row.value ?? row.price);
  }
  const normalized = String(value ?? "")
    .replace(/[,，\s]/g, "")
    .replace(/(?:当前价|起拍价|一口价|售价|价格)/g, "")
    .replace(/元$/, "")
    .replace(/^(?:CNY|RMB|¥|￥)/i, "");
  const wan = normalized.match(/^(\d+(?:\.\d+)?)万$/);
  const numeric = normalized.match(/^(?:¥|￥)?(\d+(?:\.\d+)?)$/i);
  const parsed = wan
    ? Number(wan[1]) * 10_000
    : Number(numeric?.[1] ?? Number.NaN);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : undefined;
}

function firstImage(row: ActorRow) {
  const values = [
    row.pictureUrl,
    row.imageUrl,
    row.picUrl,
    row.thumbnail,
    row.image,
    row["商品图片链接"],
    row["商品图片"],
    ...(Array.isArray(row.images) ? row.images : []),
  ];
  for (const value of values) {
    const candidate =
      typeof value === "string"
        ? value
        : stringValue(record(value).url, record(value).src);
    if (!candidate) continue;
    const url = safePublicHttpsImageUrl(candidate, "https://www.goofish.com");
    if (url) return url;
  }
  return undefined;
}

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 240)
    : undefined;
}

function metadataBadges(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const badges = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 12);
  return badges.length ? badges : undefined;
}

/**
 * Accept the result envelope emitted by browser-bridge/search services while
 * keeping provider-specific nesting out of the matcher. Direct normalized
 * fields always win over derived fields so an upstream adapter can override a
 * stale nested value explicitly.
 */
function flattenProviderRow(row: ActorRow): ActorRow {
  const data = record(row.data);
  const item = record(data.item);
  const main = record(item.main);
  const exContent = record(main.exContent);
  const clickArgs = record(record(main.clickParam).args);
  return {
    ...exContent,
    ...clickArgs,
    ...item,
    ...main,
    ...row,
    targetUrl: row.targetUrl ?? main.targetUrl ?? item.targetUrl,
    itemUrl: row.itemUrl ?? main.targetUrl ?? item.targetUrl,
    status:
      row.status ??
      row.saleStatus ??
      exContent.status ??
      exContent.saleStatus ??
      main.status,
    itemId:
      row.itemId ??
      row.platformItemId ??
      exContent.itemId ??
      main.itemId ??
      clickArgs.itemId,
    title: row.title ?? exContent.title,
    price: row.price ?? exContent.price,
    priceCurrent: row.priceCurrent ?? exContent.price,
    pictureUrl: row.pictureUrl ?? exContent.picUrl,
    area: row.area ?? exContent.area,
  };
}

type VerifiedGoofishListing = { id: string; url: string };

function verifiedGoofishListing(value: string): VerifiedGoofishListing | null {
  if (!value) return null;
  try {
    if (/^fleamarket:\/\//i.test(value)) {
      const deepLink = new URL(value);
      const deepPath = deepLink.pathname.replace(/\/+$/, "");
      if (
        deepLink.username ||
        deepLink.password ||
        !(
          deepLink.hostname.toLowerCase() === "item" ||
          /^\/item$/i.test(deepPath)
        )
      )
        return null;
      const deepQueryIds = deepLink.searchParams.getAll("id");
      if (deepQueryIds.length > 1) return null;
      const deepId =
        deepQueryIds[0]?.trim() ||
        (/^\/item\//i.test(deepLink.pathname)
          ? deepLink.pathname.split("/").filter(Boolean).at(-1)?.trim()
          : undefined);
      return deepId && validListingId(deepId)
        ? {
            id: deepId,
            url: `https://www.goofish.com/item?id=${encodeURIComponent(deepId)}`,
          }
        : null;
    }
    const url = new URL(value, "https://www.goofish.com");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/(?:^|\.)goofish\.com$/i.test(url.hostname)
    )
      return null;
    const itemPath = url.pathname.match(/^\/item(?:\/([^/]+))?\/?$/i);
    if (!itemPath) return null;
    const queryIds = url.searchParams.getAll("id");
    if (queryIds.length > 1) return null;
    const queryId = queryIds[0]?.trim();
    const pathId = itemPath[1]?.trim();
    if (queryId && pathId && queryId !== pathId) return null;
    const listingId = queryId || pathId;
    if (listingId && validListingId(listingId))
      return {
        id: listingId,
        url: `https://www.goofish.com/item?id=${encodeURIComponent(listingId)}`,
      };
    return null;
  } catch {
    return null;
  }
}

function validListingId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(value);
}

function offerStatus(row: ActorRow, nestedItem: Record<string, unknown>) {
  // detailStatus describes the provider's requested detail level (for example
  // "summary") and is not marketplace availability evidence.
  const value = stringValue(
    row.itemStatus,
    row.item_status,
    row.saleStatus,
    row.sale_status,
    row.status,
    row.statusLabel,
    row["商品状态"],
    row["状态"],
    nestedItem.itemStatus,
    nestedItem.saleStatus,
    nestedItem.status,
  );
  if (typeof row.isSold === "boolean" && row.isSold) return "sold" as const;
  if (typeof row.isActive === "boolean")
    return row.isActive ? ("active" as const) : ("ended" as const);
  if (/sold|已售|售出|成交/i.test(value)) return "sold" as const;
  if (
    /offline|ended|deleted|reserved|inactive|closed|下架|已下架|已预定|已预订|关闭/i.test(
      value,
    )
  )
    return "ended" as const;
  if (
    /^(?:active|online|on[_ -]?sale|selling|available|在售|出售中|上架中|有效)$/i.test(
      value,
    )
  )
    return "active" as const;
  return "unknown" as const;
}

function hasDetailFailure(row: ActorRow) {
  for (const value of [
    row.detailError,
    row.detail_error,
    row.fetchError,
    row.fetch_error,
  ]) {
    if (value === true) return true;
    if (
      typeof value === "string" &&
      value.trim() &&
      !/^(?:none|null|success|ok)$/i.test(value.trim())
    )
      return true;
  }
  return false;
}

function statusFromFreshApifySummary(
  row: ActorRow,
  status: RawChinaMarketOffer["status"],
  provenance: RawChinaMarketOffer["provenance"] | undefined,
  observation: OfferObservationContext | undefined,
) {
  if (
    status !== "unknown" ||
    !observation?.freshSuccessfulApifySearchAt ||
    !provenance?.providerKey.startsWith("apify:") ||
    !provenance.providerRunId ||
    !/^summary$/i.test(stringValue(row.detailStatus)) ||
    hasDetailFailure(row)
  )
    return undefined;
  const explicitState = stringValue(
    row.itemStatus,
    row.item_status,
    row.saleStatus,
    row.sale_status,
    row.status,
    row.statusLabel,
    row["商品状态"],
    row["状态"],
  );
  if (
    /sold|offline|ended|deleted|reserved|inactive|closed|preorder|已售|售出|成交|下架|预售|预约|求购|关闭/i.test(
      explicitState,
    )
  )
    return undefined;
  return observation.freshSuccessfulApifySearchAt;
}

export function parseXianyuProviderRow(
  row: ActorRow,
  provenance?: RawChinaMarketOffer["provenance"],
  observation?: OfferObservationContext,
): RawChinaMarketOffer | null {
  row = flattenProviderRow(row);
  const nestedItem = record(row.item);
  const declaredIds = [
    row.platformItemId,
    row.platform_item_id,
    row.itemId,
    row.item_id,
    nestedItem.platformItemId,
    nestedItem.itemId,
    row["商品ID"],
    row["商品编号"],
  ]
    .map((value) => stringValue(value))
    .filter(Boolean);
  const rawUrl = stringValue(
    row.url,
    row.itemUrl,
    row.sourceUrl,
    row.link,
    row.targetUrl,
    row["商品链接"],
    nestedItem.url,
  );
  const verifiedListing = verifiedGoofishListing(rawUrl);
  const titleRaw = stringValue(
    row.title,
    row.name,
    row.itemTitle,
    row["商品标题"],
    nestedItem.title,
  );
  const priceCny = priceValue(
    row.price ??
      row.currentPrice ??
      row.priceCurrent ??
      row["当前售价"] ??
      nestedItem.price,
  );
  if (!verifiedListing || !titleRaw || priceCny == null) return null;
  if (titleRaw.length > MAX_LISTING_TITLE_LENGTH) return null;
  if (declaredIds.some((id) => id !== verifiedListing.id)) return null;
  const currency = stringValue(row.currency, row.priceCurrency, "CNY");
  if (!/^(?:CNY|RMB|CN¥|¥)$/i.test(currency)) return null;
  const explicitStatus = offerStatus(row, nestedItem);
  const freshSummaryObservedAt = statusFromFreshApifySummary(
    row,
    explicitStatus,
    provenance,
    observation,
  );
  const conditionRaw =
    stringValue(
      row.condition,
      row.conditionLabel,
      row["成色"],
      nestedItem.condition,
    ) || undefined;
  if (conditionRaw && conditionRaw.length > MAX_LISTING_CONDITION_LENGTH)
    return null;
  return {
    platform: "xianyu",
    sourceListingId: verifiedListing.id,
    sourceUrl: verifiedListing.url,
    titleRaw,
    priceCny,
    imageUrl: firstImage({ ...nestedItem, ...row }),
    conditionRaw,
    status: freshSummaryObservedAt ? "active" : explicitStatus,
    sourceData: {
      detailStatus: metadataString(row.detailStatus),
      listingType: metadataString(row.listingType),
      categoryName: metadataString(row.categoryName),
      categoryPath: metadataString(row.categoryPath),
      badges: metadataBadges(row.badges),
      postedAt: metadataString(row.postedAt),
      freeShipping:
        typeof row.freeShipping === "boolean" ? row.freeShipping : undefined,
      isAd: typeof row.isAd === "boolean" ? row.isAd : undefined,
      isB2C: typeof row.isB2C === "boolean" ? row.isB2C : undefined,
      isAuction: typeof row.isAuction === "boolean" ? row.isAuction : undefined,
      availabilityEvidence: freshSummaryObservedAt
        ? "apify_current_search_result"
        : undefined,
      availabilityObservedAt: freshSummaryObservedAt,
    },
    provenance,
  };
}

function rowsFromPayload(payload: unknown): ActorRow[] | null {
  if (Array.isArray(payload))
    return payload.filter(
      (value): value is ActorRow =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
    );
  const root = record(payload);
  const data = record(root.data);
  const nestedData = record(data.data);
  let sawArray = false;
  for (const candidate of [
    root.items,
    root.data_list,
    root["商品列表"],
    root.resultList,
    root.results,
    root.offers,
    root.records,
    root.list,
    root.data,
    data.items,
    data.data_list,
    data["商品列表"],
    data.resultList,
    data.results,
    data.offers,
    data.records,
    data.list,
    data.data,
    nestedData.items,
    nestedData.data_list,
    nestedData["商品列表"],
    nestedData.resultList,
    nestedData.results,
    nestedData.offers,
    nestedData.records,
    nestedData.list,
  ]) {
    if (!Array.isArray(candidate)) continue;
    sawArray = true;
    const rows = rowsFromPayload(candidate);
    if (rows?.length) return rows;
  }
  return sawArray ? [] : null;
}

function providerReportedPositiveCount(payload: unknown) {
  const root = record(payload);
  const data = record(root.data);
  for (const value of [
    root.total_results,
    root.totalResults,
    root.total,
    root.count,
    data.total_results,
    data.totalResults,
    data.total,
    data.count,
  ]) {
    const count = Number(value);
    if (Number.isFinite(count) && count > 0) return true;
  }
  return false;
}

function providerDeadlineMs() {
  const value = Number(process.env.XIANYU_PROVIDER_DEADLINE_MS ?? 180_000);
  if (!Number.isFinite(value)) return 180_000;
  return Math.max(30_000, Math.min(Math.floor(value), 10 * 60_000));
}

function remainingTimeout(deadlineAt: number, maximum: number) {
  const remaining = deadlineAt - Date.now();
  if (remaining < 1_000) throw new Error("Xianyu provider deadline exceeded");
  return Math.max(1, Math.min(remaining, maximum));
}

type ApifyRun = {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
  finishedAt?: string;
};

class ApifyRunTerminalError extends Error {
  constructor(
    readonly runId: string,
    readonly status: string,
  ) {
    super(`Xianyu Apify actor failed: ${status}`);
    this.name = "ApifyRunTerminalError";
  }
}

function recentApifyCompletion(value: string | undefined) {
  const finishedAt = Date.parse(value ?? "");
  return (
    Number.isFinite(finishedAt) &&
    finishedAt <= Date.now() + 5 * 60_000 &&
    Date.now() - finishedAt <= 30 * 60_000
  );
}

async function fetchDataset(
  datasetId: string,
  token: string,
  deadlineAt: number,
) {
  const response = await fetch(
    `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(remainingTimeout(deadlineAt, 30_000)),
    },
  );
  const payload = await readProviderPayload(response, "Apify dataset");
  throwProviderHttpError(response, "Apify dataset");
  const rows = rowsFromPayload(payload);
  if (rows == null)
    throw new Error(
      "Xianyu Apify dataset returned an unsupported response shape",
    );
  return rows;
}

async function waitForApifyRun(
  initial: ApifyRun,
  token: string,
  deadlineAt: number,
) {
  let run = initial;
  for (;;) {
    if (run.status === "SUCCEEDED" && run.defaultDatasetId) return run;
    if (/^(?:FAILED|ABORTED|TIMED-OUT)$/i.test(run.status ?? ""))
      throw new ApifyRunTerminalError(run.id ?? "unknown", run.status!);
    if (!run.id)
      throw new Error(
        `Xianyu Apify actor did not provide a run id: ${run.status ?? "unknown"}`,
      );
    const timeout = remainingTimeout(deadlineAt, 125_000);
    const waitSeconds = Math.max(1, Math.min(120, Math.floor(timeout / 1_000)));
    const response = await fetch(
      `https://api.apify.com/v2/actor-runs/${encodeURIComponent(run.id)}?waitForFinish=${waitSeconds}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeout),
      },
    );
    const payload = await readProviderPayload(response, "Apify actor run");
    throwProviderHttpError(response, "Apify actor run");
    run = (payload as { data?: ApifyRun }).data ?? {};
  }
}

async function runApify(
  keyword: string,
  limit: number,
  deadlineAt: number,
  context?: Parameters<ChinaMarketProvider["search"]>[2],
) {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error("APIFY_TOKEN is required for Xianyu comparison");
  const actor = (
    process.env.XIANYU_APIFY_ACTOR ?? "zen-studio~goofish-xianyu-search-scraper"
  ).replace(/\//g, "~");
  const resumeRunId = context?.resumeProviderRuns?.[keyword]?.trim();
  let initialRun: ApifyRun;
  if (resumeRunId) {
    initialRun = { id: resumeRunId, status: "RUNNING" };
  } else {
    const timeout = remainingTimeout(deadlineAt, 130_000);
    const waitSeconds = Math.max(1, Math.min(120, Math.floor(timeout / 1_000)));
    const response = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/runs?waitForFinish=${waitSeconds}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          keyword,
          maxItems: limit,
          detailLevel: "summary",
          sortBy: "relevance",
        }),
        signal: AbortSignal.timeout(timeout),
      },
    );
    const payload = await readProviderPayload(response, "Apify actor");
    throwProviderHttpError(response, "Apify actor");
    initialRun = (payload as { data?: ApifyRun }).data ?? {};
    if (initialRun.id && context?.onProviderRun)
      await context.onProviderRun(keyword, initialRun.id);
  }
  let run: ApifyRun;
  try {
    run = await waitForApifyRun(initialRun, token, deadlineAt);
  } catch (error) {
    if (
      error instanceof ApifyRunTerminalError &&
      context?.onProviderRunTerminal
    )
      await context.onProviderRunTerminal(keyword, error.runId, error.status);
    throw error;
  }
  if (resumeRunId && !recentApifyCompletion(run.finishedAt)) {
    if (context?.onProviderRunTerminal)
      await context.onProviderRunTerminal(keyword, resumeRunId, "STALE");
    throw new Error(
      "Xianyu resumed Apify run is too old to prove a current search observation",
    );
  }
  const rows = await fetchDataset(run.defaultDatasetId!, token, deadlineAt);
  return {
    rows,
    providerKey: `apify:${actor}`,
    providerRunId: run.id,
    freshSuccessfulApifySearchAt: new Date().toISOString(),
  };
}

async function runSearchService(
  keyword: string,
  limit: number,
  deadlineAt: number,
) {
  const configuredEndpoint = process.env.XIANYU_SEARCH_API_URL?.trim();
  const endpoint = configuredEndpoint
    ? normalizeHttpBaseUrl(configuredEndpoint)
    : undefined;
  if (!endpoint) return null;
  const token = process.env.XIANYU_SEARCH_API_TOKEN?.trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ keyword, limit, maxItems: limit }),
    signal: AbortSignal.timeout(remainingTimeout(deadlineAt, 60_000)),
  });
  const payload = await readProviderPayload(response, "search provider");
  throwProviderHttpError(response, "search provider");
  const rows = rowsFromPayload(payload);
  if (rows == null)
    throw new Error(
      "Xianyu search provider returned an unsupported response shape",
    );
  if (!rows.length && providerReportedPositiveCount(payload))
    throw new Error(
      "Xianyu search provider returned only counts; configure it to return result rows",
    );
  const endpointIdentity = createHash("sha256")
    .update(endpoint)
    .digest("hex")
    .slice(0, 16);
  return {
    rows,
    providerKey: `search_api:${endpointIdentity}`,
    providerRunId: undefined,
  };
}

export function xianyuProviderConfigured() {
  return (
    process.env.CHINA_MARKET_COMPARISON_AUTHORIZED === "true" &&
    Boolean(
      process.env.XIANYU_SEARCH_API_URL?.trim() ||
        process.env.APIFY_TOKEN?.trim(),
    )
  );
}

export function xianyuComparisonEnabled() {
  return (
    process.env.CHINA_MARKET_COMPARISON_ENABLED === "true" &&
    process.env.XIANYU_COMPARISON_ENABLED === "true" &&
    xianyuProviderConfigured()
  );
}

function requestIntervalMs() {
  const value = Number(process.env.XIANYU_REQUEST_INTERVAL_MS ?? 3_000);
  if (process.env.NODE_ENV === "test" && value === 0) return 0;
  if (!Number.isFinite(value) || value <= 0) return 3_000;
  return Math.max(1_000, Math.min(Math.floor(value), 60_000));
}

function offerStatusRank(status: RawChinaMarketOffer["status"]) {
  // A terminal marketplace state is explicit negative evidence and must beat
  // the weaker "present in this search page" active inference.
  if (status === "sold" || status === "ended") return 4;
  if (status === "active") return 3;
  if (status === "unknown") return 2;
  return 1;
}

function offerEvidenceCompleteness(offer: RawChinaMarketOffer) {
  return [
    offer.imageUrl,
    offer.conditionRaw,
    offer.sourceData?.detailStatus,
    offer.sourceData?.availabilityEvidence,
  ].filter(Boolean).length;
}

function sameObservedListingFacts(
  left: RawChinaMarketOffer,
  right: RawChinaMarketOffer,
) {
  return (
    left.sourceUrl === right.sourceUrl &&
    left.titleRaw.normalize("NFKC").replace(/\s+/g, " ").trim() ===
      right.titleRaw.normalize("NFKC").replace(/\s+/g, " ").trim() &&
    left.priceCny === right.priceCny
  );
}

async function searchXianyuOffersWithStats(
  keywords: string[],
  totalLimit: number,
  context?: Parameters<ChinaMarketProvider["search"]>[2],
) {
  if (process.env.CHINA_MARKET_COMPARISON_AUTHORIZED !== "true")
    return {
      offers: [],
      complete: false,
      stats: { requestedKeywords: 0, attemptedKeywords: 0, rejectedRows: 0 },
    };
  const uniqueKeywords = [
    ...new Set(
      keywords
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim()),
    ),
  ]
    .filter(Boolean)
    .slice(0, 8);
  if (!uniqueKeywords.length)
    return {
      offers: [],
      complete: true,
      stats: { requestedKeywords: 0, attemptedKeywords: 0, rejectedRows: 0 },
    };
  const requestedLimit = Number.isFinite(totalLimit)
    ? Math.floor(totalLimit)
    : 20;
  const boundedLimit = Math.max(20, Math.min(requestedLimit, 50));
  const offers = new Map<string, RawChinaMarketOffer>();
  const conflictedListings = new Set<string>();
  let rejectedRows = 0;
  let attemptedKeywords = 0;
  const deadlineAt = Date.now() + providerDeadlineMs();
  for (const [index, keyword] of uniqueKeywords.entries()) {
    const remainingKeywords = uniqueKeywords.length - index;
    const remainingBudget = boundedLimit - offers.size;
    const requestLimit = Math.max(
      3,
      Math.min(remainingBudget, Math.ceil(remainingBudget / remainingKeywords)),
    );
    const batch =
      (await runSearchService(keyword, requestLimit, deadlineAt)) ??
      (await runApify(keyword, requestLimit, deadlineAt, context));
    attemptedKeywords += 1;
    for (const row of batch.rows) {
      const offer = parseXianyuProviderRow(
        row,
        {
          providerKey: batch.providerKey,
          providerRunId: batch.providerRunId,
          queryKeyword: keyword,
        },
        {
          freshSuccessfulApifySearchAt:
            "freshSuccessfulApifySearchAt" in batch
              ? batch.freshSuccessfulApifySearchAt
              : undefined,
        },
      );
      if (!offer) {
        rejectedRows += 1;
        continue;
      }
      const key = `${offer.platform}:${offer.sourceListingId}`;
      if (conflictedListings.has(key)) continue;
      const existing = offers.get(key);
      if (!existing) offers.set(key, offer);
      else if (!sameObservedListingFacts(existing, offer)) {
        // Conflicting prices or identities for one marketplace id are not a
        // basis for choosing a convenient row. Quarantine that listing for
        // the entire refresh and expose the conflict in rejectedRows.
        offers.delete(key);
        conflictedListings.add(key);
        rejectedRows += 1;
      } else if (
        offerStatusRank(offer.status) > offerStatusRank(existing.status) ||
        (offer.status === existing.status &&
          offerEvidenceCompleteness(offer) >
            offerEvidenceCompleteness(existing))
      )
        offers.set(key, offer);
      if (offers.size >= boundedLimit) break;
    }
    if (offers.size >= boundedLimit) break;
    if (index < uniqueKeywords.length - 1) {
      const interval = requestIntervalMs();
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  return {
    offers: [...offers.values()].slice(0, boundedLimit),
    complete: attemptedKeywords === uniqueKeywords.length,
    stats: {
      requestedKeywords: uniqueKeywords.length,
      attemptedKeywords,
      rejectedRows,
    },
  };
}

export async function searchXianyuOffers(
  keywords: string[],
  totalLimit: number,
) {
  return (await searchXianyuOffersWithStats(keywords, totalLimit)).offers;
}

export const xianyuMarketProvider: ChinaMarketProvider = {
  key: "xianyu",
  search: searchXianyuOffersWithStats,
};

export function stableComparisonJobId(
  productId: string,
  marketplace: string = "xianyu",
) {
  return `china-comparison-${createHash("sha256")
    .update(`${marketplace}:${productId}`)
    .digest("hex")
    .slice(0, 24)}`;
}
