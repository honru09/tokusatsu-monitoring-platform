import type { CategoryIp } from "./types.js";

export const shfLines = ["standard", "shinkocchou"] as const;
export type ShfLine = (typeof shfLines)[number];

export const shfReleaseChannels = [
  "retail",
  "tamashii_web",
  "event",
  "unknown",
] as const;
export type ShfReleaseChannel = (typeof shfReleaseChannels)[number];

export const shfEditions = ["first", "reissue", "unknown"] as const;
export type ShfEdition = (typeof shfEditions)[number];

export const shfRegions = [
  "japanese",
  "agent",
  "hong_kong",
  "unknown",
] as const;
export type ShfRegion = (typeof shfRegions)[number];

export type ShfClassification = {
  line: ShfLine;
  releaseChannel: ShfReleaseChannel;
  edition: ShfEdition;
  region: ShfRegion;
};

/**
 * Search terms stay Japanese-first because the monitored marketplaces are
 * Japanese. The two line-level searches remain in every priority rotation;
 * version and channel attributes are classified from the full listing detail.
 */
export const SHF_SEARCH_KEYWORDS = [
  "仮面ライダー S.H.Figuarts",
  "仮面ライダー 真骨彫製法",
  "仮面ライダー S.H.Figuarts まとめ売り",
  "仮面ライダー SHF 魂ウェブ商店",
  "ウルトラマン S.H.Figuarts",
  "ウルトラマン SHF まとめ売り",
  "ウルトラマン S.H.Figuarts 魂ウェブ商店",
] as const;

const SHF_IDENTITY =
  /(?:S\.?\s*H\.?\s*Figuarts|S\.?\s*H\.?\s*フィギュアーツ|\bSHF(?:\s*(?:1\.0|2\.0|真骨|仮面|ライダー)|\b)|真骨[彫雕](?:製法)?|SHINKOCCHOU\s*SEIHOU)/iu;

// These names are independent or lower-price product lines. They may appear
// beside generic words such as "フィギュア", but must never create an SHF hit.
const SHF_EXCLUSIONS =
  /(?:装動|SO[\s-]?DO|勇動|\bRKF\b|S\.?I\.?C(?:\s|$)|Figuarts\s*ZERO|フィギュアーツ\s*ZERO|食玩|扭蛋|ガシャポン|ガチャポン|盒蛋|掌動|超動|創動|创动|\bFW\b|\bME\b|一番くじ|一番赏|景品|ソフビ|软胶|ウルトラアクションフィギュア|\bACT\b|\bDD\b|プラモデル|拼装模型|Figure-rise\s*Standard|\bFRS\b)/iu;

const SHINKOCCHOU = /(?:真骨[彫雕](?:製法)?|SHINKOCCHOU\s*SEIHOU)/iu;
const TAMASHII_WEB =
  /(?:魂(?:網|网|ウェブ|WEB)?限定|魂ウェブ商店|魂WEB商店|Tamashii\s*Web限定|輸送箱|运输盒)/iu;
const EVENT =
  /(?:会場限定|活动限定|イベント限定|Tamashii\s*Store限定|TNT限定|実店舗限定|实体店限定)/iu;
const RETAIL = /(?:通[販贩]|一般販売|店頭販売)/iu;
const REISSUE = /(?:再販|再版|二次(?:生産|生产)|復刻)/iu;
const FIRST = /(?:初版|初回(?:生産|生产)|首次发售)/iu;
const AGENT_REGION =
  /(?:代理版|中国版|大陸版|大陆版|中文(?:シール|贴纸)|防偽猫貼|防伪猫贴|猫貼|猫贴)/iu;
const HONG_KONG_REGION = /(?:香港版|港版)/iu;
const JAPANESE_REGION =
  /(?:日版|日本国内版|国内正規|魂(?:ホログラム|镭射标|鐳射標))/iu;

export function classifyShfListing(input: {
  titleRaw: string;
  descriptionRaw?: string | null;
  categoryIp: CategoryIp | string;
}): ShfClassification | null {
  if (!["kamen_rider", "ultraman"].includes(input.categoryIp)) return null;
  const title = input.titleRaw.trim();
  const text = `${title}\n${input.descriptionRaw ?? ""}`;
  if (!SHF_IDENTITY.test(text) || SHF_EXCLUSIONS.test(title)) return null;

  return {
    line: SHINKOCCHOU.test(text) ? "shinkocchou" : "standard",
    releaseChannel: TAMASHII_WEB.test(text)
      ? "tamashii_web"
      : EVENT.test(text)
        ? "event"
        : RETAIL.test(text)
          ? "retail"
          : "unknown",
    edition: REISSUE.test(text)
      ? "reissue"
      : FIRST.test(text)
        ? "first"
        : "unknown",
    region: AGENT_REGION.test(text)
      ? "agent"
      : HONG_KONG_REGION.test(text)
        ? "hong_kong"
        : JAPANESE_REGION.test(text)
          ? "japanese"
          : "unknown",
  };
}
