import { useEffect, useMemo, useState } from "react";
import {
  displayListingTitle,
  type ListingTitleSource,
} from "./listing-title";

export const listingLabels: Record<string, string> = {
  kamen_rider: "假面骑士",
  ultraman: "奥特曼",
  super_sentai: "超级战队",
  godzilla: "哥斯拉",
  other: "其他",
  unknown: "待识别",
  gashapon: "扭蛋",
  shokugan: "食玩",
  figure: "手办",
  sofubi: "软胶",
  finger_puppet: "指人形",
  dx_belt: "DX腰带",
  henshin_item: "变身道具",
  medal: "Medal",
  model: "模型",
  set: "套装",
  standard: "普通 SHF",
  shinkocchou: "真骨雕制法",
  retail: "通贩",
  tamashii_web: "魂限定",
  event: "会场限定",
  first: "初版",
  reissue: "再版",
  japanese: "日版",
  agent: "代理版",
  hong_kong: "港版",
  bandai: "BANDAI",
  bandai_spirits: "BANDAI SPIRITS",
  banpresto: "Banpresto",
  megahouse: "Megahouse",
  plex: "PLEX",
  new_sealed: "全新/未开封",
  like_new: "近新",
  used: "普通二手",
  stained_or_damaged: "污损/瑕疵",
  junk: "JUNK",
  online: "线上",
  physical_store: "线下店",
};

export function itemDisplayTitle(
  item: ListingTitleSource,
  language: "zh" | "original",
  translatedTitle?: string,
) {
  return displayListingTitle(item, language, translatedTitle);
}

export const fmtYen = (value?: number | null) =>
  value == null ? "未知" : `¥${value.toLocaleString("ja-JP")}`;

export const fmtCny = (yen: number | null | undefined, rate?: number) =>
  yen == null || !rate
    ? ""
    : `约 ¥${(yen * rate).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtCnyAmount = (value?: number | null) =>
  value == null || !Number.isFinite(value)
    ? ""
    : `¥${value.toLocaleString("zh-CN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`;

export function shippingLabel(item: {
  shippingFee?: number | null;
  sourceData?: Record<string, unknown> | null;
}) {
  if (item.shippingFee === 0) return "包邮";
  if (item.shippingFee != null) return fmtYen(item.shippingFee);
  const status = item.sourceData?.shippingStatus;
  return status === "calculated" ? "按地区计算" : "平台未提供";
}

export function relativeTime(value?: string | null) {
  if (!value) return "尚无记录";
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export type AuctionTimelineItem = {
  listingType: string;
  auctionEndAt?: string | null;
  detectedAt: string;
  listedAt?: string | null;
};

export function useLiveAuctionTimeline(
  item: AuctionTimelineItem,
  serverOffset: number,
  sharedClock?: number,
) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (
      sharedClock != null ||
      item.listingType !== "auction" ||
      !item.auctionEndAt
    )
      return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [item.auctionEndAt, item.listingType, sharedClock]);
  return useMemo(() => {
    if (item.listingType !== "auction" || !item.auctionEndAt) return null;
    const end = new Date(item.auctionEndAt).getTime();
    const detected = new Date(item.detectedAt).getTime();
    const listed = item.listedAt
      ? new Date(item.listedAt).getTime()
      : Number.NaN;
    const start = Number.isFinite(listed) && listed < end ? listed : detected;
    const now = (sharedClock ?? clock) + serverOffset;
    const remainingMs = end - now;
    const remaining =
      remainingMs <= 0
        ? "已结束"
        : remainingMs >= 86_400_000
          ? `${Math.floor(remainingMs / 86_400_000)}天 ${String(Math.floor((remainingMs % 86_400_000) / 3_600_000)).padStart(2, "0")}:${String(Math.floor((remainingMs % 3_600_000) / 60_000)).padStart(2, "0")}`
          : `${String(Math.floor(remainingMs / 3_600_000)).padStart(2, "0")}:${String(Math.floor((remainingMs % 3_600_000) / 60_000)).padStart(2, "0")}:${String(Math.floor((remainingMs % 60_000) / 1_000)).padStart(2, "0")}`;
    return {
      remaining,
      remainingMs,
      progress: Math.max(
        0,
        Math.min(1, (now - start) / Math.max(60_000, end - start)),
      ),
    };
  }, [clock, item, serverOffset, sharedClock]);
}
