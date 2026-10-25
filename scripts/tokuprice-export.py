#!/usr/bin/env python3
"""Daily tokuprice.com sold-price index export.

Runs on the tokusatsu production VM. Reads the production Postgres through
the read-only role `tokuprice_ro` (via the local postgres container),
aggregates sold items per canonical product, writes data/export.json into
the ~/tokuprice checkout, then commits and pushes (which triggers the
tokuprice GitHub Actions rebuild).

Only model-level aggregates are exported: no listing titles, no image URLs,
no seller information. The canonical product name kept here is the
platform's own dictionary name for the model (platform suffixes stripped),
never a raw marketplace listing title.

Exit code is non-zero on any failure; nothing is written or pushed in that
case, so the live site keeps the previous day's export.
"""

import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
ENV_FILE = HOME / "scripts" / ".tokuprice-ro.env"
CHECKOUT = HOME / "tokuprice"
CONTAINER = "tokusatsu-monitor-postgres-1"
FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY"

PLATFORMS = [
    "Mercari Japan",
    "Yahoo! Auctions Japan",
    "Rakuma",
    "Mandarake Kaitori & Archive",
    "Suruga-ya",
]

GRADE_MAP = {
    "new_sealed": "new_sealed",
    "like_new": "like_new",
    "used": "used",
    "stained_or_damaged": "damaged_or_junk",
    "junk": "damaged_or_junk",
}
CONDITION_KEYS = ["new_sealed", "like_new", "used", "damaged_or_junk"]
DAMAGED_NOTE = "Floor parts value. Excluded from functional medians."
SLUG_STOPWORDS = {"by", "mercari", "the", "and", "of", "rakuma", "yahoo"}


def fail(message: str) -> "SystemExit":
    print(f"[tokuprice-export] ERROR: {message}", file=sys.stderr)
    return SystemExit(1)


def load_env() -> dict:
    env = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    if "PGPASSWORD" not in env:
        raise fail(f"PGPASSWORD missing in {ENV_FILE}")
    return env


def run_sql(env: dict, sql: str) -> list[list[str]]:
    cmd = [
        "docker", "exec",
        "-e", f"PGPASSWORD={env['PGPASSWORD']}",
        CONTAINER,
        "psql", "-h", "127.0.0.1", "-U", "tokuprice_ro", "-d", "tokusatsu",
        "-A", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-t", "-c", sql,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise fail(f"SQL failed: {proc.stderr.strip()[:500]}")
    rows = []
    for line in proc.stdout.splitlines():
        if line.strip() == "":
            continue
        rows.append(line.split("\t"))
    return rows


def fetch_usd_jpy() -> tuple[float, str]:
    req = urllib.request.Request(FRANKFURTER_URL, headers={"User-Agent": "tokuprice-export/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    rate = float(payload["rates"]["JPY"])
    return rate, str(payload.get("date"))


def percentile(sorted_values: list[float], pct: float) -> float:
    """PERCENTILE_CONT semantics (linear interpolation)."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    rank = pct * (len(sorted_values) - 1)
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    frac = rank - low
    return sorted_values[low] * (1 - frac) + sorted_values[high] * frac


def iqr_clip(values: list[int]) -> list[int]:
    """Drop prices outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR]; no-op for small n."""
    if len(values) < 8:
        return list(values)
    ordered = sorted(values)
    q1 = percentile(ordered, 0.25)
    q3 = percentile(ordered, 0.75)
    iqr = q3 - q1
    if iqr <= 0:
        return list(values)
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    return [v for v in values if lo <= v <= hi]


def median_int(values: list[int]) -> int:
    if not values:
        return 0
    return int(round(percentile(sorted(values), 0.5)))


def clean_product_name(name: str) -> str:
    cleaned = re.sub(r"\s+by\s+(メルカリ|mercari|rakuma|ラクマ)\s*$", "", name, flags=re.IGNORECASE)
    return cleaned.strip()


def slugify(normalized_name: str, canonical_key: str, used: set) -> str:
    tokens = [
        t for t in re.findall(r"[a-z0-9]+", (normalized_name or "").lower())
        if (len(t) >= 2 or t.isdigit()) and t not in SLUG_STOPWORDS
    ]
    slug = "-".join(tokens[:6]).strip("-")
    if len(tokens) < 2 or len(slug) < 4:
        slug = f"model-{canonical_key[:10].lower()}"
    base, n = slug, 2
    while slug in used:
        slug = f"{base}-{n}"
        n += 1
    used.add(slug)
    return slug


def series_slug(series_key: str | None, franchise_key: str) -> tuple[str, str]:
    """Returns (series_slug, fallback_name). Strips the franchise prefix."""
    if not series_key:
        return "general", ""
    key = series_key.upper()
    for prefix in ("KAMEN_RIDER_", "ULTRAMAN_", "SUPER_SENTAI_"):
        if key.startswith(prefix):
            return key[len(prefix):].lower(), ""
    if key == franchise_key.upper():
        return "general", ""
    return key.lower(), ""


def main() -> int:
    env = load_env()
    try:
        rate, rate_date = fetch_usd_jpy()
    except Exception as exc:  # noqa: BLE001 - any failure must abort the export
        raise fail(f"USD/JPY fetch failed: {exc}")

    catalog_rows = run_sql(env, """
        SELECT p.id, p.canonical_key, p.canonical_name, p.normalized_name,
               COALESCE(p.release_year, 0), f.key, COALESCE(f.name_en, ''),
               s.key, COALESCE(s.name_en, ''),
               COALESCE(tt.key, p.product_line, 'dx_belt'),
               COALESCE(mf.name_en, 'Bandai')
        FROM products p
        JOIN franchises f ON f.id = p.franchise_id
        LEFT JOIN series s ON s.id = p.series_id
        LEFT JOIN toy_types tt ON tt.id = p.toy_type_id
        LEFT JOIN manufacturers mf ON mf.id = p.manufacturer_id
        WHERE f.key IN ('KAMEN_RIDER', 'ULTRAMAN')
    """)

    alias_rows = run_sql(env, """
        SELECT entity_key, alias_text FROM catalog_aliases WHERE entity_type = 'product'
    """)
    aliases_by_key: dict[str, list[str]] = {}
    for entity_key, alias_text in alias_rows:
        if alias_text:
            aliases_by_key.setdefault(entity_key, []).append(alias_text)

    item_rows = run_sql(env, """
        SELECT product_id, "priceTotalEst", "conditionGrade",
               EXTRACT(EPOCH FROM "detectedAt"), 
               CASE WHEN "listedAt" IS NULL THEN '' ELSE EXTRACT(EPOCH FROM "listedAt")::text END,
               CASE WHEN "lastSeenAt" IS NULL THEN '' ELSE EXTRACT(EPOCH FROM "lastSeenAt")::text END
        FROM "Item"
        WHERE status = 'sold' AND "needsReview" = false AND product_id IS NOT NULL
    """)

    now = datetime.now(timezone.utc)
    now_ts = now.timestamp()
    items_by_product: dict[str, list[dict]] = {}
    for product_id, price, grade, detected_ts, listed_ts, seen_ts in item_rows:
        items_by_product.setdefault(product_id, []).append({
            "price": int(float(price)),
            "grade": grade,
            "ts": float(detected_ts),
            "listed": float(listed_ts) if listed_ts else None,
            "seen": float(seen_ts) if seen_ts else None,
        })

    def window_items(items: list[dict], days: int) -> list[dict]:
        cutoff = now_ts - days * 86400
        return [i for i in items if i["ts"] >= cutoff]

    def condition_metric(items30: list[dict], bucket: str) -> dict:
        prices = [i["price"] for i in items30 if GRADE_MAP.get(i["grade"]) == bucket]
        clipped = iqr_clip(prices)
        metric = {
            "medianPriceJpy": int(round(percentile(sorted(clipped), 0.5))) if clipped else None,
            "medianPriceUsd": round(percentile(sorted(clipped), 0.5) / rate, 2) if clipped else None,
            "soldVolume30d": len(prices),
        }
        if clipped:
            metric["priceMinJpy"] = int(round(percentile(sorted(clipped), 0.1)))
            metric["priceMaxJpy"] = int(round(percentile(sorted(clipped), 0.9)))
        if bucket == "damaged_or_junk":
            metric["note"] = DAMAGED_NOTE
        return metric

    def series_points(items: list[dict], days: int | None, bucket_days: int) -> list[dict]:
        scoped = items if days is None else window_items(items, days)
        buckets: dict[str, list[dict]] = {}
        for item in scoped:
            dt = datetime.fromtimestamp(item["ts"], timezone.utc)
            if bucket_days == 1:
                start = dt.date()
            else:
                start = (dt - timedelta(days=dt.weekday())).date()
            buckets.setdefault(start.isoformat(), []).append(item)
        points = []
        for date_key in sorted(buckets):
            group = buckets[date_key]
            point = {
                "date": date_key,
                "medianJpy": median_int([i["price"] for i in group]),
                "volume": len(group),
                "byGrade": {
                    "sealed": (lambda v: int(round(percentile(sorted(v), 0.5))) if v else None)(
                        [i["price"] for i in group if i["grade"] == "new_sealed"]),
                    "cib": (lambda v: int(round(percentile(sorted(v), 0.5))) if v else None)(
                        [i["price"] for i in group if i["grade"] == "like_new"]),
                    "loose": (lambda v: int(round(percentile(sorted(v), 0.5))) if v else None)(
                        [i["price"] for i in group if i["grade"] == "used"]),
                },
            }
            points.append(point)
        return points

    used_slugs: set[str] = set()
    models = []
    total_sales = 0
    for row in catalog_rows:
        (product_id, canonical_key, canonical_name, normalized_name, release_year,
         franchise_key, franchise_name_en, s_key, s_name_en, toy_type, manufacturer) = row
        items = items_by_product.get(product_id, [])
        items90 = window_items(items, 90)
        if not items90:
            continue  # spec: only models with verified sales in the 90d window
        total_sales += len(items90)
        items30 = window_items(items, 30)
        items_prior = [i for i in items if now_ts - 60 * 86400 <= i["ts"] < now_ts - 30 * 86400]

        prices30 = iqr_clip([i["price"] for i in items30])
        prices90 = iqr_clip([i["price"] for i in items90])
        chosen = prices30 if prices30 else prices90
        median_jpy = int(round(percentile(sorted(chosen), 0.5)))
        range_min = int(round(percentile(sorted(chosen), 0.1)))
        range_max = int(round(percentile(sorted(chosen), 0.9)))

        trend = 0.0
        if prices30 and items_prior:
            prior_median = percentile(sorted([i["price"] for i in items_prior]), 0.5)
            if prior_median > 0:
                trend = round((percentile(sorted(prices30), 0.5) - prior_median) / prior_median * 100, 1)

        sell_hours = [
            (i["seen"] - i["listed"]) / 3600.0
            for i in items90
            if i["listed"] and i["seen"] and i["seen"] > i["listed"]
        ]
        avg_sell_hours = round(sum(sell_hours) / len(sell_hours), 1) if sell_hours else 0

        franchise = franchise_key.lower()
        franchise_display = franchise_name_en or ("Kamen Rider" if franchise == "kamen_rider" else "Ultraman")
        s_slug, _ = series_slug(s_key, franchise_key)
        series_display = s_name_en or franchise_display
        slug = slugify(normalized_name, canonical_key, used_slugs)
        name_clean = clean_product_name(canonical_name or "")
        canonical_slug = f"{franchise.replace('_', '-')}/{s_slug}/{slug}"

        models.append({
            "slug": slug,
            "canonicalSlug": canonical_slug,
            "canonicalNameEn": name_clean,
            "canonicalNameJa": name_clean,
            "romaji": normalized_name or "",
            "aliases": aliases_by_key.get(canonical_key, []),
            "franchise": franchise,
            "franchiseNameEn": franchise_display,
            "series": s_slug,
            "seriesNameEn": series_display,
            "toyType": (toy_type or "dx_belt").lower(),
            "manufacturer": manufacturer or "Bandai",
            "releaseYear": int(release_year) if str(release_year).isdigit() else 0,
            "originalMsrpJpy": 0,
            "metrics": {
                "overall": {
                    "medianPriceJpy": median_jpy,
                    "medianPriceUsd": round(median_jpy / rate, 2),
                    "priceRangeMinJpy": range_min,
                    "priceRangeMaxJpy": range_max,
                    "soldVolume30d": len(items30),
                    "soldVolume90d": len(items90),
                    "priceTrendPct30d": trend,
                    "averageSellHours": avg_sell_hours,
                },
                "byCondition": {key: condition_metric(items30, key) for key in CONDITION_KEYS},
                "marketSpread": {
                    "japanDomesticC2cMedianJpy": median_jpy,
                    "japanShopBuybackFloorJpy": 0,
                    "westernEbayAvgUsd": 0,
                    "arbitrageOpportunityUsd": 0,
                },
            },
            "timeSeries": {
                "days30": series_points(items, 30, 1),
                "days90": series_points(items, 90, 1),
                "year1": series_points(items, 365, 7),
                "all": series_points(items, None, 7),
            },
        })

    models.sort(key=lambda m: (m["franchise"], m["series"], m["canonicalNameEn"]))

    export = {
        "version": "1.0.0",
        "pipelineStatus": "ready",
        "pipelineMessage": (
            f"Live index: {len(models)} models aggregated from {total_sales} verified "
            "sold listings. Updated daily at 03:00 JST."
        ),
        "lastExportAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "exchangeRateUsdJpy": rate,
        "exchangeRateDate": rate_date,
        "platformsTracked": PLATFORMS,
        "models": models,
    }

    out_path = CHECKOUT / "data" / "export.json"
    if not out_path.parent.is_dir():
        raise fail(f"checkout data dir missing: {out_path.parent}")
    out_path.write_text(json.dumps(export, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[tokuprice-export] wrote {out_path} models={len(models)} sales90d={total_sales} rate={rate}")

    def git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(["git", "-C", str(CHECKOUT), *args],
                              capture_output=True, text=True, timeout=300)

    status = git("status", "--porcelain", "--", "data/export.json")
    if status.returncode != 0:
        raise fail(f"git status failed: {status.stderr.strip()[:300]}")
    if status.stdout.strip() == "":
        print("[tokuprice-export] export.json unchanged, nothing to push")
        return 0
    for args in (["add", "data/export.json"],
                 ["commit", "-m", "chore(data): automated daily sold price index export"],
                 ["push", "origin", "main"]):
        proc = git(*args)
        if proc.returncode != 0:
            raise fail(f"git {' '.join(args)} failed: {(proc.stderr or proc.stdout).strip()[:300]}")
    print("[tokuprice-export] pushed to honru09/tokuprice main")
    return 0


if __name__ == "__main__":
    sys.exit(main())
