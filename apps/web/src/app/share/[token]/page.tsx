"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageGallery } from "../../../components/image-gallery";
import { listingTypeLabel, type ListingType } from "../../../lib/listing-type";

type SnapshotItem = {
  id: string;
  titleRaw: string;
  titleZh?: string | null;
  sourceUrl: string;
  source: { key: string; displayName: string };
  priceCurrent: number;
  shippingFee?: number | null;
  quantityEst?: number | null;
  listingType: ListingType;
  auctionEndAt?: string | null;
  note?: string | null;
  images: { url: string; position: number }[];
};

type Snapshot = {
  title: string;
  itemCount: number;
  createdAt: string;
  items: SnapshotItem[];
};

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/backend";
const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;

export default function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [rate, setRate] = useState<number>();
  const [error, setError] = useState("");
  const [language, setLanguage] = useState<"zh" | "original">("zh");

  useEffect(() => {
    let active = true;
    void params.then((resolved) => {
      if (active) setToken(resolved.token);
    });
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (!token) return;
    void Promise.all([
      fetch(`${API}/cart/share/${token}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("分享清单不存在或已失效");
          const data = (await response.json()) as { snapshot: Snapshot };
          setSnapshot(data.snapshot);
        })
        .catch((reason) =>
          setError(
            reason instanceof Error ? reason.message : "读取分享清单失败",
          ),
        ),
      fetch(`${API}/exchange-rate`, { cache: "no-store" })
        .then(async (response) => {
          if (response.ok) setRate(Number((await response.json()).rate));
        })
        .catch(() => undefined),
    ]);
  }, [token]);

  const total = useMemo(
    () =>
      snapshot?.items.reduce(
        (sum, item) => sum + item.priceCurrent + (item.shippingFee ?? 0),
        0,
      ) ?? 0,
    [snapshot],
  );

  return (
    <main className="ios-shell procurement-shell share-workspace min-h-dvh px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="share-editorial-header mb-6 flex items-center gap-3 py-4">
          <img src="/brand-icon.svg" alt="假面采购" className="h-11 w-11" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold">
              {snapshot?.title ?? "假面采购分享"}
            </h1>
            {snapshot && (
              <p className="text-xs text-ink/50">
                {snapshot.itemCount} 件 ·{" "}
                {new Date(snapshot.createdAt).toLocaleString("zh-CN")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() =>
              setLanguage((current) => (current === "zh" ? "original" : "zh"))
            }
            className="grid h-11 min-w-11 place-items-center rounded-full bg-fog px-3 text-xs font-bold"
          >
            {language === "zh" ? "原文" : "中文"}
          </button>
        </header>
        {error ? (
          <div className="ios-surface rounded-3xl p-10 text-center text-sm font-semibold text-rust">
            {error}
          </div>
        ) : !snapshot ? (
          <div className="ios-surface rounded-3xl p-10 text-center text-sm text-ink/50">
            正在读取分享清单…
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {snapshot.items.map((item) => {
                const title =
                  language === "zh"
                    ? (item.titleZh ?? item.titleRaw)
                    : item.titleRaw;
                const remaining = item.auctionEndAt
                  ? Math.max(
                      0,
                      new Date(item.auctionEndAt).getTime() - Date.now(),
                    )
                  : 0;
                return (
                  <article
                    key={item.id}
                    className="share-editorial-item overflow-hidden"
                  >
                    <ImageGallery
                      images={item.images}
                      alt={title}
                      className="aspect-[4/3] bg-ink"
                      imageClassName="object-cover"
                    />
                    <div className="p-3">
                      <h2 className="line-clamp-2 text-sm font-bold leading-5">
                        {title}
                      </h2>
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <div>
                          <b className="font-mono text-lg text-rust">
                            {yen(item.priceCurrent)}
                          </b>
                          <span className="block font-mono text-[10px] text-meta">
                            {rate
                              ? `约 ¥${(item.priceCurrent * rate).toFixed(2)}`
                              : ""}
                          </span>
                        </div>
                        <span className="text-right text-[10px] text-meta">
                          {item.source.displayName}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-meta">
                        <span>
                          {listingTypeLabel(item.listingType)} ·{" "}
                          {item.quantityEst ?? "?"} 件
                        </span>
                        {item.shippingFee === 0 ? (
                          <span>包邮</span>
                        ) : item.shippingFee ? (
                          <span>邮费 {yen(item.shippingFee)}</span>
                        ) : null}
                      </div>
                      {item.listingType === "auction" && item.auctionEndAt && (
                        <div className="mt-2 rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-medium text-ink/70">
                          {remaining > 0
                            ? `剩余 ${Math.floor(remaining / 3_600_000)} 小时`
                            : "已结束"}
                        </div>
                      )}
                      {item.note && (
                        <p className="mt-2 truncate rounded-lg bg-black/5 px-2.5 py-1 text-[11px] text-ink/60">
                          {item.note}
                        </p>
                      )}
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 flex min-h-11 items-center justify-center rounded-full bg-[#0071e3] text-xs font-semibold text-white shadow-sm"
                      >
                        打开 {item.source.displayName}
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="ios-surface mt-4 flex items-center justify-between rounded-2xl p-4">
              <span className="text-sm text-ink/55">已知商品与邮费合计</span>
              <div className="text-right">
                <b className="block font-mono text-lg text-rust">
                  {yen(total)}
                </b>
                <span className="font-mono text-[10px] text-meta">
                  {rate ? `约 ¥${(total * rate).toFixed(2)}` : ""}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
