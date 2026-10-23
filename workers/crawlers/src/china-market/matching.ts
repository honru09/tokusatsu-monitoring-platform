import type {
  AiCandidateDecision,
  ChinaProductReference,
  DeterministicMatch,
  RawChinaMarketOffer,
} from "./types.js";

const NOISE =
  /(?:闲鱼|淘宝|包邮|秒发|现货|正品|全新|二手|自用|低价|好价|出一个|可小刀|不议价|欢迎咨询)/g;
const WANTED = /(?:求购|收购|高价收|蹲一个|换物|只收)/;
const NON_PRODUCT = /(?:定金|订金|意向金|补款|尾款|预售|代购链接)/;
const ACCESSORY =
  /(?:仅空盒|空盒|替换件|维修件|零件|单配件|仅配件|拆卖|散件|(?:仅|只|单出|单卖|单独|不含本体|无本体|没有本体).{0,6}(?:包装盒|说明书|底座|支架|贴纸|配件)|(?:包装盒|说明书|底座|支架|贴纸|配件).{0,6}(?:单出|单卖|单独出售|不含本体|无本体|没有本体))/;
const DAMAGED =
  /(?:瑕疵品|破损|损坏|战损|坏件|维修品|尸体|垃圾|故障|缺件|缺配|盒损|掉漆|断裂|发黄|缺盒|开裂|断件|严重划痕)/;
const NEGATED_DAMAGE =
  /(?:无|没有)(?:明显)?(?:瑕疵|破损|损坏|故障|缺件|缺配|盒损|掉漆|断裂|发黄|缺盒|开裂|断件|严重划痕)/g;
const PRICE_PLACEHOLDER =
  /(?:标价(?:非|不是)实价|标价不实|价格私聊|私聊价格|拍前(?:先)?联系|下单前联系|请勿拍|勿拍|不要拍|占位价|拍下改价|改价后拍|具体价格.{0,6}(?:私聊|咨询)|此价格非实价)/;
const NON_MERCHANDISE =
  /(?:只租不卖|租赁|出租|维修服务|代修|补漆服务|改色服务|改造服务|摄影服务|鉴定服务|招聘|招募|兼职|培训课程)/;
const QUERY_FORBIDDEN =
  /(?:https?:\/\/|www\.|求购|收购|高价收|蹲一个|换物|定金|订金|补款|尾款|预售|代购|仅空盒|空盒|零件|单配件|仅配件|拆卖|散件|包邮|秒发|现货|正品|全新|二手|低价|好价|可小刀|不议价|欢迎咨询)/i;
const HAN = /\p{Script=Han}/u;
const JAPANESE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const SHF_IDENTITY =
  /(?:S\.?\s*H\.?\s*Figuarts|(?:^|[^\p{L}\p{N}])SHF(?=$|[^\p{L}\p{N}])|真骨[彫雕](?:制法|製法)?|SHINKOCCHOU\s*SEIHOU)/iu;
const SIC_IDENTITY =
  /(?:^|[^\p{L}\p{N}])(?:S\.?\s*I\.?\s*C\.?|SIC极魂|SIC極魂)(?=$|[^\p{L}\p{N}])/iu;
const SHINKOCCHOU_IDENTITY =
  /(?:真骨[彫雕](?:制法|製法)?|SHINKOCCHOU\s*SEIHOU)/iu;
const KAMEN_RIDER_IDENTITY = /(?:假面骑士|仮面ライダー|幪面超人)/iu;
const ULTRAMAN_IDENTITY = /(?:奥特曼|奧特曼|ウルトラマン|超人力霸王)/iu;
const TAMASHII_WEB_IDENTITY =
  /(?:魂(?:网|網|WEB|ウェブ)?限定|魂(?:网|網|WEB|ウェブ)?商店|Tamashii\s*Web|运输盒|運輸盒|輸送箱)/iu;
const EVENT_IDENTITY =
  /(?:会场限定|會場限定|活动限定|活動限定|イベント限定|Tamashii\s*Store|TNT限定|实体店限定|實體店限定)/iu;
const RETAIL_IDENTITY = /(?:通贩|通販|一般销售|一般販売|店头销售|店頭販売)/iu;
const FIRST_EDITION_IDENTITY = /(?:初版|初回生产|初回生産|首次发售|首次發售)/iu;
const REISSUE_IDENTITY = /(?:再版|再販|二次生产|二次生産|复刻|復刻)/iu;
const JAPANESE_REGION_IDENTITY =
  /(?:日版|日本国内版|日本國內版|国内正規|魂(?:镭射标|鐳射標|ホログラム))/iu;
const AGENT_REGION_IDENTITY =
  /(?:代理版|大陆版|大陸版|中国版|中國版|中文贴纸|中文貼紙|防伪猫贴|防偽貓貼|猫贴|貓貼)/iu;
const HONG_KONG_REGION_IDENTITY = /(?:港版|香港版)/iu;
const NEW_SEALED_IDENTITY =
  /(?:全新未拆|全新未开|全新未開|未拆封|未开封|未開封|内袋未拆|內袋未拆)/iu;
const LIKE_NEW_IDENTITY =
  /(?:仅拆检查|僅拆檢查|仅拆摆|僅拆擺|拆摆回盒|拆擺回盒|盒说全|盒說全|近新|成色新)/iu;
const USED_IDENTITY = /(?:拆摆|拆擺|把玩过|把玩過|使用过|使用過|二手使用)/iu;

// A comparison is user-facing pricing evidence, so an AI-assisted match must
// clear the same conservative bar documented by the market-intelligence skill.
// Deterministic-only matches use the stricter fallback below.
export const AI_MATCH_ACCEPTANCE_THRESHOLD = 0.85;

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(NOISE, " ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ngrams(value: string, size = 2) {
  const compact = normalize(value).replace(/\s+/g, "");
  const result = new Set<string>();
  for (let index = 0; index <= compact.length - size; index += 1)
    result.add(compact.slice(index, index + size));
  return result;
}

function dice(left: string, right: string) {
  const a = ngrams(left);
  const b = ngrams(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function containsScore(title: string, values: string[]) {
  const normalizedTitle = normalize(title).replace(/\s+/g, "");
  const normalizedValues = [...new Set(values.map(normalize))].filter(
    (value) => value.replace(/\s+/g, "").length >= 2,
  );
  if (!normalizedValues.length) return 0.5;
  const matched = normalizedValues.filter((value) =>
    normalizedTitle.includes(value.replace(/\s+/g, "")),
  ).length;
  return matched / normalizedValues.length;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExactModelNumber(title: string, modelNumber: string) {
  const parts = modelNumber
    .normalize("NFKC")
    .toLowerCase()
    .match(/[a-z]+|\d+/g);
  if (!parts?.length) return false;
  const pattern = parts.map(escapeRegex).join("[\\s._/-]*");
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?=$|[^a-z0-9])`, "i").test(
    title.normalize("NFKC").toLowerCase(),
  );
}

function chineseInteger(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (tens ? (digits[tens] ?? 0) : 1) * 10 + (digits[ones] ?? 0);
  }
  return digits[value];
}

export function explicitCandidateQuantity(value: string) {
  const text = value.normalize("NFKC");
  if (/(?:^|\s)(?:一对|一双)(?:\s|$)/.test(text)) return 2;
  const match = text.match(
    /(?:^|[^\p{L}\p{N}])(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:个|件|只|套|盒|组|枚)(?:装|套装)?/u,
  );
  return match?.[1] ? chineseInteger(match[1]) : undefined;
}

export function fallbackChineseKeywords(reference: ChinaProductReference) {
  const categoryLabel =
    reference.categoryIp === "kamen_rider"
      ? "假面骑士"
      : reference.categoryIp === "ultraman"
        ? "奥特曼"
        : "";
  const collectionLabel =
    reference.collectibleSeries === "shf"
      ? "SHF"
      : reference.collectibleSeries === "sic"
        ? "SIC"
        : "";
  const lineLabel =
    reference.shfLine === "shinkocchou" ? "真骨雕制法" : collectionLabel;
  const chineseIdentity =
    reference.titleZh ??
    reference.listingTitleZh ??
    reference.seriesNames.find(
      (value) => HAN.test(value) && !JAPANESE_KANA.test(value),
    ) ??
    "";
  const specialQueries = reference.collectibleSeries
    ? [
        [
          categoryLabel,
          collectionLabel,
          chineseIdentity,
          reference.modelNumber,
        ],
        [collectionLabel, chineseIdentity, reference.modelNumber],
        [categoryLabel, lineLabel, chineseIdentity],
        [categoryLabel, collectionLabel, reference.modelNumber],
      ]
        .map((parts) => parts.filter(Boolean).join(" "))
        .filter(Boolean)
    : [];
  const exact = [reference.titleZh, reference.modelNumber]
    .filter(Boolean)
    .join(" ");
  const listing = [reference.listingTitleZh, reference.modelNumber]
    .filter(Boolean)
    .join(" ");
  const series = [
    reference.seriesNames[0],
    reference.toyTypeNames[0],
    reference.manufacturerNames[0],
    reference.modelNumber,
  ]
    .filter(Boolean)
    .join(" ");
  const line = [
    reference.franchiseNames[0],
    reference.productLine,
    reference.modelNumber,
  ]
    .filter(Boolean)
    .join(" ");
  const maker = [
    reference.manufacturerNames[0],
    reference.productLine,
    reference.toyTypeNames[0],
    reference.modelNumber,
  ]
    .filter(Boolean)
    .join(" ");
  const fallback = [
    reference.seriesNames[0] ?? reference.franchiseNames[0],
    reference.toyTypeNames[0],
  ]
    .filter(Boolean)
    .join(" ");
  return [
    ...new Set(
      [
        ...specialQueries,
        exact,
        listing,
        series,
        line,
        maker,
        fallback,
        reference.canonicalName,
        reference.listingTitleRaw,
      ].map(normalize),
    ),
  ]
    .filter((value) => value.length >= 2)
    .slice(0, 8);
}

function identityAnchors(reference: ChinaProductReference) {
  const categoryLabel =
    reference.categoryIp === "kamen_rider"
      ? "假面骑士"
      : reference.categoryIp === "ultraman"
        ? "奥特曼"
        : "";
  const collectionLabel =
    reference.collectibleSeries === "shf"
      ? "SHF"
      : reference.collectibleSeries === "sic"
        ? "SIC"
        : "";
  const values = [
    reference.titleZh,
    reference.listingTitleZh,
    reference.productLine,
    reference.modelNumber,
    ...reference.franchiseNames,
    ...reference.seriesNames,
    ...reference.manufacturerNames,
    ...reference.toyTypeNames,
    categoryLabel,
    collectionLabel,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value) => !JAPANESE_KANA.test(value));
  const anchors = new Set<string>();
  for (const value of values) {
    const normalized = normalize(value).replace(/\s+/g, "");
    for (const token of normalized.match(
      /[\p{Script=Han}]{2,}|[a-z0-9]{3,}/gu,
    ) ?? [])
      anchors.add(token);
  }
  return [...anchors];
}

function explicitReleaseChannel(value: string) {
  if (TAMASHII_WEB_IDENTITY.test(value)) return "tamashii_web";
  if (EVENT_IDENTITY.test(value)) return "event";
  if (RETAIL_IDENTITY.test(value)) return "retail";
  return undefined;
}

function explicitEdition(value: string) {
  if (REISSUE_IDENTITY.test(value)) return "reissue";
  if (FIRST_EDITION_IDENTITY.test(value)) return "first";
  return undefined;
}

function explicitRegion(value: string) {
  if (AGENT_REGION_IDENTITY.test(value)) return "agent";
  if (HONG_KONG_REGION_IDENTITY.test(value)) return "hong_kong";
  if (JAPANESE_REGION_IDENTITY.test(value)) return "japanese";
  return undefined;
}

function explicitCondition(value: string) {
  if (NEW_SEALED_IDENTITY.test(value)) return "new_sealed";
  if (LIKE_NEW_IDENTITY.test(value)) return "like_new";
  if (USED_IDENTITY.test(value)) return "used";
  return undefined;
}

function isKnownReferenceValue(value: string | null | undefined) {
  return Boolean(value && value !== "unknown");
}

/**
 * Fail closed before any provider request: every search phrase must be Chinese,
 * free of purchase/marketing noise, and anchored to known product identity.
 */
export function validatedChineseKeywords(
  reference: ChinaProductReference,
  values: string[],
) {
  const anchors = identityAnchors(reference);
  if (!anchors.length) return [];
  const result: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const value = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (
      value.length < 2 ||
      value.length > 100 ||
      !HAN.test(value) ||
      JAPANESE_KANA.test(value) ||
      QUERY_FORBIDDEN.test(value)
    )
      continue;
    const compact = normalize(value).replace(/\s+/g, "");
    if (!anchors.some((anchor) => compact.includes(anchor))) continue;
    if (!result.includes(value)) result.push(value);
    if (result.length === 8) break;
  }
  return result;
}

export function scoreChinaCandidate(
  reference: ChinaProductReference,
  offer: RawChinaMarketOffer,
  keywords: string[],
): DeterministicMatch {
  const title = normalize(offer.titleRaw).replace(NEGATED_DAMAGE, "").trim();
  const listingText = normalize(`${offer.titleRaw} ${offer.conditionRaw ?? ""}`)
    .replace(NEGATED_DAMAGE, "")
    .trim();
  const explicitText =
    `${offer.titleRaw}\n${offer.conditionRaw ?? ""}`.normalize("NFKC");
  const reasons: string[] = [];
  if (WANTED.test(listingText)) reasons.push("求购或换物，不是出售商品");
  if (NON_PRODUCT.test(listingText)) reasons.push("定金、尾款或预售占位价");
  if (ACCESSORY.test(listingText)) reasons.push("配件、空盒或拆卖");
  if (DAMAGED.test(listingText)) reasons.push("瑕疵、损坏或缺件商品");
  if (PRICE_PLACEHOLDER.test(listingText))
    reasons.push("价格为占位或需要另行确认");
  const sourceData = offer.sourceData ?? {};
  const listingClassification = normalize(
    [sourceData.listingType, sourceData.categoryName, sourceData.categoryPath]
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
  if (sourceData.isAd === true) reasons.push("广告推广商品");
  if (sourceData.isAuction === true) reasons.push("竞拍价不是固定在售价");
  if (NON_MERCHANDISE.test(`${listingText} ${listingClassification}`))
    reasons.push("租赁、服务或招聘信息，不是可比商品");
  const candidateQuantity = explicitCandidateQuantity(offer.titleRaw);
  if (
    reference.quantity != null &&
    reference.quantity > 0 &&
    candidateQuantity != null &&
    candidateQuantity !== reference.quantity
  )
    reasons.push(`数量冲突（候选明确为 ${candidateQuantity} 件）`);
  if (offer.priceCny < 10 || offer.priceCny > 1_000_000)
    reasons.push("价格疑似占位或异常");
  if (offer.status === "sold" || offer.status === "ended")
    reasons.push("商品已售出或下架");
  if (offer.status === "unknown") reasons.push("商品在售状态未确认");

  const candidateIsShf = SHF_IDENTITY.test(explicitText);
  const candidateIsSic = SIC_IDENTITY.test(explicitText);
  if (reference.collectibleSeries === "shf") {
    if (candidateIsSic) reasons.push("产品系列冲突（S.H.Figuarts 与 S.I.C.）");
    if (!candidateIsShf)
      reasons.push("特殊系列身份不明（未明确标注 S.H.Figuarts）");
  } else if (reference.collectibleSeries === "sic") {
    if (candidateIsShf) reasons.push("产品系列冲突（S.I.C. 与 S.H.Figuarts）");
    if (!candidateIsSic) reasons.push("特殊系列身份不明（未明确标注 S.I.C.）");
  }

  if (
    reference.categoryIp === "kamen_rider" &&
    ULTRAMAN_IDENTITY.test(explicitText) &&
    !KAMEN_RIDER_IDENTITY.test(explicitText)
  )
    reasons.push("作品分类冲突（假面骑士与奥特曼）");
  if (
    reference.categoryIp === "ultraman" &&
    KAMEN_RIDER_IDENTITY.test(explicitText) &&
    !ULTRAMAN_IDENTITY.test(explicitText)
  )
    reasons.push("作品分类冲突（奥特曼与假面骑士）");

  const candidateIsShinkocchou = SHINKOCCHOU_IDENTITY.test(explicitText);
  if (reference.shfLine === "shinkocchou" && !candidateIsShinkocchou)
    reasons.push("产品线冲突（参考为真骨雕制法）");
  if (reference.shfLine === "standard" && candidateIsShinkocchou)
    reasons.push("产品线冲突（普通 S.H.Figuarts 与真骨雕制法）");

  const candidateReleaseChannel = explicitReleaseChannel(explicitText);
  if (
    isKnownReferenceValue(reference.shfReleaseChannel) &&
    candidateReleaseChannel &&
    candidateReleaseChannel !== reference.shfReleaseChannel
  )
    reasons.push("发售渠道冲突");
  const candidateEdition = explicitEdition(explicitText);
  if (
    isKnownReferenceValue(reference.shfEdition) &&
    candidateEdition &&
    candidateEdition !== reference.shfEdition
  )
    reasons.push("版本冲突（初版与再版）");
  const candidateRegion = explicitRegion(explicitText);
  if (
    isKnownReferenceValue(reference.shfRegion) &&
    candidateRegion &&
    candidateRegion !== reference.shfRegion
  )
    reasons.push("地区版本冲突");
  const candidateCondition = explicitCondition(explicitText);
  if (
    isKnownReferenceValue(reference.conditionGrade) &&
    candidateCondition &&
    candidateCondition !== reference.conditionGrade
  )
    reasons.push("品相冲突");
  if (
    reference.collectibleSeries &&
    (reference.quantity ?? 0) > 1 &&
    candidateQuantity == null
  )
    reasons.push("数量信息不足，无法与多件装参考比较");

  const referenceTitles = [
    reference.titleZh,
    reference.listingTitleZh,
    reference.canonicalName,
    reference.listingTitleRaw,
  ].filter((value): value is string => Boolean(value));
  const titleScore = Math.max(
    0,
    ...referenceTitles.map((value) => dice(title, value)),
  );
  const attributes = [
    ...reference.seriesNames,
    ...reference.franchiseNames,
    ...reference.manufacturerNames,
    ...reference.toyTypeNames,
    reference.productLine ?? "",
  ];
  const attributeScore = containsScore(title, attributes);
  const queryScore = Math.max(
    0,
    ...keywords.map((value) => dice(title, value)),
  );
  const modelNumber = reference.modelNumber?.trim() ?? "";
  const modelNumberScore = !modelNumber
    ? 0.5
    : hasExactModelNumber(offer.titleRaw, modelNumber)
      ? 1
      : 0;
  if (modelNumberScore === 1) reasons.push("型号一致");
  if (attributeScore >= 0.5) reasons.push("系列或品类属性重合");
  if (titleScore >= 0.65) reasons.push("标题高度相似");
  const score = Math.max(
    0,
    Math.min(
      1,
      titleScore * 0.4 +
        attributeScore * 0.2 +
        modelNumberScore * 0.25 +
        queryScore * 0.15,
    ),
  );
  return {
    score,
    excluded: reasons.some((reason) =>
      /不是出售|定金|配件|瑕疵|异常|下架|占位|数量冲突|数量信息不足|状态未确认|广告|竞拍|租赁|服务|招聘|系列冲突|系列身份不明|分类冲突|产品线冲突|渠道冲突|版本冲突|品相冲突/.test(
        reason,
      ),
    ),
    reasons,
    factors: {
      title: titleScore,
      attributes: attributeScore,
      modelNumber: modelNumberScore,
      query: queryScore,
    },
  };
}

export function acceptCandidate(
  deterministic: DeterministicMatch,
  ai?: AiCandidateDecision,
) {
  if (deterministic.excluded)
    return { accepted: false, confidence: deterministic.score };
  if (ai) {
    const confidence =
      deterministic.score * 0.45 +
      Math.max(0, Math.min(1, ai.confidence)) * 0.55;
    return {
      accepted:
        ai.sameProduct &&
        !ai.accessoryOnly &&
        !ai.damaged &&
        !ai.quantityConflict &&
        !ai.modelConflict &&
        !ai.versionConflict &&
        !ai.scaleConflict &&
        !ai.conditionConflict &&
        confidence >= AI_MATCH_ACCEPTANCE_THRESHOLD,
      confidence,
    };
  }
  return {
    accepted:
      deterministic.score >= 0.92 && deterministic.factors.modelNumber === 1,
    confidence: deterministic.score,
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function stableTextOrder(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedObservedText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function sameObservedOfferFacts(
  left: RawChinaMarketOffer,
  right: RawChinaMarketOffer,
) {
  return (
    left.platform === right.platform &&
    left.sourceUrl === right.sourceUrl &&
    normalizedObservedText(left.titleRaw) ===
      normalizedObservedText(right.titleRaw) &&
    left.priceCny === right.priceCny
  );
}

function isTerminalOfferStatus(status: RawChinaMarketOffer["status"]) {
  return status === "sold" || status === "ended";
}

export function robustReferencePrice(
  offers: Array<RawChinaMarketOffer & { matchConfidence: number }>,
) {
  // A listing may appear under several keyword searches. Count one platform
  // item only once; otherwise a provider that repeats a row could manufacture
  // the three-sample threshold and bias the reference price. A terminal state
  // vetoes weaker availability evidence, while conflicting observed facts are
  // quarantined instead of selecting whichever row is more convenient.
  const unique = new Map<
    string,
    RawChinaMarketOffer & { matchConfidence: number }
  >();
  const conflicted = new Set<string>();
  for (const offer of offers) {
    if (!offer.sourceListingId?.trim()) continue;
    const key = `${offer.platform}:${offer.sourceListingId}`;
    if (conflicted.has(key)) continue;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, offer);
      continue;
    }
    if (
      isTerminalOfferStatus(offer.status) ||
      isTerminalOfferStatus(current.status)
    ) {
      unique.set(key, isTerminalOfferStatus(offer.status) ? offer : current);
      continue;
    }
    if (!sameObservedOfferFacts(current, offer)) {
      unique.delete(key);
      conflicted.add(key);
      continue;
    }
    if (
      (offer.status === "active" && current.status !== "active") ||
      (offer.status === current.status &&
        Number.isFinite(offer.matchConfidence) &&
        offer.matchConfidence > current.matchConfidence)
    )
      unique.set(key, offer);
  }
  const valid = [...unique.values()].filter(
    (offer) =>
      offer.status === "active" &&
      Number.isFinite(offer.priceCny) &&
      offer.priceCny >= 10 &&
      offer.priceCny <= 1_000_000 &&
      Number.isFinite(offer.matchConfidence),
  );
  if (valid.length < 3)
    return { status: "insufficient" as const, retained: valid };
  const center = median(valid.map((offer) => offer.priceCny));
  let retained = valid;
  if (valid.length >= 3) {
    const deviations = valid.map((offer) => Math.abs(offer.priceCny - center));
    const mad = median(deviations);
    retained = valid.filter((offer) =>
      mad > 0
        ? (0.6745 * Math.abs(offer.priceCny - center)) / mad <= 3.5
        : offer.priceCny >= center * 0.5 && offer.priceCny <= center * 2,
    );
  }
  if (retained.length < 3) return { status: "insufficient" as const, retained };
  const statisticalCenter = median(retained.map((offer) => offer.priceCny));
  const representative = [...retained].sort(
    (left, right) =>
      Math.abs(left.priceCny - statisticalCenter) -
        Math.abs(right.priceCny - statisticalCenter) ||
      right.matchConfidence - left.matchConfidence ||
      stableTextOrder(left.sourceListingId, right.sourceListingId) ||
      stableTextOrder(left.sourceUrl, right.sourceUrl),
  )[0]!;
  return {
    status: "ready" as const,
    retained,
    // The public price and outgoing link are one atomic piece of evidence.
    // Selecting a real central listing avoids publishing an invented midpoint.
    referencePriceCny: representative.priceCny,
    minimumPriceCny: Math.min(...retained.map((offer) => offer.priceCny)),
    maximumPriceCny: Math.max(...retained.map((offer) => offer.priceCny)),
    representative,
  };
}
