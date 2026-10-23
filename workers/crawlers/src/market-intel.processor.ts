import { MarketIntelKind, Prisma, prisma } from "@tokusatsu/db";
import { Firecrawl, type Document, type SearchResultWeb } from "firecrawl";
import * as cheerio from "cheerio";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { normalizeHttpBaseUrl } from "@tokusatsu/shared";
import {
  backgroundAiFetch,
  isAutomaticAiUnavailable,
} from "./background-ai-guard.js";

type RobotPolicy = {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
};
const require = createRequire(import.meta.url);
const robotsParser = require("robots-parser") as (
  url: string,
  text: string,
) => RobotPolicy;
const userAgent = process.env.CRAWLER_USER_AGENT ?? "TokusatsuMonitor/1.0";
const robotsCache = new Map<string, RobotPolicy>();

const QUERIES = [
  "仮面ライダー 中古 出品 OR 入荷 OR 在庫",
  "ウルトラマン 玩具 販売 OR 入荷 OR 在庫",
  "スーパー戦隊 玩具 出品 OR 販売 OR 入荷",
  "特撮 玩具 譲ります OR 出品 OR 販売",
  "特撮 中古 新入荷 OR 在庫 OR オークション",
  "site:chiebukuro.yahoo.co.jp 特撮 出品 OR 譲ります",
  "site:reddit.com tokusatsu for sale OR selling",
];
const RELEVANT =
  /仮面ライダー|ウルトラマン|スーパー戦隊|特撮|変身ベルト|ソフビ|フィギュア/i;
// "中古" alone also matches people merely asking about something they
// already bought.  Require a concrete sale, listing, stock or transfer signal
// so the workspace remains procurement intelligence rather than general chat.
const COMMERCE =
  /販売|売ります|売却|出品|入荷|在庫|買取|オークション|二手|譲り|譲ります|for sale|marketplace/i;
const EXCLUDED =
  /カード|トレカ|ガンバライド|ガンバライジング|ガンバレジェンズ|書籍|雑誌|漫画|コミック|小説|図鑑|写真集|大百科|帯付き|帯付|古本|永久保存版/i;
const FORUM_HOST =
  /reddit\.com|5ch\.net|2ch\.sc|chiebukuro\.yahoo\.co\.jp|note\.com|ameblo\.jp|b\.hatena\.ne\.jp/i;
const SOCIAL_HOST =
  /x\.com|twitter\.com|instagram\.com|facebook\.com|threads\.net|mastodon\.social|mstdn\.jp/i;
const FORUM_NAME = /知恵袋|reddit|5ch|2ch|掲示板|forum|はてな|\bnote\b/i;
const SOCIAL_NAME = /X \(|Twitter|Instagram|Facebook|Threads/i;
const LOW_QUALITY_SOURCE = /Suomen Tennisliitto|Universidad de Sevilla/i;
const MAX_AGE_DAYS = Math.max(
  7,
  Number(process.env.MARKET_INTEL_MAX_AGE_DAYS ?? 90),
);

type IntelCandidate = {
  url: string;
  title: string;
  sourceName: string;
  ingestion: "firecrawl" | "rss" | "mastodon";
  completeBody: boolean;
  bodyHint?: string;
  author?: string;
  publishedAt?: Date;
  client?: Firecrawl;
};

type PersistedMarketIntelRecord = {
  inserted: boolean;
};

export async function runMarketIntelTwoPhase<
  Candidate,
  Persisted extends PersistedMarketIntelRecord,
>(
  candidates: readonly Candidate[],
  persistOriginal: (candidate: Candidate) => Promise<Persisted | null>,
  translatePersisted: (record: Persisted) => Promise<void>,
  automaticAiUnavailable: (error: unknown) => boolean,
  onFailure?: (
    phase: "persistence" | "translation",
    error: unknown,
    value: Candidate | Persisted,
  ) => void,
) {
  const persisted: Persisted[] = [];
  let inserted = 0;
  let translated = 0;
  let failed = 0;
  let deferred = false;

  // Complete the non-AI ingestion phase first. A provider outage must never
  // prevent later public candidates from being stored in their original text.
  for (const candidate of candidates) {
    try {
      const record = await persistOriginal(candidate);
      if (!record) continue;
      persisted.push(record);
      if (record.inserted) inserted += 1;
    } catch (error) {
      failed += 1;
      onFailure?.("persistence", error, candidate);
    }
  }

  for (const record of persisted) {
    try {
      await translatePersisted(record);
      translated += 1;
    } catch (error) {
      failed += 1;
      onFailure?.("translation", error, record);
      if (automaticAiUnavailable(error)) {
        deferred = true;
        break;
      }
    }
  }

  return { inserted, translated, failed, deferred };
}

type MastodonStatus = {
  url?: string;
  created_at?: string;
  content?: string;
  account?: { display_name?: string; acct?: string };
};

function candidateKind(candidate: IntelCandidate) {
  const hostname = new URL(candidate.url).hostname;
  if (FORUM_HOST.test(hostname) || FORUM_NAME.test(candidate.sourceName))
    return MarketIntelKind.forum;
  if (SOCIAL_HOST.test(hostname) || SOCIAL_NAME.test(candidate.sourceName))
    return MarketIntelKind.post;
  return MarketIntelKind.news;
}

function chunks(text: string, max = 8_000) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > max) {
      if (current) result.push(current);
      for (let index = 0; index < paragraph.length; index += max)
        result.push(paragraph.slice(index, index + max));
      current = "";
    } else if (!current || current.length + paragraph.length + 2 <= max) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    } else {
      result.push(current);
      current = paragraph;
    }
  }
  if (current) result.push(current);
  return result.length ? result : [text.slice(0, max)];
}

async function gatewayJson<T>(
  messages: { role: string; content: string }[],
  maxTokens: number,
) {
  const token = process.env.AI_INTERNAL_TOKEN?.trim();
  if (!token) throw new Error("AI Gateway 内部令牌未配置");
  const apiBase = normalizeHttpBaseUrl(process.env.API_INTERNAL_URL);
  const body = JSON.stringify({
    task: "translation",
    responseSchemaId: "internal.market-intel-translation",
    responseSchemaVersion: 1,
    dataClass: "public_market",
    costPolicy: "free_first",
    temperature: 0.1,
    maxTokens,
    messages,
  });
  const requestKey = createHash("sha256")
    .update(body)
    .digest("hex")
    .slice(0, 20);
  const response = await backgroundAiFetch(
    `market-intel:${requestKey}`,
    `${apiBase}/ai/internal/execute`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-internal-token": token,
      },
      body,
      signal: AbortSignal.timeout(
        Math.max(
          250_000,
          Math.min(
            Number(process.env.AI_GATEWAY_CLIENT_TIMEOUT_MS ?? 270_000),
            300_000,
          ),
        ),
      ),
    },
  );
  if (!response.ok) throw new Error(`AI Gateway ${response.status}`);
  const payload = (await response.json()) as { data?: T };
  if (!payload.data) throw new Error("AI Gateway 返回为空");
  return payload.data;
}

async function translateComplete(titleRaw: string, bodyRaw: string) {
  const bodyParts = chunks(bodyRaw);
  let titleZh = "";
  const bodyZh: string[] = [];
  for (const [index, bodyPart] of bodyParts.entries()) {
    const result = await gatewayJson<{ titleZh?: unknown; bodyZh?: unknown }>(
      [
        {
          role: "system",
          content:
            '你是日本特摄采购资讯的专业翻译。把输入逐句完整翻译成自然简体中文，不得摘要、删减、合并事实或只翻译关键词；保留平台、用户名、价格、数量、时间、品相、出售意向、链接提示和引用关系。专名可保留原文并给中文说明。只输出 JSON：{"titleZh":"完整标题翻译","bodyZh":"完整正文翻译"}。',
        },
        {
          role: "user",
          content: JSON.stringify({
            titleRaw: index === 0 ? titleRaw : "",
            bodyRaw: bodyPart,
          }),
        },
      ],
      8_000,
    );
    if (index === 0 && typeof result.titleZh === "string")
      titleZh = result.titleZh.trim();
    if (typeof result.bodyZh !== "string" || !result.bodyZh.trim())
      throw new Error("AI Gateway 正文翻译不完整");
    bodyZh.push(result.bodyZh.trim());
  }
  return { titleZh: titleZh || titleRaw, bodyZh: bodyZh.join("\n\n") };
}

async function assertRobotsAllowed(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("仅抓取公开 HTTPS 资讯");
  const robotsUrl = `${url.origin}/robots.txt`;
  let policy = robotsCache.get(url.origin);
  if (!policy) {
    const response = await fetch(robotsUrl, {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`无法验证 robots.txt (${response.status})`);
    policy = robotsParser(robotsUrl, await response.text());
    robotsCache.set(url.origin, policy);
  }
  if (!policy.isAllowed(rawUrl, userAgent))
    throw new Error("robots.txt 不允许抓取");
}

function documentBody(document: Document) {
  return String(
    document.markdown ??
      document.metadata?.description ??
      document.metadata?.ogDescription ??
      "",
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 50_000);
}

async function firecrawlCandidates() {
  if (!process.env.FIRECRAWL_API_KEY) return [];
  const client = new Firecrawl({
    apiKey: process.env.FIRECRAWL_API_KEY,
    apiUrl: process.env.FIRECRAWL_API_URL ?? null,
    timeoutMs: 45_000,
    maxRetries: 2,
  });
  const candidates: IntelCandidate[] = [];
  for (const query of QUERIES) {
    const result = await client.search(query, {
      sources: ["web"],
      limit: 12,
      highlights: false,
      timeout: 30_000,
    });
    for (const row of result.web ?? []) {
      const web = row as SearchResultWeb;
      const url =
        web.url ??
        (row as Document).metadata?.sourceURL ??
        (row as Document).metadata?.url;
      const title = web.title ?? (row as Document).metadata?.title ?? "";
      if (!url || !title || candidates.some((entry) => entry.url === url))
        continue;
      const searchable = `${title} ${web.description ?? ""}`;
      if (
        !RELEVANT.test(searchable) ||
        !COMMERCE.test(searchable) ||
        EXCLUDED.test(searchable)
      )
        continue;
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      candidates.push({
        url,
        title,
        sourceName: hostname,
        ingestion: "firecrawl",
        completeBody: true,
        bodyHint: web.description?.trim() || undefined,
        client,
      });
    }
  }
  return candidates.slice(0, 32);
}

async function rssCandidates() {
  const feeds = [
    ...QUERIES.map((query) => ({
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`,
      sourceName: "Google News",
    })),
    // Public, robots-allowed discussion indexes. These are deliberately
    // queried with sale/stock terms so the intelligence workspace contains
    // actionable seller discussions rather than general fandom chatter.
    ...["仮面ライダー 出品", "仮面ライダー 売ります", "特撮 玩具 譲ります"].map(
      (query) => ({
        url: `https://b.hatena.ne.jp/q/${encodeURIComponent(query)}?target=text&sort=recent&mode=rss`,
        sourceName: "はてなブックマーク",
      }),
    ),
    ...["仮面ライダー", "ウルトラマン", "特撮"].map((tag) => ({
      url: `https://note.com/hashtag/${encodeURIComponent(tag)}/rss`,
      sourceName: "note",
    })),
  ];
  const candidates: IntelCandidate[] = [];
  for (const feed of feeds) {
    const response = await fetch(feed.url, {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) continue;
    const $ = cheerio.load(await response.text(), { xmlMode: true });
    const entries = $("item").length ? $("item") : $("entry");
    entries.each((_, element) => {
      const title = $(element).find("title").first().text().trim();
      const url =
        $(element).find("link").first().text().trim() ||
        $(element).find("link").first().attr("href")?.trim() ||
        "";
      const rawHint = $(element).find("description").first().text().trim();
      const bodyHint = cheerio.load(rawHint).text().replace(/\s+/g, " ").trim();
      const searchable = `${title} ${bodyHint}`;
      // Hatena search RSS includes a synthetic "本文…を検索" entry. It is
      // an index page, not a seller discussion, and must never become an
      // intelligence record merely because the query text contains "出品".
      if (
        feed.sourceName === "はてなブックマーク" &&
        /(?:本文|タイトル).*(?:検索|結果)/i.test(title)
      )
        return;
      if (
        !url ||
        !title ||
        !RELEVANT.test(searchable) ||
        !COMMERCE.test(searchable) ||
        EXCLUDED.test(searchable)
      )
        return;
      const date = new Date(
        $(element)
          .find("pubDate, dc\\:date, published, updated")
          .first()
          .text(),
      );
      const publisher = $(element).find("source").first().text().trim();
      const sourceName =
        feed.sourceName === "Google News"
          ? publisher || feed.sourceName
          : publisher
            ? `${feed.sourceName} · ${publisher}`
            : feed.sourceName;
      const author =
        $(element)
          .find("dc\\:creator, creator, author")
          .first()
          .text()
          .trim() || undefined;
      if (LOW_QUALITY_SOURCE.test(sourceName)) return;
      const publishedAt = Number.isNaN(date.getTime()) ? undefined : date;
      if (
        publishedAt &&
        publishedAt.getTime() < Date.now() - MAX_AGE_DAYS * 86_400_000
      )
        return;
      candidates.push({
        url,
        title,
        sourceName,
        bodyHint,
        author,
        publishedAt,
        ingestion: "rss",
        completeBody: false,
      });
    });
  }
  return candidates.slice(0, 24);
}

async function redditCandidates(): Promise<IntelCandidate[]> {
  const candidates: IntelCandidate[] = [];
  const endpoints = [
    "https://www.reddit.com/search.rss?q=" +
      encodeURIComponent(
        '(tokusatsu OR "Kamen Rider" OR Ultraman) (selling OR "for sale")',
      ) +
      "&sort=new&t=month",
    "https://www.reddit.com/r/KamenRider/search.rss?q=sale%20OR%20selling&restrict_sr=on&sort=new&t=year",
    "https://www.reddit.com/r/Ultraman/search.rss?q=sale%20OR%20selling&restrict_sr=on&sort=new&t=year",
  ];
  for (const url of endpoints) {
    try {
      await assertRobotsAllowed(url);
      const response = await fetch(url, {
        headers: { "user-agent": userAgent, accept: "application/atom+xml" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) continue;
      const $ = cheerio.load(await response.text(), { xmlMode: true });
      $("entry").each((_, element) => {
        const title = $(element).find("title").first().text().trim();
        const bodyHint = cheerio
          .load($(element).find("content").first().text())
          .text()
          .replace(/\s+/g, " ")
          .trim();
        const postUrl =
          $(element).find('link[rel="alternate"]').attr("href") ??
          $(element).find("link").first().attr("href") ??
          "";
        const author =
          $(element).find("author name").first().text().trim() || undefined;
        const date = new Date(
          $(element).find("updated, published").first().text(),
        );
        const searchable = `${title} ${bodyHint}`;
        if (
          !postUrl ||
          !title ||
          !RELEVANT.test(searchable) ||
          !COMMERCE.test(searchable) ||
          EXCLUDED.test(searchable)
        )
          return;
        candidates.push({
          url: postUrl,
          title,
          sourceName: "Reddit",
          ingestion: "rss",
          completeBody: false,
          bodyHint,
          author,
          publishedAt: Number.isNaN(date.getTime()) ? undefined : date,
        });
      });
      // Avoid turning a temporary Reddit success into a burst of requests.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    } catch {
      // RSS endpoints are best-effort; the remaining public feeds continue.
    }
  }
  return candidates
    .filter(
      (candidate, index, all) =>
        all.findIndex((entry) => entry.url === candidate.url) === index,
    )
    .slice(0, 24);
}

async function mastodonCandidates(): Promise<IntelCandidate[]> {
  const timelines = [
    ...[
      "仮面ライダー",
      "ウルトラマン",
      "特撮",
      "売ります",
      "譲ります",
      "出品",
    ].map((tag) => ({
      instance: "mstdn.jp",
      url: `https://mstdn.jp/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`,
    })),
    ...["kamenrider", "ultraman", "tokusatsu", "forsale", "toytrade"].map(
      (tag) => ({
        instance: "mastodon.social",
        url: `https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`,
      }),
    ),
  ];
  const candidates: IntelCandidate[] = [];
  for (const timeline of timelines) {
    try {
      const response = await fetch(timeline.url, {
        headers: { "user-agent": userAgent, accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) continue;
      const statuses = (await response.json()) as MastodonStatus[];
      for (const status of statuses) {
        const bodyHint = cheerio
          .load(status.content ?? "")
          .text()
          .replace(/\s+/g, " ")
          .trim();
        if (
          !status.url ||
          !bodyHint ||
          !RELEVANT.test(bodyHint) ||
          !COMMERCE.test(bodyHint) ||
          EXCLUDED.test(bodyHint)
        )
          continue;
        const publishedAt = status.created_at
          ? new Date(status.created_at)
          : undefined;
        candidates.push({
          url: status.url,
          title: bodyHint.slice(0, 160),
          sourceName: `Mastodon · ${timeline.instance}`,
          ingestion: "mastodon",
          completeBody: true,
          bodyHint,
          author:
            status.account?.display_name?.trim() ||
            status.account?.acct?.trim(),
          publishedAt:
            publishedAt && !Number.isNaN(publishedAt.getTime())
              ? publishedAt
              : undefined,
        });
      }
    } catch {
      // One public instance must not block the remaining allowed sources.
    }
  }
  return candidates
    .filter(
      (candidate, index, all) =>
        all.findIndex((entry) => entry.url === candidate.url) === index,
    )
    .slice(0, 32);
}

async function publicArticleBody(rawUrl: string) {
  await assertRobotsAllowed(rawUrl);
  const response = await fetch(rawUrl, {
    headers: {
      "user-agent": userAgent,
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`资讯页面返回 ${response.status}`);
  const finalUrl = new URL(response.url);
  await assertRobotsAllowed(finalUrl.toString());
  const $ = cheerio.load(await response.text());
  $("script,style,noscript,template,nav,header,footer,aside").remove();
  const root = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");
  return root.text().replace(/\s+/g, " ").trim().slice(0, 50_000);
}

export async function processMarketIntel() {
  const expiredOrKnownPollution = await prisma.marketIntel.findMany({
    where: {
      OR: [
        {
          publishedAt: { lt: new Date(Date.now() - MAX_AGE_DAYS * 86_400_000) },
        },
        {
          sourceName: { contains: "Suomen Tennisliitto", mode: "insensitive" },
        },
        {
          sourceName: {
            contains: "Universidad de Sevilla",
            mode: "insensitive",
          },
        },
      ],
    },
    select: { id: true },
  });
  const contentPollution = await prisma.marketIntel.findMany({
    select: {
      id: true,
      titleRaw: true,
      bodyRaw: true,
      sourceName: true,
      sourceData: true,
    },
  });
  const pollutedIds = contentPollution
    .filter(
      (record) =>
        LOW_QUALITY_SOURCE.test(record.sourceName) ||
        EXCLUDED.test(`${record.titleRaw} ${record.bodyRaw}`) ||
        (record.sourceData &&
          typeof record.sourceData === "object" &&
          (record.sourceData as Record<string, unknown>).ingestion === "rss" &&
          (!RELEVANT.test(record.titleRaw) || !COMMERCE.test(record.titleRaw))),
    )
    .map((record) => record.id);
  const cleanupIds = [
    ...new Set([
      ...expiredOrKnownPollution.map((record) => record.id),
      ...pollutedIds,
    ]),
  ];
  if (cleanupIds.length > 0) {
    await prisma.marketIntel.deleteMany({ where: { id: { in: cleanupIds } } });
  }
  const firecrawl = await firecrawlCandidates().catch(() => []);
  const rss = await rssCandidates().catch(() => []);
  const reddit = await redditCandidates().catch(() => []);
  const mastodon = await mastodonCandidates().catch(() => []);
  const seen = new Set<string>();
  const candidates = [...firecrawl, ...rss, ...reddit, ...mastodon]
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .slice(0, 48);
  type PreparedTranslation = {
    inserted: boolean;
    candidate: IntelCandidate;
    recordId: string;
    titleRaw: string;
    bodyRaw: string;
  };
  const result = await runMarketIntelTwoPhase<
    IntelCandidate,
    PreparedTranslation
  >(
    candidates,
    async (candidate) => {
      const existing = await prisma.marketIntel.findUnique({
        where: { sourceUrl: candidate.url },
        select: {
          id: true,
          titleRaw: true,
          bodyRaw: true,
          translationStatus: true,
          sourceData: true,
        },
      });
      const kind = candidateKind(candidate);
      if (existing?.translationStatus === "completed") {
        await prisma.marketIntel.update({
          where: { id: existing.id },
          data: { kind, sourceName: candidate.sourceName },
        });
        return null;
      }

      let titleRaw = existing?.titleRaw ?? candidate.title;
      let bodyRaw = existing?.bodyRaw ?? candidate.bodyHint ?? "";
      let author = candidate.author;
      let publishedAt = candidate.publishedAt;
      const existingComplete = Boolean(
        existing?.sourceData &&
          typeof existing.sourceData === "object" &&
          !Array.isArray(existing.sourceData) &&
          (existing.sourceData as Record<string, unknown>).completeBody ===
            true,
      );
      if (candidate.client && !existingComplete) {
        try {
          await assertRobotsAllowed(candidate.url);
          const document = await candidate.client.scrape(candidate.url, {
            formats: ["markdown"],
            onlyMainContent: true,
            timeout: 30_000,
            proxy: "basic",
            removeBase64Images: true,
          });
          const scrapedBody = documentBody(document);
          if (scrapedBody) {
            bodyRaw = scrapedBody;
            candidate.completeBody = true;
          }
          const metadata = (document.metadata ?? {}) as Record<string, unknown>;
          const metadataAuthor = metadata.author;
          if (typeof metadataAuthor === "string" && metadataAuthor.trim())
            author = metadataAuthor.trim();
          const metadataDate =
            metadata.publishedTime ?? metadata.date ?? metadata.modifiedTime;
          if (typeof metadataDate === "string") {
            const parsed = new Date(metadataDate);
            if (!Number.isNaN(parsed.getTime())) publishedAt = parsed;
          }
        } catch (error) {
          candidate.completeBody = existingComplete;
          if (!bodyRaw) throw error;
        }
      } else if (candidate.ingestion === "rss" && !existingComplete) {
        // RSS is discovery evidence. Upgrade its excerpt when the destination
        // publicly permits crawling, but retain the excerpt when it does not.
        try {
          const fullBody = await publicArticleBody(candidate.url);
          if (fullBody.length >= Math.max(160, bodyRaw.length)) {
            bodyRaw = fullBody;
            candidate.completeBody = true;
          }
        } catch {
          candidate.completeBody = existingComplete;
        }
      }
      titleRaw = titleRaw.trim();
      bodyRaw = bodyRaw.trim();
      if (!bodyRaw) throw new Error("资讯正文为空");
      const productLinks = [...bodyRaw.matchAll(/https?:\/\/[^\s)\]]+/g)]
        .map((match) => match[0])
        .slice(0, 30);
      const sourceData = {
        ingestion: candidate.ingestion,
        completeBody: candidate.completeBody,
      } as Prisma.InputJsonValue;

      if (!existing) {
        const url = new URL(candidate.url);
        const created = await prisma.marketIntel.create({
          data: {
            sourceUrl: candidate.url,
            sourcePlatform: url.hostname,
            sourceName: candidate.sourceName,
            kind,
            author,
            titleRaw,
            bodyRaw,
            translationStatus: "pending",
            publishedAt,
            productLinks,
            sourceData,
          },
          select: { id: true },
        });
        return {
          inserted: true,
          candidate,
          recordId: created.id,
          titleRaw,
          bodyRaw,
        };
      }

      await prisma.marketIntel.update({
        where: { id: existing.id },
        data: {
          sourceName: candidate.sourceName,
          kind,
          author,
          titleRaw,
          bodyRaw,
          translationStatus: "pending",
          publishedAt,
          productLinks,
          sourceData,
        },
      });
      return {
        inserted: false,
        candidate,
        recordId: existing.id,
        titleRaw,
        bodyRaw,
      };
    },
    async (record) => {
      await prisma.marketIntel.update({
        where: { id: record.recordId },
        data: { translationStatus: "processing" },
      });
      try {
        const translation = await translateComplete(
          record.titleRaw,
          record.bodyRaw,
        );
        await prisma.marketIntel.update({
          where: { id: record.recordId },
          data: {
            titleZh: translation.titleZh,
            bodyZh: translation.bodyZh,
            translationStatus: "completed",
            translatedAt: new Date(),
          },
        });
      } catch (error) {
        await prisma.marketIntel
          .update({
            where: { id: record.recordId },
            data: { translationStatus: "failed" },
          })
          .catch(() => undefined);
        throw error;
      }
    },
    isAutomaticAiUnavailable,
    (phase, error, value) => {
      const candidate =
        phase === "translation"
          ? (value as PreparedTranslation).candidate
          : (value as IntelCandidate);
      console.warn(
        JSON.stringify({
          event: "market_intel_candidate_failed",
          phase,
          sourceUrl: candidate.url,
          error: String(error).slice(0, 300),
        }),
      );
    },
  );
  return {
    candidates: candidates.length,
    inserted: result.inserted,
    translated: result.translated,
    failed: result.failed,
    ...(result.deferred ? { deferred: true } : {}),
    refreshedAt: new Date().toISOString(),
  };
}
