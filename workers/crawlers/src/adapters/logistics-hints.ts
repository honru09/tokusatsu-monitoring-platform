import type { RawItemDetail } from "@tokusatsu/shared";

export type LogisticsHintBasis =
  | "package"
  | "product"
  | "unspecified"
  | "mixed";

export type LogisticsHints = {
  weightGrams?: number;
  /** Explicit cubic volume, kept separate from dimensions and provenance. */
  volumeCm3?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  evidence?: string[];
  basis?: LogisticsHintBasis;
  volumeBasis?: LogisticsHintBasis;
  dimensionBasis?: LogisticsHintBasis;
  weightBasis?: LogisticsHintBasis;
};

export type LogisticsHintInput = Partial<
  Pick<
    RawItemDetail,
    "titleRaw" | "descriptionRaw" | "conditionRaw" | "sourceData"
  >
>;

type ConcreteBasis = Exclude<LogisticsHintBasis, "mixed">;
type DimensionValues = Required<
  Pick<LogisticsHints, "lengthMm" | "widthMm" | "heightMm">
>;
type DimensionCandidate = DimensionValues & {
  evidence: string;
  basis: ConcreteBasis;
  priority: number;
};
type WeightCandidate = {
  weightGrams: number;
  evidence: string;
  basis: ConcreteBasis;
  priority: number;
};
type VolumeCandidate = {
  volumeCm3: number;
  evidence: string;
  basis: ConcreteBasis;
  priority: number;
};
type TextFragment = { path: string; text: string };

const NUMBER_SOURCE = String.raw`\d{1,7}(?:[.,]\d+)?`;
const DIMENSION_UNIT_SOURCE = String.raw`mm|㎜|ミリ(?:メートル)?|cm|㎝|センチ(?:メートル)?|m|メートル`;
const WEIGHT_UNIT_SOURCE = String.raw`kg|㎏|キログラム|キロ|g|ｇ|グラム`;
const VOLUME_UNIT_SOURCE = String.raw`mm(?:3|³)|㎣|ミリ(?:メートル)?(?:3|³)|cm(?:3|³)|㎤|センチ(?:メートル)?(?:3|³)|m(?:3|³)|㎥|メートル(?:3|³)|立方(?:ミリ(?:メートル)?|センチ(?:メートル)?|メートル)|ml|mℓ|ミリリットル|l|ℓ|リットル`;
const MAX_DIMENSION_MM = 20_000;
const MAX_WEIGHT_GRAMS = 2_000_000;
const MAX_VOLUME_CM3 = 2_000_000_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const normalized = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)
    ? text.replace(/,/g, "")
    : text.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUnit(value: unknown) {
  const unit = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["mm", "㎜", "mmt", "ミリ", "ミリメートル"].includes(unit))
    return "mm" as const;
  if (["cm", "㎝", "cmt", "センチ", "センチメートル"].includes(unit))
    return "cm" as const;
  if (["m", "mtr", "メートル"].includes(unit)) return "m" as const;
  if (["g", "ｇ", "grm", "グラム"].includes(unit)) return "g" as const;
  if (["kg", "㎏", "kgm", "キロ", "キログラム"].includes(unit))
    return "kg" as const;
  return undefined;
}

type VolumeUnit = "mm3" | "cm3" | "m3" | "l";

function normalizeVolumeUnit(value: unknown): VolumeUnit | undefined {
  const unit = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (
    [
      "mm3",
      "mm³",
      "㎣",
      "立方毫米",
      "立方ミリ",
      "立方ミリメートル",
      "ミリ立方",
      "mmq",
    ].includes(unit)
  )
    return "mm3";
  if (
    [
      "cm3",
      "cm³",
      "㎤",
      "立方厘米",
      "立方センチ",
      "立方センチメートル",
      "センチ立方",
      "cmq",
      "ml",
      "mℓ",
      "milliliter",
      "millilitre",
      "ミリリットル",
    ].includes(unit)
  )
    return "cm3";
  if (
    [
      "m3",
      "m³",
      "㎥",
      "立方米",
      "立方メートル",
      "メートル立方",
      "mtq",
    ].includes(unit)
  )
    return "m3";
  if (["l", "ℓ", "liter", "litre", "リットル", "ltr"].includes(unit))
    return "l";
  return undefined;
}

function volumeUnitFromKey(key: string) {
  const normalized = key.toLowerCase().replace(/[\s_.\-]/g, "");
  if (/(?:mm3|mm³|mmq)$/.test(normalized)) return "mm3" as const;
  if (/(?:cm3|cm³|㎤|cmq|ml)$/.test(normalized)) return "cm3" as const;
  if (/(?:m3|m³|㎥|mtq)$/.test(normalized)) return "m3" as const;
  if (/(?:liter|litre|ltr|l)$/.test(normalized)) return "l" as const;
  return undefined;
}

function volumeValue(value: number, unit: VolumeUnit | undefined) {
  const multiplier =
    unit === "mm3"
      ? 0.001
      : unit === "m3"
        ? 1_000_000
        : unit === "l"
          ? 1_000
          : 1;
  const volume = Math.round(value * multiplier);
  return volume > 0 && volume <= MAX_VOLUME_CM3 ? volume : undefined;
}

function volumeMeasurement(value: unknown, fallbackUnit?: VolumeUnit) {
  const object = record(value);
  if (object) {
    const unit =
      normalizeVolumeUnit(
        object.unitCode ?? object.unitText ?? object.unit ?? object.units,
      ) ?? fallbackUnit;
    return volumeMeasurement(
      object.value ?? object.amount ?? object.measurement ?? object.maxValue,
      unit,
    );
  }
  if (typeof value === "number")
    return fallbackUnit ? volumeValue(value, fallbackUnit) : undefined;
  const text = String(value ?? "").trim();
  const match = text.match(
    new RegExp(`(${NUMBER_SOURCE})\\s*(${VOLUME_UNIT_SOURCE})`, "iu"),
  );
  const amount = numeric(match?.[1] ?? (fallbackUnit ? text : undefined));
  const unit = normalizeVolumeUnit(match?.[2]) ?? fallbackUnit;
  return amount == null || !unit ? undefined : volumeValue(amount, unit);
}

function unitFromKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.endsWith("millimeters") || normalized.endsWith("mm"))
    return "mm" as const;
  if (normalized.endsWith("centimeters") || normalized.endsWith("cm"))
    return "cm" as const;
  if (normalized.endsWith("kilograms") || normalized.endsWith("kg"))
    return "kg" as const;
  if (normalized.endsWith("grams") || normalized.endsWith("gram"))
    return "g" as const;
  return undefined;
}

function dimensionMm(value: number, unit: string | undefined) {
  const multiplier = unit === "m" ? 1_000 : unit === "cm" ? 10 : 1;
  const millimetres = Math.round(value * multiplier);
  return millimetres > 0 && millimetres <= MAX_DIMENSION_MM
    ? millimetres
    : undefined;
}

function grams(value: number, unit: string | undefined) {
  const weight = Math.round(value * (unit === "kg" ? 1_000 : 1));
  return weight > 0 && weight <= MAX_WEIGHT_GRAMS ? weight : undefined;
}

function measurement(
  value: unknown,
  kind: "dimension" | "weight",
  fallbackUnit?: string,
) {
  const object = record(value);
  if (object) {
    const unit =
      normalizeUnit(
        object.unitCode ?? object.unitText ?? object.unit ?? object.units,
      ) ?? fallbackUnit;
    return measurement(
      object.value ?? object.amount ?? object.measurement ?? object.maxValue,
      kind,
      unit,
    );
  }
  if (typeof value === "number") {
    if (!fallbackUnit) return undefined;
    return kind === "dimension"
      ? dimensionMm(value, fallbackUnit)
      : grams(value, fallbackUnit);
  }
  const text = String(value ?? "").trim();
  const unitSource =
    kind === "dimension" ? DIMENSION_UNIT_SOURCE : WEIGHT_UNIT_SOURCE;
  const match = text.match(
    new RegExp(`(${NUMBER_SOURCE})\\s*(${unitSource})`, "iu"),
  );
  const amount = numeric(match?.[1] ?? (fallbackUnit ? text : undefined));
  const unit = normalizeUnit(match?.[2]) ?? fallbackUnit;
  if (amount == null || !unit) return undefined;
  return kind === "dimension" ? dimensionMm(amount, unit) : grams(amount, unit);
}

function standardized(value: unknown, maximum: number) {
  const parsed = numeric(value);
  if (parsed == null) return undefined;
  const rounded = Math.round(parsed);
  return rounded > 0 && rounded <= maximum ? rounded : undefined;
}

function basisFromText(value: string): ConcreteBasis {
  if (/梱包|発送|配送|外箱|package|shipping|packed|carton/i.test(value))
    return "package";
  if (/商品|本体|製品|product|item\b/i.test(value)) return "product";
  return "unspecified";
}

type BasisCue = { basis: Exclude<ConcreteBasis, "unspecified"> };

function basisCues(value: string): BasisCue[] {
  const cues: BasisCue[] = [];
  const pattern =
    /梱包|発送|配送|外箱|package|shipping|packed|carton|商品|本体|製品|product|item\b/giu;
  for (const match of value.matchAll(pattern)) {
    cues.push({
      basis: /梱包|発送|配送|外箱|package|shipping|packed|carton/i.test(
        match[0],
      )
        ? "package"
        : "product",
    });
  }
  return cues;
}

/**
 * Attribute a measurement from the label attached to that measurement, not
 * from an unrelated shipping/product word elsewhere in the description.
 * Labels normally precede marketplace measurements; a short trailing label is
 * accepted for forms such as `30 x 20 x 10 cm (packed)`.
 */
function measurementBasis(
  path: string,
  text: string,
  start: number,
  length: number,
): ConcreteBasis {
  const boundary = /[\r\n。.!?！？;；、,]/;
  const beforeWindow = text.slice(Math.max(0, start - 48), start);
  const lastBoundary = Math.max(
    ...[...beforeWindow].flatMap((character, index) =>
      boundary.test(character) ? [index] : [],
    ),
    -1,
  );
  const attachedPrefix =
    beforeWindow.slice(lastBoundary + 1) +
    text.slice(start, start + Math.min(length, 24));
  const prefixCues = basisCues(attachedPrefix);
  if (prefixCues.length) return prefixCues.at(-1)!.basis;

  const afterWindow = text.slice(start + length, start + length + 32);
  const boundaryIndex = [...afterWindow].findIndex((character) =>
    boundary.test(character),
  );
  const attachedSuffix =
    boundaryIndex < 0 ? afterWindow : afterWindow.slice(0, boundaryIndex);
  const suffixCue = basisCues(attachedSuffix)[0];
  if (suffixCue) return suffixCue.basis;
  return basisFromText(path);
}

function logisticsBasis(value: unknown): LogisticsHintBasis | undefined {
  return typeof value === "string" &&
    ["package", "product", "unspecified", "mixed"].includes(value)
    ? (value as LogisticsHintBasis)
    : undefined;
}

function aggregateBasis(values: Array<LogisticsHintBasis | undefined>) {
  const present = values.filter(
    (value): value is LogisticsHintBasis => value != null,
  );
  if (!present.length) return undefined;
  if (present.includes("mixed")) return "mixed" as const;
  const concrete = new Set(present.filter((value) => value !== "unspecified"));
  if (concrete.size > 1) return "mixed" as const;
  return concrete.values().next().value ?? "unspecified";
}

function excerpt(text: string, start: number, length: number) {
  const from = Math.max(0, start - 70);
  const to = Math.min(text.length, start + length + 70);
  return text.slice(from, to).replace(/\s+/g, " ").trim().slice(0, 240);
}

function dimensionTripleCandidates(
  fragment: TextFragment,
  priority: number,
): DimensionCandidate[] {
  const pattern = new RegExp(
    `(${NUMBER_SOURCE})\\s*(${DIMENSION_UNIT_SOURCE})?\\s*[x×✕＊*]\\s*` +
      `(${NUMBER_SOURCE})\\s*(${DIMENSION_UNIT_SOURCE})?\\s*[x×✕＊*]\\s*` +
      `(${NUMBER_SOURCE})\\s*(${DIMENSION_UNIT_SOURCE})?`,
    "giu",
  );
  const candidates: DimensionCandidate[] = [];
  for (const match of fragment.text.matchAll(pattern)) {
    const explicitUnits = [match[2], match[4], match[6]]
      .map(normalizeUnit)
      .filter((unit): unit is "mm" | "cm" | "m" =>
        ["mm", "cm", "m"].includes(unit ?? ""),
      );
    if (!explicitUnits.length) continue;
    const fallbackUnit = explicitUnits.at(-1);
    const lengthMm = dimensionMm(
      numeric(match[1]) ?? 0,
      normalizeUnit(match[2]) ?? fallbackUnit,
    );
    const widthMm = dimensionMm(
      numeric(match[3]) ?? 0,
      normalizeUnit(match[4]) ?? fallbackUnit,
    );
    const heightMm = dimensionMm(
      numeric(match[5]) ?? 0,
      normalizeUnit(match[6]) ?? fallbackUnit,
    );
    if (lengthMm == null || widthMm == null || heightMm == null) continue;
    const evidence = excerpt(fragment.text, match.index ?? 0, match[0].length);
    candidates.push({
      lengthMm,
      widthMm,
      heightMm,
      evidence: `${fragment.path}: ${evidence}`,
      basis: measurementBasis(
        fragment.path,
        fragment.text,
        match.index ?? 0,
        match[0].length,
      ),
      priority,
    });
  }
  return candidates;
}

type NamedMeasurement = {
  value: number;
  unit?: string;
  start: number;
  end: number;
};

function namedMeasurements(text: string, labelSource: string) {
  const pattern = new RegExp(
    `${labelSource}\\s*[:：=]?\\s*(?:約\\s*)?(${NUMBER_SOURCE})\\s*(${DIMENSION_UNIT_SOURCE})?`,
    "giu",
  );
  return [...text.matchAll(pattern)].flatMap((match): NamedMeasurement[] => {
    const value = numeric(match[1]);
    if (value == null) return [];
    return [
      {
        value,
        unit: normalizeUnit(match[2]),
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      },
    ];
  });
}

function namedDimensionCandidates(
  fragment: TextFragment,
  priority: number,
): DimensionCandidate[] {
  const numberAhead = String.raw`(?=\s*[:：=]?\s*(?:約\s*)?\d)`;
  const widths = namedMeasurements(
    fragment.text,
    String.raw`(?:\bwidth\b|(?:^|[^A-Za-z])W${numberAhead}|幅)`,
  );
  const depths = namedMeasurements(
    fragment.text,
    String.raw`(?:\b(?:depth|length)\b|(?:^|[^A-Za-z])(?:D|L)${numberAhead}|奥行き?)`,
  );
  const heights = namedMeasurements(
    fragment.text,
    String.raw`(?:\bheight\b|(?:^|[^A-Za-z])H${numberAhead}|高さ)`,
  );
  const candidates: DimensionCandidate[] = [];
  for (const width of widths) {
    for (const depth of depths) {
      for (const height of heights) {
        const start = Math.min(width.start, depth.start, height.start);
        const end = Math.max(width.end, depth.end, height.end);
        if (end - start > 180) continue;
        const axisBasis = aggregateBasis(
          [width, depth, height].map((measurement) =>
            measurementBasis(
              fragment.path,
              fragment.text,
              measurement.start,
              measurement.end - measurement.start,
            ),
          ),
        );
        // Named axes can be spread across nearby sentences. Never assemble a
        // synthetic triple when one axis describes the product and another
        // describes the shipping package.
        if (axisBasis === "mixed") continue;
        const units = [width.unit, depth.unit, height.unit].filter(
          (unit): unit is string => Boolean(unit),
        );
        if (!units.length) continue;
        const fallbackUnit = units.at(-1);
        const widthMm = dimensionMm(width.value, width.unit ?? fallbackUnit);
        const lengthMm = dimensionMm(depth.value, depth.unit ?? fallbackUnit);
        const heightMm = dimensionMm(height.value, height.unit ?? fallbackUnit);
        if (lengthMm == null || widthMm == null || heightMm == null) continue;
        const evidence = excerpt(fragment.text, start, end - start);
        candidates.push({
          lengthMm,
          widthMm,
          heightMm,
          evidence: `${fragment.path}: ${evidence}`,
          basis:
            axisBasis ??
            measurementBasis(fragment.path, fragment.text, start, end - start),
          priority,
        });
      }
    }
  }
  return candidates;
}

function weightCandidates(
  fragment: TextFragment,
  priority: number,
): WeightCandidate[] {
  const pattern = new RegExp(
    `(?:梱包|発送|配送|商品|本体|製品|package|shipping|product|item)?\\s*` +
      `(?:重量|重さ|weight|mass)\\s*[:：=]?\\s*(?:約\\s*)?` +
      `(${NUMBER_SOURCE})\\s*(${WEIGHT_UNIT_SOURCE})`,
    "giu",
  );
  const candidates: WeightCandidate[] = [];
  for (const match of fragment.text.matchAll(pattern)) {
    const weightGrams = grams(numeric(match[1]) ?? 0, normalizeUnit(match[2]));
    if (weightGrams == null) continue;
    const evidence = excerpt(fragment.text, match.index ?? 0, match[0].length);
    candidates.push({
      weightGrams,
      evidence: `${fragment.path}: ${evidence}`,
      basis: measurementBasis(
        fragment.path,
        fragment.text,
        match.index ?? 0,
        match[0].length,
      ),
      priority,
    });
  }
  return candidates;
}

function volumeCandidates(
  fragment: TextFragment,
  priority: number,
): VolumeCandidate[] {
  const pattern = new RegExp(
    `(?:体積|容積|volume|cubic\\s*(?:volume|size))\\s*[:：=]?\\s*(?:約\\s*)?` +
      `(${NUMBER_SOURCE})\\s*(${VOLUME_UNIT_SOURCE})`,
    "giu",
  );
  const candidates: VolumeCandidate[] = [];
  for (const match of fragment.text.matchAll(pattern)) {
    const volumeCm3 = volumeMeasurement(
      `${match[1]} ${match[2]}`,
      normalizeVolumeUnit(match[2]),
    );
    if (volumeCm3 == null) continue;
    const evidence = excerpt(fragment.text, match.index ?? 0, match[0].length);
    candidates.push({
      volumeCm3,
      evidence: `${fragment.path}: ${evidence}`,
      basis: measurementBasis(
        fragment.path,
        fragment.text,
        match.index ?? 0,
        match[0].length,
      ),
      priority,
    });
  }
  return candidates;
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[\s_.\-]/g, "");
}

function property(
  object: Record<string, unknown>,
  accepted: (key: string) => boolean,
) {
  return Object.entries(object).find(([key]) => accepted(normalizedKey(key)));
}

function printable(value: unknown) {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  try {
    return JSON.stringify(value).slice(0, 240);
  } catch {
    return "[structured value]";
  }
}

function structuredCandidates(sourceData: unknown) {
  const dimensions: DimensionCandidate[] = [];
  const weights: WeightCandidate[] = [];
  const volumes: VolumeCandidate[] = [];
  let visited = 0;

  const visit = (value: unknown, path: string, depth: number) => {
    if (visited >= 600 || depth > 10) return;
    if (Array.isArray(value)) {
      visited += 1;
      value.forEach((entry, index) =>
        visit(entry, `${path}[${index}]`, depth + 1),
      );
      return;
    }
    const object = record(value);
    if (!object) return;
    visited += 1;
    const context = [
      path,
      typeof object.name === "string" ? object.name : "",
      typeof object["@type"] === "string" ? object["@type"] : "",
    ].join(" ");
    const basis = basisFromText(context);
    const parentUnit = normalizeUnit(
      object.unitCode ?? object.unitText ?? object.unit ?? object.units,
    );
    const parentVolumeUnit = normalizeVolumeUnit(
      object.volumeUnit ??
        object.volumeUnitCode ??
        object.unitCode ??
        object.unitText ??
        object.unit ??
        object.units,
    );

    const width = property(
      object,
      (key) =>
        key === "width" ||
        key === "widthmm" ||
        key === "widthcm" ||
        key === "幅",
    );
    const length = property(object, (key) =>
      [
        "depth",
        "depthmm",
        "depthcm",
        "length",
        "lengthmm",
        "lengthcm",
        "奥行",
        "奥行き",
      ].includes(key),
    );
    const height = property(
      object,
      (key) =>
        key === "height" ||
        key === "heightmm" ||
        key === "heightcm" ||
        key === "高さ",
    );
    if (width && length && height) {
      const widthMm = measurement(
        width[1],
        "dimension",
        unitFromKey(width[0]) ?? parentUnit,
      );
      const lengthMm = measurement(
        length[1],
        "dimension",
        unitFromKey(length[0]) ?? parentUnit,
      );
      const heightMm = measurement(
        height[1],
        "dimension",
        unitFromKey(height[0]) ?? parentUnit,
      );
      if (widthMm != null && lengthMm != null && heightMm != null) {
        dimensions.push({
          lengthMm,
          widthMm,
          heightMm,
          evidence: `${path}: ${width[0]}=${printable(width[1])}, ${length[0]}=${printable(length[1])}, ${height[0]}=${printable(height[1])}`,
          basis,
          priority: 2,
        });
      }
    }

    const volume = property(object, (key) =>
      [
        "volume",
        "volumecm3",
        "volumemm3",
        "volumem3",
        "cubicvolume",
        "cubicvolumecm3",
        "体積",
        "容積",
      ].includes(key),
    );
    if (volume) {
      const volumeCm3 = volumeMeasurement(
        volume[1],
        volumeUnitFromKey(volume[0]) ?? parentVolumeUnit,
      );
      if (volumeCm3 != null)
        volumes.push({
          volumeCm3,
          evidence: `${path}: ${volume[0]}=${printable(volume[1])}`,
          basis: basisFromText(`${context} ${volume[0]}`),
          priority: 2,
        });
    }

    for (const [key, entry] of Object.entries(object)) {
      const normalized = normalizedKey(key);
      if (
        /(?:^|package|shipping|product|item)(?:weight|mass)/.test(normalized) ||
        /重量|重さ/.test(key)
      ) {
        const weightGrams = measurement(
          entry,
          "weight",
          unitFromKey(key) ?? parentUnit,
        );
        if (weightGrams != null)
          weights.push({
            weightGrams,
            evidence: `${path}.${key}: ${printable(entry)}`,
            basis: basisFromText(`${context} ${key}`),
            priority: 2,
          });
      }
      if (
        /^(?:dimensions?|size|packagesize|packagedimensions?|productsize|itemsize)$/.test(
          normalized,
        ) ||
        /寸法|サイズ/.test(key)
      ) {
        const text = printable(entry);
        const fragment = { path: `${path}.${key}`, text };
        dimensions.push(
          ...dimensionTripleCandidates(fragment, 2),
          ...namedDimensionCandidates(fragment, 2),
        );
      }
      if (
        /^(?:volume|volumecm3|volumemm3|volumem3|cubicvolume|cubicvolumecm3)$/.test(
          normalized,
        ) ||
        /体積|容積/.test(key)
      ) {
        const volumeCm3 = volumeMeasurement(
          entry,
          volumeUnitFromKey(key) ?? parentVolumeUnit,
        );
        if (volumeCm3 != null)
          volumes.push({
            volumeCm3,
            evidence: `${path}.${key}: ${printable(entry)}`,
            basis: basisFromText(`${context} ${key}`),
            priority: 2,
          });
      }
    }

    const propertyName =
      typeof object.name === "string"
        ? object.name
        : typeof object.propertyID === "string"
          ? object.propertyID
          : undefined;
    if (propertyName && "value" in object) {
      if (/重量|重さ|weight|mass/i.test(propertyName)) {
        const weightGrams = measurement(object.value, "weight", parentUnit);
        if (weightGrams != null)
          weights.push({
            weightGrams,
            evidence: `${path}: ${propertyName}=${printable(object.value)}`,
            basis: basisFromText(`${context} ${propertyName}`),
            priority: 2,
          });
      }
      if (/体積|容积|容積|volume|cubic/i.test(propertyName)) {
        const volumeCm3 = volumeMeasurement(object.value, parentVolumeUnit);
        if (volumeCm3 != null)
          volumes.push({
            volumeCm3,
            evidence: `${path}: ${propertyName}=${printable(object.value)}`,
            basis: basisFromText(`${context} ${propertyName}`),
            priority: 2,
          });
      }
      if (/寸法|サイズ|dimensions?|size/i.test(propertyName)) {
        const fragment = {
          path,
          text: `${propertyName}: ${printable(object.value)}`,
        };
        dimensions.push(
          ...dimensionTripleCandidates(fragment, 2),
          ...namedDimensionCandidates(fragment, 2),
        );
      }
    }

    for (const [key, entry] of Object.entries(object)) {
      if (normalizedKey(key) === "logisticshints") continue;
      visit(entry, `${path}.${key}`, depth + 1);
    }
  };

  visit(sourceData, "sourceData", 0);
  return { dimensions, weights, volumes };
}

function textFragments(input: LogisticsHintInput) {
  const fragments: TextFragment[] = [];
  const add = (path: string, value: unknown) => {
    if (typeof value !== "string" || !value.trim() || fragments.length >= 180)
      return;
    fragments.push({ path, text: value.trim().slice(0, 20_000) });
  };
  add("titleRaw", input.titleRaw);
  add("descriptionRaw", input.descriptionRaw);
  add("conditionRaw", input.conditionRaw);

  let visited = 0;
  const visit = (value: unknown, path: string, depth: number) => {
    if (visited >= 600 || depth > 10 || fragments.length >= 180) return;
    if (typeof value === "string") {
      add(path, value);
      return;
    }
    if (Array.isArray(value)) {
      visited += 1;
      value.forEach((entry, index) =>
        visit(entry, `${path}[${index}]`, depth + 1),
      );
      return;
    }
    const object = record(value);
    if (!object) return;
    visited += 1;
    for (const [key, entry] of Object.entries(object)) {
      if (normalizedKey(key) === "logisticshints") continue;
      visit(entry, `${path}.${key}`, depth + 1);
    }
  };
  visit(input.sourceData, "sourceData", 0);
  return fragments;
}

function chooseDimensions(candidates: DimensionCandidate[]) {
  if (!candidates.length) return undefined;
  const basisRank = (basis: ConcreteBasis) =>
    basis === "package" ? 3 : basis === "product" ? 2 : 1;
  const rank = Math.max(
    ...candidates.map((candidate) => basisRank(candidate.basis)),
  );
  const byBasis = candidates.filter(
    (candidate) => basisRank(candidate.basis) === rank,
  );
  const priority = Math.max(...byBasis.map((candidate) => candidate.priority));
  const finalists = byBasis.filter(
    (candidate) => candidate.priority === priority,
  );
  const first = finalists[0];
  const conflict = finalists.some(
    (candidate) =>
      candidate.lengthMm !== first.lengthMm ||
      candidate.widthMm !== first.widthMm ||
      candidate.heightMm !== first.heightMm,
  );
  return conflict ? undefined : first;
}

function chooseWeight(candidates: WeightCandidate[]) {
  if (!candidates.length) return undefined;
  const basisRank = (basis: ConcreteBasis) =>
    basis === "package" ? 3 : basis === "product" ? 2 : 1;
  const rank = Math.max(
    ...candidates.map((candidate) => basisRank(candidate.basis)),
  );
  const byBasis = candidates.filter(
    (candidate) => basisRank(candidate.basis) === rank,
  );
  const priority = Math.max(...byBasis.map((candidate) => candidate.priority));
  const finalists = byBasis.filter(
    (candidate) => candidate.priority === priority,
  );
  const first = finalists[0];
  return finalists.some(
    (candidate) => candidate.weightGrams !== first.weightGrams,
  )
    ? undefined
    : first;
}

function chooseVolume(candidates: VolumeCandidate[]) {
  if (!candidates.length) return undefined;
  const basisRank = (basis: ConcreteBasis) =>
    basis === "package" ? 3 : basis === "product" ? 2 : 1;
  const rank = Math.max(
    ...candidates.map((candidate) => basisRank(candidate.basis)),
  );
  const byBasis = candidates.filter(
    (candidate) => basisRank(candidate.basis) === rank,
  );
  const priority = Math.max(...byBasis.map((candidate) => candidate.priority));
  const finalists = byBasis.filter(
    (candidate) => candidate.priority === priority,
  );
  const first = finalists[0];
  return finalists.some((candidate) => candidate.volumeCm3 !== first.volumeCm3)
    ? undefined
    : first;
}

function existingHints(sourceData: unknown): LogisticsHints {
  const hints = record(record(sourceData)?.logisticsHints);
  if (!hints) return {};
  const result: LogisticsHints = {};
  const weightGrams = standardized(hints.weightGrams, MAX_WEIGHT_GRAMS);
  const volumeCm3 = standardized(hints.volumeCm3, MAX_VOLUME_CM3);
  const lengthMm = standardized(hints.lengthMm, MAX_DIMENSION_MM);
  const widthMm = standardized(hints.widthMm, MAX_DIMENSION_MM);
  const heightMm = standardized(hints.heightMm, MAX_DIMENSION_MM);
  if (weightGrams != null) result.weightGrams = weightGrams;
  if (volumeCm3 != null) result.volumeCm3 = volumeCm3;
  if (lengthMm != null) result.lengthMm = lengthMm;
  if (widthMm != null) result.widthMm = widthMm;
  if (heightMm != null) result.heightMm = heightMm;
  result.basis = logisticsBasis(hints.basis);
  if (result.volumeCm3 != null)
    result.volumeBasis = logisticsBasis(hints.volumeBasis) ?? result.basis;
  const hasDimensions =
    result.lengthMm != null ||
    result.widthMm != null ||
    result.heightMm != null;
  if (hasDimensions)
    result.dimensionBasis =
      logisticsBasis(hints.dimensionBasis) ?? result.basis;
  if (result.weightGrams != null)
    result.weightBasis = logisticsBasis(hints.weightBasis) ?? result.basis;
  const evidence = Array.isArray(hints.evidence)
    ? hints.evidence.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : typeof hints.evidence === "string"
      ? [hints.evidence]
      : [];
  if (evidence.length) result.evidence = evidence.slice(0, 8);
  return result;
}

/**
 * Extract only explicit physical measurements. Bare numbers, clothing sizes,
 * scales and model identifiers are deliberately ignored.
 */
export function extractLogisticsHints(
  input: LogisticsHintInput,
): LogisticsHints {
  const result = existingHints(input.sourceData);
  const legacyAggregateBasis = result.basis;
  const evidence = new Set(result.evidence ?? []);

  const structured = structuredCandidates(input.sourceData);
  const fragments = textFragments(input);
  const dimensionCandidates = [
    ...structured.dimensions,
    ...fragments.flatMap((fragment) => [
      ...dimensionTripleCandidates(fragment, 1),
      ...namedDimensionCandidates(fragment, 1),
    ]),
  ];
  const dimensions = chooseDimensions(dimensionCandidates);
  const weightCandidatesList = [
    ...structured.weights,
    ...fragments.flatMap((fragment) => weightCandidates(fragment, 1)),
  ];
  const weight = chooseWeight(weightCandidatesList);
  const volumeCandidatesList = [
    ...structured.volumes,
    ...fragments.flatMap((fragment) => volumeCandidates(fragment, 1)),
  ];
  const volume = chooseVolume(volumeCandidatesList);

  if (
    !dimensions &&
    dimensionCandidates.length &&
    (result.lengthMm != null ||
      result.widthMm != null ||
      result.heightMm != null)
  ) {
    evidence.add("尺寸证据冲突：多个同优先级尺寸值不一致");
    result.dimensionBasis = "mixed";
  }
  if (!weight && weightCandidatesList.length && result.weightGrams != null) {
    evidence.add("重量证据冲突：多个同优先级重量值不一致");
    result.weightBasis = "mixed";
  }
  if (!volume && volumeCandidatesList.length && result.volumeCm3 != null) {
    evidence.add("体积证据冲突：多个同优先级体积值不一致");
    result.volumeBasis = "mixed";
  }

  if (dimensions) {
    const conflictsWithExisting =
      (result.lengthMm != null && result.lengthMm !== dimensions.lengthMm) ||
      (result.widthMm != null && result.widthMm !== dimensions.widthMm) ||
      (result.heightMm != null && result.heightMm !== dimensions.heightMm);
    result.lengthMm ??= dimensions.lengthMm;
    result.widthMm ??= dimensions.widthMm;
    result.heightMm ??= dimensions.heightMm;
    if (!conflictsWithExisting) {
      evidence.add(dimensions.evidence);
      result.dimensionBasis = aggregateBasis([
        result.dimensionBasis,
        dimensions.basis,
      ]);
    } else {
      // Keep the old values for audit/recovery, but make the provenance
      // explicitly mixed.  Downstream procurement ranking only accepts a
      // dimensionBasis of "package", so a newly observed contradiction can
      // never silently reuse a stale package size as a known fact.
      evidence.add(`尺寸证据冲突：${dimensions.evidence}`);
      result.dimensionBasis = "mixed";
    }
  }
  if (result.weightGrams == null && weight) {
    result.weightGrams = weight.weightGrams;
    evidence.add(weight.evidence);
    result.weightBasis = weight.basis;
  }
  if (volume) {
    if (result.volumeCm3 == null) {
      result.volumeCm3 = volume.volumeCm3;
      result.volumeBasis = volume.basis;
      evidence.add(volume.evidence);
    } else if (result.volumeCm3 !== volume.volumeCm3) {
      evidence.add(`体积证据冲突：${volume.evidence}`);
      result.volumeBasis = "mixed";
    }
  }

  const hasValue =
    result.weightGrams != null ||
    result.volumeCm3 != null ||
    result.lengthMm != null ||
    result.widthMm != null ||
    result.heightMm != null;
  if (!hasValue) return {};
  if (evidence.size) result.evidence = [...evidence].slice(0, 8);
  const hasDimensions =
    result.lengthMm != null ||
    result.widthMm != null ||
    result.heightMm != null;
  result.basis = aggregateBasis([
    result.dimensionBasis,
    result.volumeBasis,
    result.weightBasis,
    hasDimensions && !result.dimensionBasis ? legacyAggregateBasis : undefined,
    result.weightGrams != null && !result.weightBasis
      ? legacyAggregateBasis
      : undefined,
  ]);
  return result;
}
