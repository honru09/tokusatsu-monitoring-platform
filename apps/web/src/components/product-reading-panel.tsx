"use client";
import { useRef, useState } from "react";
import { DetailDisclosure } from "./detail-disclosure";
import { readFetchError } from "../lib/fetch-error";
import styles from "./product-reading-panel.module.css";

type Reading = { summaryZh: string; observedFacts: { field: string; value: string | null; evidence: string }[]; missingFacts: string[] };
const readings = new Map<string, Reading>();

export function ProductReadingPanel({ itemId, version }: { itemId: string; version?: string | null }) {
  const key = `${itemId}:${version ?? ""}`;
  const [reading, setReading] = useState<Reading | null>(() => readings.get(key) ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  async function read() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      const response = await fetch(`/backend/ai/items/${encodeURIComponent(itemId)}/read`, { method: "POST" });
      if (!response.ok) throw new Error(await readFetchError(response, "商品读取暂不可用"));
      const payload = await response.json() as { data: Reading };
      setReading(payload.data); readings.set(key, payload.data);
      if (readings.size > 100) readings.delete(readings.keys().next().value!);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "商品读取暂不可用"); }
    finally { busy.current = false; setPending(false); }
  }
  return <DetailDisclosure title="商品读取" summary={reading ? "已有读取结果" : "按需读取"}>
    <div className={styles.panel} aria-busy={pending}>
      {!reading && <p className={styles.hint}>读取公开文字和前两张图片，保留无法确认的信息。</p>}
      {!reading && <button type="button" disabled={pending} onClick={() => void read()}>{pending ? "正在读取…" : "读取商品"}</button>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {reading && <>
        <p className={styles.summary}>{reading.summaryZh}</p>
        <dl className={styles.facts}>{reading.observedFacts.map((fact, index) => <div key={index}><dt>{fact.field}</dt><dd>{fact.value ?? "待确认"}<small>{fact.evidence}</small></dd></div>)}</dl>
        {!!reading.missingFacts.length && <details><summary>待确认事项</summary><ul>{reading.missingFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul></details>}
        <p className={styles.hint}>读取结果供核对，商品原始信息保持为依据。</p>
      </>}
    </div>
  </DetailDisclosure>;
}
