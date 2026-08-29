export type CatalogKind =
  | "franchise"
  | "series"
  | "character"
  | "manufacturer"
  | "toy_type";

export interface CatalogEntry {
  kind: CatalogKind;
  key: string;
  nameJa: string;
  nameZh: string;
  nameEn?: string;
  franchiseKey?: string;
  seriesKey?: string;
  aliases: string[];
}

export interface CatalogResolution {
  value: CatalogEntry;
  confidence: number;
  evidence: string;
  matchedAlias: string;
}

export function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s\u3000_・･\/|【】「」『』()（）\[\]［］]+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const franchise = (
  key: string,
  nameJa: string,
  nameZh: string,
  nameEn: string,
  aliases: string[],
): CatalogEntry => ({
  kind: "franchise",
  key,
  nameJa,
  nameZh,
  nameEn,
  aliases: [nameJa, nameZh, nameEn, ...aliases],
});

const series = (
  key: string,
  nameJa: string,
  nameZh: string,
  nameEn: string,
  franchiseKey: string,
  aliases: string[],
): CatalogEntry => ({
  kind: "series",
  key,
  nameJa,
  nameZh,
  nameEn,
  franchiseKey,
  aliases: [nameJa, nameZh, nameEn, ...aliases],
});

const simple = (
  kind: Exclude<CatalogKind, "franchise" | "series">,
  key: string,
  nameJa: string,
  nameZh: string,
  nameEn: string,
  aliases: string[],
  links: Pick<CatalogEntry, "franchiseKey" | "seriesKey"> = {},
): CatalogEntry => ({
  kind,
  key,
  nameJa,
  nameZh,
  nameEn,
  aliases: [nameJa, nameZh, nameEn, ...aliases],
  ...links,
});

export const catalogEntries: CatalogEntry[] = [
  franchise("KAMEN_RIDER", "仮面ライダー", "假面骑士", "Kamen Rider", [
    "masked rider",
    "幪面超人",
  ]),
  franchise("ULTRAMAN", "ウルトラマン", "奥特曼", "Ultraman", ["超人力霸王"]),

  series(
    "KAMEN_RIDER_KUUGA",
    "仮面ライダークウガ",
    "假面骑士空我",
    "Kamen Rider Kuuga",
    "KAMEN_RIDER",
    ["クウガ", "空我", "kuuga"],
  ),
  series(
    "KAMEN_RIDER_AGITO",
    "仮面ライダーアギト",
    "假面骑士亚极陀",
    "Kamen Rider Agito",
    "KAMEN_RIDER",
    ["アギト", "亚极陀", "agito"],
  ),
  series(
    "KAMEN_RIDER_RYUKI",
    "仮面ライダー龍騎",
    "假面骑士龙骑",
    "Kamen Rider Ryuki",
    "KAMEN_RIDER",
    ["龍騎", "龙骑", "ryuki"],
  ),
  series(
    "KAMEN_RIDER_FAIZ",
    "仮面ライダー555",
    "假面骑士555",
    "Kamen Rider Faiz",
    "KAMEN_RIDER",
    ["ファイズ", "faiz"],
  ),
  series(
    "KAMEN_RIDER_BLADE",
    "仮面ライダー剣",
    "假面骑士剑",
    "Kamen Rider Blade",
    "KAMEN_RIDER",
    ["ブレイド", "blade"],
  ),
  series(
    "KAMEN_RIDER_HIBIKI",
    "仮面ライダー響鬼",
    "假面骑士响鬼",
    "Kamen Rider Hibiki",
    "KAMEN_RIDER",
    ["響鬼", "响鬼", "hibiki"],
  ),
  series(
    "KAMEN_RIDER_KABUTO",
    "仮面ライダーカブト",
    "假面骑士甲斗",
    "Kamen Rider Kabuto",
    "KAMEN_RIDER",
    ["カブト", "甲斗", "kabuto"],
  ),
  series(
    "KAMEN_RIDER_DEN_O",
    "仮面ライダー電王",
    "假面骑士电王",
    "Kamen Rider Den-O",
    "KAMEN_RIDER",
    ["電王", "电王", "den-o", "den o"],
  ),
  series(
    "KAMEN_RIDER_KIVA",
    "仮面ライダーキバ",
    "假面骑士月骑",
    "Kamen Rider Kiva",
    "KAMEN_RIDER",
    ["キバ", "月骑", "kiva"],
  ),
  series(
    "KAMEN_RIDER_DECADE",
    "仮面ライダーディケイド",
    "假面骑士帝骑",
    "Kamen Rider Decade",
    "KAMEN_RIDER",
    ["ディケイド", "帝骑", "decade"],
  ),
  series(
    "KAMEN_RIDER_W",
    "仮面ライダーW",
    "假面骑士W",
    "Kamen Rider W",
    "KAMEN_RIDER",
    ["ダブル", "double"],
  ),
  series(
    "KAMEN_RIDER_OOO",
    "仮面ライダーオーズ",
    "假面骑士欧兹",
    "Kamen Rider OOO",
    "KAMEN_RIDER",
    ["オーズ", "欧兹", "ooo"],
  ),
  series(
    "KAMEN_RIDER_FOURZE",
    "仮面ライダーフォーゼ",
    "假面骑士卌骑",
    "Kamen Rider Fourze",
    "KAMEN_RIDER",
    ["フォーゼ", "fourze"],
  ),
  series(
    "KAMEN_RIDER_WIZARD",
    "仮面ライダーウィザード",
    "假面骑士巫骑",
    "Kamen Rider Wizard",
    "KAMEN_RIDER",
    ["ウィザード", "wizard"],
  ),
  series(
    "KAMEN_RIDER_GAIM",
    "仮面ライダー鎧武",
    "假面骑士铠武",
    "Kamen Rider Gaim",
    "KAMEN_RIDER",
    ["鎧武", "铠武", "gaim"],
  ),
  series(
    "KAMEN_RIDER_DRIVE",
    "仮面ライダードライブ",
    "假面骑士驰骑",
    "Kamen Rider Drive",
    "KAMEN_RIDER",
    ["ドライブ", "drive"],
  ),
  series(
    "KAMEN_RIDER_GHOST",
    "仮面ライダーゴースト",
    "假面骑士灵骑",
    "Kamen Rider Ghost",
    "KAMEN_RIDER",
    ["ゴースト", "ghost"],
  ),
  series(
    "KAMEN_RIDER_EX_AID",
    "仮面ライダーエグゼイド",
    "假面骑士艾克赛德",
    "Kamen Rider Ex-Aid",
    "KAMEN_RIDER",
    ["エグゼイド", "ex-aid", "ex aid"],
  ),
  series(
    "KAMEN_RIDER_BUILD",
    "仮面ライダービルド",
    "假面骑士创骑",
    "Kamen Rider Build",
    "KAMEN_RIDER",
    ["ビルド", "build"],
  ),
  series(
    "KAMEN_RIDER_ZI_O",
    "仮面ライダージオウ",
    "假面骑士时王",
    "Kamen Rider Zi-O",
    "KAMEN_RIDER",
    ["ジオウ", "时王", "zi-o", "zio"],
  ),
  series(
    "KAMEN_RIDER_ZERO_ONE",
    "仮面ライダーゼロワン",
    "假面骑士零一",
    "Kamen Rider Zero-One",
    "KAMEN_RIDER",
    ["ゼロワン", "零一", "zero-one", "zero one"],
  ),
  series(
    "KAMEN_RIDER_SABER",
    "仮面ライダーセイバー",
    "假面骑士圣刃",
    "Kamen Rider Saber",
    "KAMEN_RIDER",
    ["セイバー", "圣刃", "saber"],
  ),
  series(
    "KAMEN_RIDER_REVICE",
    "仮面ライダーリバイス",
    "假面骑士利维斯",
    "Kamen Rider Revice",
    "KAMEN_RIDER",
    ["リバイス", "revice"],
  ),
  series(
    "KAMEN_RIDER_GEATS",
    "仮面ライダーギーツ",
    "假面骑士极狐",
    "Kamen Rider Geats",
    "KAMEN_RIDER",
    ["ギーツ", "极狐", "geats"],
  ),
  series(
    "KAMEN_RIDER_GOTCHARD",
    "仮面ライダーガッチャード",
    "假面骑士歌查德",
    "Kamen Rider Gotchard",
    "KAMEN_RIDER",
    ["ガッチャード", "歌查德", "gotchard"],
  ),
  series(
    "KAMEN_RIDER_GAVV",
    "仮面ライダーガヴ",
    "假面骑士加布",
    "Kamen Rider Gavv",
    "KAMEN_RIDER",
    ["ガヴ", "加布", "gavv"],
  ),

  series(
    "ULTRAMAN_TIGA",
    "ウルトラマンティガ",
    "迪迦奥特曼",
    "Ultraman Tiga",
    "ULTRAMAN",
    ["ティガ", "迪迦", "tiga"],
  ),
  series(
    "ULTRAMAN_DYNA",
    "ウルトラマンダイナ",
    "戴拿奥特曼",
    "Ultraman Dyna",
    "ULTRAMAN",
    ["ダイナ", "戴拿", "dyna"],
  ),
  series(
    "ULTRAMAN_GAIA",
    "ウルトラマンガイア",
    "盖亚奥特曼",
    "Ultraman Gaia",
    "ULTRAMAN",
    ["ガイア", "盖亚", "gaia"],
  ),
  series(
    "ULTRAMAN_ZERO",
    "ウルトラマンゼロ",
    "赛罗奥特曼",
    "Ultraman Zero",
    "ULTRAMAN",
    ["ゼロ", "赛罗", "zero"],
  ),
  series(
    "ULTRAMAN_Z",
    "ウルトラマンZ",
    "泽塔奥特曼",
    "Ultraman Z",
    "ULTRAMAN",
    ["ウルトラマンゼット", "泽塔"],
  ),
  series(
    "ULTRAMAN_BLAZAR",
    "ウルトラマンブレーザー",
    "布莱泽奥特曼",
    "Ultraman Blazar",
    "ULTRAMAN",
    ["ブレーザー", "布莱泽", "blazar"],
  ),
  series(
    "ULTRAMAN_ARC",
    "ウルトラマンアーク",
    "亚刻奥特曼",
    "Ultraman Arc",
    "ULTRAMAN",
    ["アーク", "亚刻", "arc"],
  ),

  simple("manufacturer", "bandai", "バンダイ", "万代", "BANDAI", [
    "万代株式会社",
  ]),
  simple(
    "manufacturer",
    "bandai_spirits",
    "BANDAI SPIRITS",
    "万代魂",
    "BANDAI SPIRITS",
    ["バンダイスピリッツ"],
  ),
  simple(
    "manufacturer",
    "banpresto",
    "バンプレスト",
    "眼镜厂",
    "BANPRESTO",
    [],
  ),
  simple(
    "manufacturer",
    "megahouse",
    "メガハウス",
    "MegaHouse",
    "MegaHouse",
    [],
  ),
  simple("manufacturer", "plex", "プレックス", "PLEX", "PLEX", []),

  simple("toy_type", "sofubi", "ソフビ", "软胶", "Soft vinyl", ["soft vinyl"]),
  simple(
    "toy_type",
    "finger_puppet",
    "指人形",
    "手指玩偶",
    "Finger puppet",
    [],
  ),
  simple("toy_type", "gashapon", "ガシャポン", "扭蛋", "Gashapon", [
    "ガチャ",
    "カプセル",
  ]),
  simple("toy_type", "shokugan", "食玩", "食玩", "Candy toy", ["shokugan"]),
  simple("toy_type", "figure", "フィギュア", "手办", "Figure", [
    "s h figuarts",
    "shf",
    "s.h.figuarts",
  ]),
  simple(
    "toy_type",
    "dx_belt",
    "変身ベルト",
    "DX变身腰带",
    "DX transformation belt",
    ["dx belt", "driver", "ドライバー"],
  ),
  simple(
    "toy_type",
    "henshin_item",
    "変身アイテム",
    "变身道具",
    "Transformation item",
    ["変身", "henshin"],
  ),
  simple("toy_type", "medal", "メダル", "奖牌/硬币道具", "Medal", []),
  simple("toy_type", "model", "プラモデル", "模型", "Model kit", ["model kit"]),
  simple("toy_type", "set", "まとめ売り", "整批套装", "Lot", [
    "大量",
    "セット",
    "lot",
  ]),
];

export function resolveCatalogEntry(
  kind: CatalogKind,
  text: string,
): CatalogResolution | null {
  const normalized = ` ${normalizeCatalogText(text)} `;
  const matches = catalogEntries
    .filter((entry) => entry.kind === kind)
    .flatMap((entry) =>
      entry.aliases.map((alias) => ({
        entry,
        alias,
        normalizedAlias: normalizeCatalogText(alias),
      })),
    )
    .filter(({ normalizedAlias }) => {
      if (normalizedAlias.length < 2) return false;
      return (
        normalized.includes(` ${normalizedAlias} `) ||
        normalized.includes(normalizedAlias)
      );
    })
    .sort((a, b) => b.normalizedAlias.length - a.normalizedAlias.length);
  const best = matches[0];
  if (!best) return null;
  const canonicalNames = [
    best.entry.nameJa,
    best.entry.nameZh,
    best.entry.nameEn,
  ]
    .filter(Boolean)
    .map((name) => normalizeCatalogText(String(name)));
  const confidence = canonicalNames.includes(best.normalizedAlias)
    ? 0.98
    : best.normalizedAlias.length >= 4
      ? 0.94
      : 0.82;
  return {
    value: best.entry,
    confidence,
    evidence: `文本中出现“${best.alias}”`,
    matchedAlias: best.alias,
  };
}

export function entriesForSeed() {
  return catalogEntries.map((entry) => ({
    ...entry,
    aliases: [...new Set(entry.aliases)],
  }));
}
