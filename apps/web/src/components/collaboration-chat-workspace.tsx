"use client";
import { YahooDiscount } from "./yahoo-discount";
import { LoadError } from "./load-error";
import { EmptyState } from "./empty-state";
import { SafeItemImage } from "./item-image";
import { useFloatingControl } from "../lib/use-floating-control";

import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "../lib/motion-tokens";
import styles from "./editorial-communications.module.css";
import { readJsonResponse } from "../lib/http-json";
import { getShellOverlayRoot } from "../lib/shell-overlay";
import {
  createVisibilityPoller,
  type VisibilityPoller,
} from "../lib/visibility-poller";
import type { ManagerAccount } from "./manager-account-gate";
import { TERMS } from "../lib/terms";

export type ItemDecisionStatus = "want" | "negotiate" | "pass" | "bought";

export type ItemDecisionInfo = {
  status: ItemDecisionStatus;
  decidedById?: string;
  decidedByName?: string | null;
  decidedAt?: string | null;
};

export type CollaborationItem = {
  id: string;
  titleRaw: string;
  titleZh?: string | null;
  sourceUrl: string;
  priceCurrent: number;
  source: { key: string; displayName: string };
  seller?: { id?: string; name: string } | null;
  images: { url: string; position: number }[];
  product?: { titleZh?: string | null } | null;
  targetPriceYen?: number | null;
  copiedAt?: string | null;
  decision?: ItemDecisionInfo | null;
};

export type ShareRoundItemRow = {
  id: string;
  roundId: string;
  itemId: string;
  targetPriceYen?: number | null;
  copiedAt?: string | null;
  decision?: ItemDecisionInfo | null;
  item: CollaborationItem;
};

export type ShareRound = {
  id: string;
  note?: string | null;
  createdAt: string;
  createdById: string;
  createdBy?: ManagerAccount | null;
  items: ShareRoundItemRow[];
  copiedCount: number;
  total: number;
  targetTotalYen?: number | null;
};

export type PendingCollaborationBundle = {
  items: CollaborationItem[];
  targetPriceYen?: number | null;
  sellerName?: string | null;
};

export function buildBundleNegotiationScript(
  items: CollaborationItem[],
  targetPriceYen?: number | null,
): string {
  if (!items.length) return "";
  if (items.length === 1) {
    const priceText =
      targetPriceYen && targetPriceYen > 0
        ? `${targetPriceYen.toLocaleString("ja-JP")}円にお値下げ可能でしょうか？`
        : "お気持ちお値下げいただくことは可能でしょうか？";
    return `コメント失礼いたします。購入を考えているのですが、こちらの商品は${priceText}即決いたしますので、ご検討よろしくお願いいたします。`;
  }
  const lines = items.map(
    (item) =>
      `・${item.titleRaw.trim()}（¥${item.priceCurrent.toLocaleString("ja-JP")}）`,
  );
  const askLine =
    targetPriceYen && targetPriceYen > 0
      ? `同梱発送で構いませんので、合計${targetPriceYen.toLocaleString("ja-JP")}円でお譲りいただくことは可能でしょうか？`
      : "同梱発送で構いませんので、まとめ割でお気持ちお値引きいただくことは可能でしょうか？";
  return [
    "コメント失礼いたします。",
    `出品されている以下の${items.length}点をまとめて購入希望です。`,
    ...lines,
    askLine,
    "即決いたしますので、ご検討よろしくお願いいたします。",
  ].join("\n");
}

export function buildBundleShareText(
  items: CollaborationItem[],
  perItemTargetYen?:
    | Record<string, number | string | null | undefined>
    | Map<string, number | string | null | undefined>
    | null,
  bundleTargetYen?: number | null,
): string {
  if (!items.length) return "";
  const targetFor = (item: CollaborationItem) => {
    const raw =
      perItemTargetYen instanceof Map
        ? perItemTargetYen.get(item.id)
        : perItemTargetYen?.[item.id];
    const parsed = raw == null || raw === "" ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : item.priceCurrent;
  };
  const blocks = items.map((item) => {
    const lines = [itemTitle(item)];
    const sourceUrl = item.sourceUrl?.trim();
    if (sourceUrl) lines.push(sourceUrl);
    lines.push(`现价 ${yen(item.priceCurrent)}`);
    lines.push(`目标价 ${yen(targetFor(item))}`);
    return lines.join("\n");
  });
  const totalCurrentYen = items.reduce(
    (sum, item) => sum + item.priceCurrent,
    0,
  );
  const totalTargetYen =
    bundleTargetYen && bundleTargetYen > 0
      ? bundleTargetYen
      : items.reduce((sum, item) => sum + targetFor(item), 0);
  return [
    ...blocks,
    `合计现价 ${yen(totalCurrentYen)}\n合计目标价 ${yen(totalTargetYen)}`,
  ].join("\n\n");
}

export type NegotiationScriptGroupResult = {
  sellerId: string | null;
  sellerName: string | null;
  itemIds: string[];
  script: string;
  fallback: boolean;
};

export type NegotiationAnalysisItemResult = {
  id: string;
  titleRaw: string;
  priceCurrent: number;
  shippingFee: number | null;
  sourceUrl: string;
  targetPriceYen: number | null;
  targetMissing: boolean;
};

export type NegotiationAnalysisGroupResult = {
  sellerId: string | null;
  sellerName: string | null;
  itemIds: string[];
  items: NegotiationAnalysisItemResult[];
  targetTotalYen: number;
  listedTotalYen: number;
  script: string;
  fallback: boolean;
  firstItemUrl: string;
};

/**
 * Grouped scripts for an arbitrary multi-selection. One card per
 * seller group, one copy button per card - the copy writes exactly
 * that group's script and nothing else, and the direct link jumps to
 * the group's first item, where the pasted comment covers them all.
 */
export function NegotiationAnalysisPanel({
  groups,
  onCopied,
  onClose,
}: {
  groups: NegotiationAnalysisGroupResult[];
  onCopied?: (itemIds: string[]) => void;
  onClose: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  function copyScript(group: NegotiationAnalysisGroupResult) {
    void navigator.clipboard?.writeText(group.script);
    const key = group.sellerId ?? group.itemIds[0] ?? "group";
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2000);
    onCopied?.(group.itemIds);
  }
  return (
    <section
      className="negotiation-analysis-panel mx-2 mb-2 grid max-h-[62dvh] gap-2 overflow-y-auto rounded-2xl border border-black/[0.08] bg-[#f7f7f9] p-2"
      aria-label="合并砍价分析结果"
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <strong className="text-xs font-bold text-ink">
          按卖家分组 · {groups.length} 份话术
        </strong>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-semibold text-ink/60 transition hover:bg-black/[0.05]"
        >
          关闭
        </button>
      </div>
      {groups.length === 0 ? (
        <EmptyState art="chat" title="所选商品暂时无法生成话术" compact />
      ) : null}
      {groups.map((group) => {
        const key = group.sellerId ?? group.itemIds[0] ?? "group";
        return (
          <article
            key={key}
            className="rounded-xl border border-black/[0.06] bg-white p-3 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-[13px] font-bold text-ink">
                {group.sellerName ?? "卖家未知"}
                <span className="ml-1.5 font-mono text-[11px] font-semibold text-ink/50 tabular-nums">
                  {group.items.length} 件
                </span>
              </strong>
              <span className="font-mono text-xs tabular-nums text-ink/70">
                目标合计{" "}
                <strong className="text-emerald-800">
                  {yen(group.targetTotalYen)}
                </strong>
                {group.fallback ? (
                  <span className="ml-1.5 rounded bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-ink/55">
                    模板
                  </span>
                ) : null}
              </span>
            </div>
            <ul className="mt-2 grid gap-1">
              {group.items.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-baseline justify-between gap-2 text-[11px] leading-snug text-ink/70"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {entry.titleRaw}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {yen(entry.priceCurrent)} →{" "}
                    {entry.targetMissing ? (
                      <span className="font-semibold text-amber-700">
                        未定目标（按现价）
                      </span>
                    ) : (
                      <span className="font-semibold text-emerald-800">
                        {yen(entry.targetPriceYen ?? entry.priceCurrent)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <pre
              lang="ja"
              className="mt-2 whitespace-pre-wrap rounded-xl bg-black/[0.04] p-2.5 font-sans text-xs leading-relaxed text-ink/85"
            >
              {group.script}
            </pre>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => copyScript(group)}
                className="collaboration-product-action is-primary flex-1"
              >
                {copiedKey === key ? "✓ 已复制" : "复制这份话术"}
              </button>
              {/* The API hands back an empty firstItemUrl when the
                  group's first item has no source URL; an anchor with
                  an empty href would just reopen this page, so the
                  link is only rendered when there is somewhere to go.
                  Copying the script above works either way. */}
              {group.firstItemUrl.trim() ? (
                <a
                  href={group.firstItemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="collaboration-product-action is-secondary"
                >
                  去留言 ↗
                </a>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}

/** Round checkbox used by every selectable surface in selection mode. */
export function SelectionToggle({
  selected,
  label,
  onToggle,
}: {
  selected: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="grid h-9 w-9 shrink-0 place-items-center"
    >
      <span
        aria-hidden="true"
        className={`grid h-[22px] w-[22px] place-items-center rounded-full border text-[13px] font-black transition ${
          selected
            ? "border-ink bg-ink text-white"
            : "border-black/30 bg-white text-transparent"
        }`}
      >
        ✓
      </span>
    </button>
  );
}

// Copy accounting is best-effort: it records that a round's texts went out
// so the copied progress moves on its own. It must never break or block a
// copy, so failures are swallowed here and callers fire-and-forget it.
export function markShareRoundItemsCopied(
  apiBaseUrl: string,
  accountId: string | undefined,
  roundId: string,
  itemIds?: string[],
): Promise<void> {
  return fetch(
    `${apiBaseUrl}/collaboration/share-rounds/${encodeURIComponent(roundId)}/mark-copied`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(accountId ? { accountId } : {}),
        ...(itemIds?.length ? { itemIds } : {}),
      }),
    },
  )
    .then(() => undefined)
    .catch(() => undefined);
}

export function NegotiationScriptPanel({
  roundId,
  apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
  onCopied,
}: {
  roundId: string;
  apiBaseUrl?: string;
  onCopied?: (roundId: string, itemIds: string[]) => void;
}) {
  const [groups, setGroups] = useState<NegotiationScriptGroupResult[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/collaboration/share-rounds/${encodeURIComponent(roundId)}/negotiation-script`,
        { method: "POST" },
      );
      const payload = await readJsonResponse<{
        roundId: string;
        groups: NegotiationScriptGroupResult[];
      }>(response, "生成讲价话术失败");
      setGroups(payload.groups);
    } catch {
      setError("生成失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  function copyScript(group: NegotiationScriptGroupResult) {
    void navigator.clipboard?.writeText(group.script);
    const key = group.sellerId ?? group.itemIds[0] ?? "group";
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2000);
    onCopied?.(roundId, group.itemIds);
  }

  return (
    <div className="negotiation-script-panel">
      <button
        type="button"
        className="negotiation-script-generate"
        disabled={busy}
        onClick={() => void generate()}
      >
        {busy ? "生成中…" : "生成讲价话术"}
      </button>
      {error ? <p className="negotiation-script-error">{error}</p> : null}
      {groups?.length === 0 ? (
        <EmptyState art="chat" title="本轮暂无可生成话术的商品" compact />
      ) : null}
      {groups?.map((group) => {
        const key = group.sellerId ?? group.itemIds[0] ?? "group";
        return (
          <div key={key} className="negotiation-script-group">
            <div className="negotiation-script-group-head">
              <strong>{group.sellerName ?? "卖家未知"}</strong>
              <span>{group.itemIds.length} 件</span>
              {group.fallback ? (
                <span className="negotiation-script-fallback-badge">模板</span>
              ) : null}
              <button
                type="button"
                onClick={() => copyScript(group)}
              >
                {copiedKey === key ? "已复制" : "复制"}
              </button>
            </div>
            <pre className="negotiation-script-text">{group.script}</pre>
          </div>
        );
      })}
    </div>
  );
}

type MessageReaction = {
  id: string;
  accountId: string;
  reaction:
    | "heart"
    | "agree"
    | "check"
    | "knife"
    | "like"
    | "negotiation_success"
    | "negotiation_failed";
  account: ManagerAccount;
};

type ConversationSnapshot = {
  messages: DirectMessage[];
  nextAfter: string | null;
};

const CONVERSATION_CACHE_PREFIX = "kamen-chat-conversation-v1";

function conversationCacheKey(apiBaseUrl: string, accountId: string) {
  return `${CONVERSATION_CACHE_PREFIX}:${apiBaseUrl}:${accountId}`;
}

function readConversationSnapshot(key: string): ConversationSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(key) ?? "null",
    ) as Partial<ConversationSnapshot> | null;
    if (
      !parsed ||
      !Array.isArray(parsed.messages) ||
      (parsed.nextAfter !== null && typeof parsed.nextAfter !== "string")
    )
      return null;
    return {
      messages: parsed.messages as DirectMessage[],
      nextAfter: parsed.nextAfter ?? null,
    };
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function writeConversationSnapshot(
  key: string,
  snapshot: ConversationSnapshot,
) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Live collaboration remains available when browser storage is restricted.
  }
}

type DirectMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  text?: string | null;
  itemId?: string | null;
  roundId?: string | null;
  bundleItemTargets?: Record<string, number | null>;
  replyToId?: string | null;
  forwardedFromId?: string | null;
  readAt?: string | null;
  createdAt: string;
  updatedAt: string;
  sender: ManagerAccount;
  recipient: ManagerAccount;
  item?: CollaborationItem | null;
  bundleItems?: CollaborationItem[];
  targetPriceYen?: number | null;
  replyTo?: Pick<DirectMessage, "id" | "text" | "sender" | "item"> | null;
  reactions: MessageReaction[];
  optimistic?: boolean;
};

type MessageListResponse = {
  messages: DirectMessage[];
  nextAfter: string | null;
};

type NegotiationStatus = "in_progress" | "success" | "failed";
type NegotiationCase = {
  id: string;
  status: NegotiationStatus;
  statusChangedAt: string;
  item: CollaborationItem;
  initiatedBy: ManagerAccount;
};

export type NegotiationSellerGroup = {
  key: string;
  sellerName: string;
  listedTotalYen: number;
  targetTotalYen: number | null;
  entries: NegotiationCase[];
};

export type NegotiationRoundGroup = {
  key: string;
  round: ShareRound | null;
  sellerGroups: NegotiationSellerGroup[];
  entries: NegotiationCase[];
};

// Cases are matched to rounds by item membership: a case belongs to the
// newest round that contains its item. Cases in no round stay in the final
// ungrouped bucket so older negotiations keep the flat seller grouping.
export function groupNegotiationsByRound(
  cases: NegotiationCase[],
  rounds: ShareRound[],
): NegotiationRoundGroup[] {
  const roundByItemId = new Map<string, ShareRound>();
  for (const round of rounds) {
    for (const row of round.items ?? []) {
      if (!roundByItemId.has(row.itemId)) roundByItemId.set(row.itemId, round);
    }
  }
  const buckets = new Map<string, NegotiationCase[]>();
  const bucketOrder: string[] = [];
  for (const round of rounds) {
    buckets.set(round.id, []);
    bucketOrder.push(round.id);
  }
  buckets.set("ungrouped", []);
  bucketOrder.push("ungrouped");
  for (const entry of cases) {
    const round = roundByItemId.get(entry.item.id);
    buckets.get(round?.id ?? "ungrouped")?.push(entry);
  }
  const toSellerGroups = (
    entries: NegotiationCase[],
    round: ShareRound | null,
  ): NegotiationSellerGroup[] => {
    const targetByItemId = new Map(
      (round?.items ?? []).map((row) => [row.itemId, row.targetPriceYen]),
    );
    const groups = new Map<string, NegotiationSellerGroup>();
    for (const entry of entries) {
      const key = entry.item.seller?.id ?? `single:${entry.item.id}`;
      const group = groups.get(key) ?? {
        key,
        sellerName: entry.item.seller?.name?.trim() || "未知卖家",
        listedTotalYen: 0,
        targetTotalYen: 0,
        entries: [],
      };
      group.listedTotalYen += entry.item.priceCurrent;
      const target = targetByItemId.get(entry.item.id);
      group.targetTotalYen =
        group.targetTotalYen === null || target == null
          ? null
          : group.targetTotalYen + target;
      group.entries.push(entry);
      groups.set(key, group);
    }
    return [...groups.values()];
  };
  const result: NegotiationRoundGroup[] = [];
  for (const key of bucketOrder) {
    const entries = buckets.get(key) ?? [];
    if (!entries.length) continue;
    const round = key === "ungrouped" ? null : (rounds.find((entry) => entry.id === key) ?? null);
    result.push({
      key,
      round,
      sellerGroups: toSellerGroups(entries, round),
      entries,
    });
  }
  return result;
}

const reactionMeta = {
  knife: { glyph: "🔪", label: "砍价" },
  like: { glyph: "👍", label: "点赞" },
  negotiation_success: { glyph: "✅", label: "砍价成功" },
  negotiation_failed: { glyph: "❌", label: "砍价失败" },
} as const;

function isMessageInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, a, input, textarea, select"))
  );
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 11.5 16-7-6.8 15.2-2.2-6-7-2.2Z" />
      <path d="m11 13.7 9-9.2" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 8-5 4 5 4" />
      <path d="M5 12h8a6 6 0 0 1 6 6" />
    </svg>
  );
}

function ForwardIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m15 8 5 4-5 4" />
      <path d="M19 12h-8a6 6 0 0 0-6 6" />
    </svg>
  );
}

function ProductGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 8.5 12 5l7 3.5v8L12 20l-7-3.5v-8Z" />
      <path d="m5 8.5 7 3.5 7-3.5M12 12v8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ActivityIcon({ kind }: { kind: "share" | "favorite" | "dislike" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "share" ? (
        <>
          <path d="m12.5 5 3 3-3 3" />
          <path d="M15 8H9.5A4.5 4.5 0 0 0 5 12.5V15" />
        </>
      ) : kind === "favorite" ? (
        <path d="M16.2 7.5c0 3.4-6.2 7.2-6.2 7.2S3.8 10.9 3.8 7.5A3.3 3.3 0 0 1 10 5.9a3.3 3.3 0 0 1 6.2 1.6Z" />
      ) : (
        <>
          <path d="M4.2 10s2-3.4 5.8-3.4 5.8 3.4 5.8 3.4-2 3.4-5.8 3.4S4.2 10 4.2 10Z" />
          <path d="m4 4 12 12" />
        </>
      )}
    </svg>
  );
}

function ManagerActivitySummary({ account }: { account: ManagerAccount }) {
  const stats = account.stats ?? { shares: 0, favorites: 0, dislikes: 0 };
  return (
    <article className="collaboration-manager-summary">
      <span className="collaboration-manager-summary-avatar" aria-hidden="true">
        {account.avatarInitial}
        <i className={account.online ? "is-online" : ""} />
      </span>
      <div className="collaboration-manager-summary-body">
        <strong>{account.displayName}</strong>
        <div className="collaboration-manager-stats">
          <span aria-label={`转发 ${stats.shares} 次`} title="转发">
            <ActivityIcon kind="share" />
            <b>{stats.shares}</b>
          </span>
          <span aria-label={`收藏 ${stats.favorites} 次`} title="收藏">
            <ActivityIcon kind="favorite" />
            <b>{stats.favorites}</b>
          </span>
          <span aria-label={`不感兴趣 ${stats.dislikes} 次`} title="不感兴趣">
            <ActivityIcon kind="dislike" />
            <b>{stats.dislikes}</b>
          </span>
        </div>
      </div>
    </article>
  );
}

function itemTitle(item: CollaborationItem) {
  return item.titleZh?.trim() || item.product?.titleZh?.trim() || item.titleRaw;
}

function yen(value: number) {
  return `¥${new Intl.NumberFormat("ja-JP").format(value)}`;
}

function messageTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Decision captions carry the day once a decision is no longer today's,
 * so an older 砍价/不要 does not read as if it was just made. */
function decisionTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const time = messageTime(value);
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  const monthDay = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
  return `${monthDay} ${time}`;
}

function TagIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h7l9 9-7 7-9-9V4Z" />
      <circle cx="8.5" cy="8.5" r="1.4" />
    </svg>
  );
}

function mergeMessages(current: DirectMessage[], incoming: DirectMessage[]) {
  const map = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) map.set(message.id, message);
  return [...map.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  );
}

const decisionOptions: { status: ItemDecisionStatus; label: string }[] = [
  { status: "want", label: TERMS.decisionWant },
  { status: "negotiate", label: TERMS.negotiate },
  { status: "pass", label: TERMS.decisionPass },
];

export function decisionLabel(status: ItemDecisionStatus): string {
  if (status === "want") return TERMS.decisionWant;
  if (status === "negotiate") return TERMS.negotiate;
  if (status === "pass") return TERMS.decisionPass;
  return TERMS.decisionBought;
}

/**
 * The three decision buttons every shared item carries. The current
 * decision is filled and captioned with who decided and when; deciding
 * again overwrites it. "bought" has no button - it is written by the
 * purchase flow and only shows up in the caption.
 */
export function DecisionControls({
  decision,
  onDecide,
}: {
  decision?: ItemDecisionInfo | null;
  onDecide: (status: ItemDecisionStatus) => void;
}) {
  return (
    <div className="collaboration-decision">
      <div
        className="collaboration-decision-buttons"
        role="group"
        aria-label="商品决定"
      >
        {decisionOptions.map((option) => {
          const selected = decision?.status === option.status;
          return (
            <button
              key={option.status}
              type="button"
              aria-pressed={selected}
              data-selected={selected || undefined}
              className="collaboration-decision-button"
              onClick={() => onDecide(option.status)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {decision ? (
        <span className="collaboration-decision-caption">
          {decision.decidedByName ? `${decision.decidedByName} · ` : ""}
          {TERMS.decided}：{decisionLabel(decision.status)}
          {decision.decidedAt ? ` · ${decisionTime(decision.decidedAt)}` : ""}
        </span>
      ) : null}
    </div>
  );
}

function ProductReference({
  item,
  targetPriceYen,
  onOpen,
  onDecide,
  onCopyItem,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: CollaborationItem;
  targetPriceYen?: number | null;
  onOpen: () => void;
  onDecide: (item: CollaborationItem, status: ItemDecisionStatus) => void;
  onCopyItem?: (item: CollaborationItem) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (item: CollaborationItem) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyScript = () => {
    const script = buildBundleNegotiationScript([item], targetPriceYen);
    void navigator.clipboard?.writeText(script);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    onCopyItem?.(item);
  };
  return (
    <div className="collaboration-product-wrapper space-y-1.5">
      <div className="collaboration-product">
        {selectionMode && onToggleSelect ? (
          <SelectionToggle
            selected={selected}
            label={`${selected ? "取消选择" : "选择"}：${itemTitle(item)}`}
            onToggle={() => onToggleSelect(item)}
          />
        ) : null}
        <span className="collaboration-product-image">
          <SafeItemImage
            src={item.images[0]?.url}
            alt={itemTitle(item)}
            className="h-full w-full object-cover"
          />
        </span>
        <span className="collaboration-product-copy">
          <strong>{itemTitle(item)}</strong>
          <span>
            {yen(item.priceCurrent)} · {item.source.displayName}
            {item.seller?.name ? ` · ${item.seller.name}` : ""}
          </span>
          {targetPriceYen && targetPriceYen > 0 ? (
            <span className="inline-block text-xs font-semibold text-emerald-700">
              目标价 {yen(targetPriceYen)}（省{" "}
              {yen(Math.max(0, item.priceCurrent - targetPriceYen))}）
            </span>
          ) : null}
          <YahooDiscount
            sourceKey={item.source.key}
            priceYen={item.priceCurrent}
          />
        </span>
        <button
          type="button"
          className="collaboration-product-open"
          aria-label={`打开商品：${itemTitle(item)}`}
          onClick={
            selectionMode && onToggleSelect
              ? () => onToggleSelect(item)
              : onOpen
          }
        >
          <ChevronRightIcon />
        </button>
      </div>
      <DecisionControls
        decision={item.decision}
        onDecide={(status) => onDecide(item, status)}
      />
      <div className="collaboration-product-actions">
        <button
          type="button"
          onClick={copyScript}
          className="collaboration-product-action is-primary"
        >
          {copied ? "✓ 已复制砍价日语" : "复制砍价日语"}
        </button>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="collaboration-product-action is-secondary"
        >
          直达原商品 ↗
        </a>
      </div>
    </div>
  );
}

function BundleProductReference({
  items,
  targetPriceYen,
  onOpenItem,
  onDecide,
  onCopyItems,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
}: {
  items: CollaborationItem[];
  targetPriceYen?: number | null;
  onOpenItem: (id: string) => void;
  onDecide: (item: CollaborationItem, status: ItemDecisionStatus) => void;
  onCopyItems?: (itemIds: string[]) => void;
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (item: CollaborationItem) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [perItemTargets, setPerItemTargets] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      items.map((entry) => [
        entry.id,
        String(entry.targetPriceYen ?? entry.priceCurrent),
      ]),
    ),
  );
  const [showScript, setShowScript] = useState(false);
  const totalOriginalYen = useMemo(
    () => items.reduce((sum, entry) => sum + entry.priceCurrent, 0),
    [items],
  );
  const effectiveTargetYen =
    targetPriceYen && targetPriceYen > 0 ? targetPriceYen : null;
  const savingsYen = effectiveTargetYen
    ? Math.max(0, totalOriginalYen - effectiveTargetYen)
    : 0;
  const sellerNames = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map((entry) => entry.seller?.name?.trim())
            .filter((name): name is string => Boolean(name)),
        ),
      ),
    [items],
  );
  const script = useMemo(
    () => buildBundleNegotiationScript(items, effectiveTargetYen),
    [effectiveTargetYen, items],
  );
  const copyScript = () => {
    void navigator.clipboard?.writeText(script);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
    onCopyItems?.(items.map((entry) => entry.id));
  };
  const copyShareText = () => {
    void navigator.clipboard?.writeText(
      buildBundleShareText(items, perItemTargets, effectiveTargetYen),
    );
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 2000);
    onCopyItems?.(items.map((entry) => entry.id));
  };
  const openAllLinks = () => {
    for (const entry of items) {
      window.open(entry.sourceUrl, "_blank", "noopener,noreferrer");
    }
  };
  const primaryItem = items[0];
  return (
    <div className="mt-1.5 overflow-hidden rounded-2xl border border-black/[0.08] bg-white/95 p-3 text-ink shadow-sm backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/[0.06] pb-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold tracking-tight text-white">
            集合砍价 · {items.length} 件
          </span>
          <span className="truncate text-xs font-semibold text-ink/70">
            {sellerNames.length === 1
              ? `同店：${sellerNames[0]}`
              : sellerNames.length > 1
                ? `${sellerNames.length} 位卖家组合`
                : primaryItem?.source.displayName ?? "多商品集合"}
          </span>
        </div>
        <div className="text-right font-mono text-xs tabular-nums">
          <span className="text-ink/55">原价合计 </span>
          <strong className="font-bold text-ink">{yen(totalOriginalYen)}</strong>
          {effectiveTargetYen ? (
            <span className="ml-1.5 inline-flex items-center rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800">
              目标 {yen(effectiveTargetYen)}
              {savingsYen > 0 ? ` · 省 ${yen(savingsYen)}` : ""}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 divide-y divide-black/[0.05]">
        {items.map((entry, idx) => (
          <div key={entry.id} className="py-2.5 first:pt-0.5 last:pb-0.5">
            <div className="flex items-center gap-2.5">
            {selectionMode && onToggleSelect ? (
              <SelectionToggle
                selected={selectedIds?.has(entry.id) ?? false}
                label={`${selectedIds?.has(entry.id) ? "取消选择" : "选择"}：${itemTitle(entry)}`}
                onToggle={() => onToggleSelect(entry)}
              />
            ) : null}
            <button
              type="button"
              onClick={() =>
                selectionMode && onToggleSelect
                  ? onToggleSelect(entry)
                  : onOpenItem(entry.id)
              }
              className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-black/5"
              aria-label={`查看 ${itemTitle(entry)}`}
            >
              <SafeItemImage
                src={entry.images[0]?.url}
                alt={itemTitle(entry)}
                className="h-full w-full object-cover"
              />
              <span className="absolute left-0.5 top-0.5 rounded bg-black/65 px-1 text-[9px] font-bold text-white tabular-nums">
                {idx + 1}
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                selectionMode && onToggleSelect
                  ? onToggleSelect(entry)
                  : onOpenItem(entry.id)
              }
              className="min-w-0 flex-1 text-left"
            >
              <strong className="block text-[13px] font-semibold leading-snug text-ink line-clamp-2">
                {itemTitle(entry)}
              </strong>
              <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-ink/60">
                {yen(entry.priceCurrent)} · {entry.source.displayName}
              </span>
            </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2 pl-[54px]">
            <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-ink/55">
              目标价
              <input
                inputMode="numeric"
                aria-label={`目标价：${itemTitle(entry)}`}
                value={perItemTargets[entry.id] ?? String(entry.priceCurrent)}
                onChange={(event) =>
                  setPerItemTargets((current) => ({
                    ...current,
                    [entry.id]: event.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                className="h-9 w-[84px] rounded-lg border border-black/[0.12] bg-white px-2 font-mono text-xs text-ink tabular-nums"
              />
            </label>
            <a
              href={entry.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-black/[0.08] bg-black/[0.03] px-2.5 text-[11px] font-semibold text-ink/80 transition active:scale-[0.97] hover:bg-black/[0.07]"
            >
              直达 ↗
            </a>
            </div>
            <DecisionControls
              decision={entry.decision}
              onDecide={(status) => onDecide(entry, status)}
            />
          </div>
        ))}
      </div>

      {showScript && (
        <pre
          lang="ja"
          className="mt-2.5 whitespace-pre-wrap rounded-xl bg-black/[0.04] p-2.5 font-sans text-xs leading-relaxed text-ink/85"
        >
          {script}
        </pre>
      )}

      <div className="collaboration-bundle-actions mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-black/[0.06] pt-2.5">
        <button
          type="button"
          onClick={copyScript}
          className="collaboration-product-action is-primary flex-1"
        >
          {copied ? "✓ 已复制合并砍价日语" : "一键复制合并砍价日语"}
        </button>
        <button
          type="button"
          onClick={copyShareText}
          className="collaboration-product-action is-secondary"
        >
          {shareCopied ? "✓ 已复制链接+目标价" : "复制链接+目标价"}
        </button>
        {primaryItem && (
          <a
            href={primaryItem.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="collaboration-product-action is-secondary"
          >
            去第 1 件留言 ↗
          </a>
        )}
        <button
          type="button"
          onClick={() => setShowScript((prev) => !prev)}
          className="collaboration-product-action is-tertiary"
        >
          {showScript ? "收起日语" : "预览日语"}
        </button>
        <button
          type="button"
          onClick={openAllLinks}
          className="collaboration-product-action is-tertiary"
        >
          全开 ({items.length})
        </button>
      </div>
    </div>
  );
}

function roundTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ShareRoundPanel({
  round,
  onToggleCopied,
  onSaveTarget,
  onDecide,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
}: {
  round: ShareRound;
  onToggleCopied: (roundId: string, itemId: string, copied: boolean) => void;
  onSaveTarget: (roundId: string, itemId: string, value: number | null) => void;
  onDecide: (
    round: ShareRound,
    row: ShareRoundItemRow,
    status: ItemDecisionStatus,
  ) => void;
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (roundId: string, item: CollaborationItem) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <article className="rounded-2xl border border-black/[0.08] bg-white/95 p-3 text-ink shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-xs font-bold text-ink">
          {roundTime(round.createdAt)}
          {round.createdBy?.displayName
            ? ` · ${round.createdBy.displayName}`
            : ""}
        </strong>
        <span className="font-mono text-[11px] text-ink/55 tabular-nums">
          已复制 {round.copiedCount}/{round.total}
        </span>
      </div>
      {round.note ? (
        <p className="mt-1 truncate text-[11px] text-ink/60">{round.note}</p>
      ) : null}
      <div className="mt-2 divide-y divide-black/[0.05]">
        {(round.items ?? []).map((row) => {
          const copied = Boolean(row.copiedAt);
          const draft =
            drafts[row.itemId] ??
            (row.targetPriceYen ? String(row.targetPriceYen) : "");
          return (
            <div key={row.id} className="py-1.5">
              <div className="flex items-center gap-2">
              {selectionMode && onToggleSelect ? (
                <SelectionToggle
                  selected={selectedIds?.has(row.itemId) ?? false}
                  label={`${selectedIds?.has(row.itemId) ? "取消选择" : "选择"}：${itemTitle(row.item)}`}
                  onToggle={() => onToggleSelect(round.id, row.item)}
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                {itemTitle(row.item)}
                <span className="ml-1.5 font-mono text-[11px] text-ink/55 tabular-nums">
                  {yen(row.item.priceCurrent)}
                </span>
              </span>
              <label className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink/55">
                目标
                <input
                  inputMode="numeric"
                  aria-label={`轮次目标价：${itemTitle(row.item)}`}
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [row.itemId]: event.target.value.replace(/[^\d]/g, ""),
                    }))
                  }
                  onBlur={() => {
                    const parsed = draft.trim() ? Number(draft.trim()) : null;
                    const value =
                      parsed !== null &&
                      Number.isFinite(parsed) &&
                      parsed > 0
                        ? Math.round(parsed)
                        : null;
                    if (value !== (row.targetPriceYen ?? null))
                      onSaveTarget(round.id, row.itemId, value);
                  }}
                  placeholder="目标价"
                  className="h-7 w-[68px] rounded-lg border border-black/[0.12] bg-white px-1.5 font-mono text-[11px] text-ink tabular-nums"
                />
              </label>
              <button
                type="button"
                aria-pressed={copied}
                aria-label={`${copied ? "取消已复制" : "标记已复制"}：${itemTitle(row.item)}`}
                onClick={() =>
                  onToggleCopied(round.id, row.itemId, !copied)
                }
                className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold transition active:scale-[0.97] ${
                  copied
                    ? "bg-emerald-500/15 text-emerald-800"
                    : "bg-black/[0.05] text-ink/70 hover:bg-black/[0.09]"
                }`}
              >
                {copied ? "✓ 已复制" : "标记复制"}
              </button>
              </div>
              <div className="share-round-decision-row">
                <DecisionControls
                  decision={row.decision ?? row.item.decision}
                  onDecide={(status) => onDecide(round, row, status)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function CollaborationChatWorkspace({
  apiBaseUrl,
  account,
  accounts,
  pendingItem,
  onPendingItemConsumed,
  pendingBundle = null,
  onPendingBundleConsumed,
  onOpenItem,
  cartCount,
  onCartMigrated,
  onUnreadCleared,
  onActivityChanged,
  active = true,
  shareRoundId = null,
}: {
  apiBaseUrl: string;
  account: ManagerAccount;
  accounts: ManagerAccount[];
  pendingItem: CollaborationItem | null;
  onPendingItemConsumed: () => void;
  pendingBundle?: PendingCollaborationBundle | null;
  onPendingBundleConsumed?: () => void;
  onOpenItem: (id: string) => Promise<boolean>;
  cartCount: number;
  onCartMigrated: () => void;
  onUnreadCleared: () => void;
  onActivityChanged: () => void;
  active?: boolean;
  shareRoundId?: string | null;
}) {
  const other = accounts.find((entry) => entry.id !== account.id) ?? null;
  const reduceMotion = useReducedMotion();
  const pointerInputRef = useRef(false);
  const chatCacheKey = conversationCacheKey(apiBaseUrl, account.id);
  const initialSnapshotRef = useRef<ConversationSnapshot | null>(null);
  if (initialSnapshotRef.current === null)
    initialSnapshotRef.current = readConversationSnapshot(chatCacheKey);
  const [messages, setMessages] = useState<DirectMessage[]>(
    () => initialSnapshotRef.current?.messages ?? [],
  );
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [forwardedFrom, setForwardedFrom] = useState<DirectMessage | null>(
    null,
  );
  const [attachedItem, setAttachedItem] = useState<CollaborationItem | null>(
    pendingItem,
  );
  const [attachedBundleItems, setAttachedBundleItems] = useState<
    CollaborationItem[]
  >(() => pendingBundle?.items ?? []);
  const [bundleTargetPrice, setBundleTargetPrice] = useState<string>(() =>
    pendingBundle?.targetPriceYen ? String(pendingBundle.targetPriceYen) : "",
  );
  const [bundleItemTargets, setBundleItemTargets] = useState<
    Record<string, string>
  >({});
  const [bundleShareCopied, setBundleShareCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [loading, setLoading] = useState(
    () => initialSnapshotRef.current === null,
  );
  const [error, setError] = useState("");
  const [reactionError, setReactionError] = useState("");
  const [negotiations, setNegotiations] = useState<NegotiationCase[]>([]);
  const [shareRounds, setShareRounds] = useState<ShareRound[]>([]);
  // Multi-select for the same-seller negotiation analysis: any shared
  // items across messages and rounds, grouped server-side by seller.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<
    Map<string, { itemId: string; roundId: string | null }>
  >(new Map());
  const [analysisGroups, setAnalysisGroups] =
    useState<NegotiationAnalysisGroupResult[] | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const analysisSelectionRef = useRef<
    Map<string, { itemId: string; roundId: string | null }>
  >(new Map());

  const toggleSelectItem = useCallback(
    (itemId: string, roundId?: string | null) => {
      setSelection((current) => {
        const next = new Map(current);
        if (next.has(itemId)) next.delete(itemId);
        else next.set(itemId, { itemId, roundId: roundId ?? null });
        return next;
      });
    },
    [],
  );

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelection(new Map());
    setAnalysisGroups(null);
    setAnalysisError("");
  }, []);

  async function runNegotiationAnalysis() {
    if (analysisBusy || selection.size === 0) return;
    setAnalysisBusy(true);
    setAnalysisError("");
    analysisSelectionRef.current = new Map(selection);
    try {
      const response = await fetch(
        `${apiBaseUrl}/collaboration/negotiation-analysis`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: account.id,
            items: [...selection.values()],
          }),
        },
      );
      const payload = await readJsonResponse<{
        groups: NegotiationAnalysisGroupResult[];
      }>(response, "分析失败");
      setAnalysisGroups(payload.groups ?? []);
    } catch {
      setAnalysisError("分析失败，请稍后重试");
    } finally {
      setAnalysisBusy(false);
    }
  }


  const [negotiationFilter, setNegotiationFilter] =
    useState<NegotiationStatus | null>(null);
  const [negotiationRailOpen, setNegotiationRailOpen] = useState(false);
  const negotiationFloat = useFloatingControl(
    `kamen-negotiation-position:${account.id}`,
    "right",
    () => setNegotiationRailOpen(false),
    52,
  );
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const inputNode = composerInputRef.current;
    if (!inputNode) return;
    inputNode.style.height = "auto";
    inputNode.style.height = `${Math.min(126, Math.max(44, inputNode.scrollHeight))}px`;
  }, [input]);
  const [negotiationBusy, setNegotiationBusy] = useState(false);
  const [activeActionMessageId, setActiveActionMessageId] = useState<
    string | null
  >(null);
  const [quotedMessageId, setQuotedMessageId] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const pollerRef = useRef<VisibilityPoller | null>(null);
  const afterRef = useRef<string | null>(
    initialSnapshotRef.current?.nextAfter ?? null,
  );
  const reactionMutationsRef = useRef(new Set<string>());
  const stickToBottomRef = useRef(true);
  const initialScrollRestoredRef = useRef(false);
  const onUnreadClearedRef = useRef(onUnreadCleared);
  const activeRef = useRef(active);
  activeRef.current = active;
  const chatScrollStorageKey = `kamen-chat-scroll-v1:${account.id}`;

  useEffect(() => {
    onUnreadClearedRef.current = onUnreadCleared;
  }, [onUnreadCleared]);

  useEffect(() => {
    if (!pendingItem) return;
    setAttachedItem(pendingItem);
    setAttachedBundleItems([]);
    setForwardedFrom(null);
  }, [pendingItem]);

  useEffect(() => {
    if (!pendingBundle?.items?.length) return;
    if (pendingBundle.items.length === 1) {
      setAttachedItem(pendingBundle.items[0] ?? null);
      setAttachedBundleItems([]);
      setBundleTargetPrice(
        pendingBundle.targetPriceYen ? String(pendingBundle.targetPriceYen) : "",
      );
    } else {
      setAttachedBundleItems(pendingBundle.items);
      setAttachedItem(null);
      setBundleTargetPrice(
        pendingBundle.targetPriceYen ? String(pendingBundle.targetPriceYen) : "",
      );
    }
    setForwardedFrom(null);
  }, [pendingBundle]);

  useEffect(() => {
    setBundleItemTargets((current) => {
      const next: Record<string, string> = {};
      for (const item of attachedBundleItems)
        next[item.id] = current[item.id] ?? String(item.priceCurrent);
      return next;
    });
  }, [attachedBundleItems]);

  const markRead = useCallback(
    async (incoming: DirectMessage[]) => {
      if (!activeRef.current || document.hidden) return;
      const unreadIds = incoming
        .filter(
          (message) => message.recipientId === account.id && !message.readAt,
        )
        .map((message) => message.id);
      if (!unreadIds.length) return;
      const response = await fetch(
        `${apiBaseUrl}/collaboration/messages/read`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: account.id,
            messageIds: unreadIds,
          }),
        },
      );
      if (response.ok) onUnreadClearedRef.current();
    },
    [account.id, apiBaseUrl],
  );

  const loadNegotiations = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `${apiBaseUrl}/collaboration/negotiations?accountId=${encodeURIComponent(account.id)}`,
        { cache: "no-store", signal },
      );
      const data = await readJsonResponse<{ cases?: NegotiationCase[] }>(
        response,
        "砍价进度同步失败",
      );
      setNegotiations(data.cases ?? []);
    },
    [account.id, apiBaseUrl],
  );

  const loadShareRounds = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `${apiBaseUrl}/collaboration/share-rounds?accountId=${encodeURIComponent(account.id)}`,
        { cache: "no-store", signal },
      );
      const data = await readJsonResponse<{ rounds?: ShareRound[] }>(
        response,
        "分享轮次同步失败",
      );
      setShareRounds(data.rounds ?? []);
    },
    [account.id, apiBaseUrl],
  );

  const patchShareRoundItem = useCallback(
    async (
      roundId: string,
      itemId: string,
      patch: { copied?: boolean; targetPriceYen?: number | null },
    ) => {
      setShareRounds((current) =>
        current.map((round) =>
          round.id !== roundId
            ? round
            : {
                ...round,
                items: round.items.map((row) =>
                  row.itemId !== itemId
                    ? row
                    : {
                        ...row,
                        ...(patch.copied !== undefined
                          ? {
                              copiedAt: patch.copied
                                ? new Date().toISOString()
                                : null,
                            }
                          : {}),
                        ...(patch.targetPriceYen !== undefined
                          ? { targetPriceYen: patch.targetPriceYen }
                          : {}),
                      },
                ),
              },
        ).map((round) => ({
          ...round,
          copiedCount: round.items.filter((row) => row.copiedAt).length,
        })),
      );
      try {
        const response = await fetch(
          `${apiBaseUrl}/collaboration/share-rounds/${encodeURIComponent(roundId)}/items/${encodeURIComponent(itemId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ accountId: account.id, ...patch }),
          },
        );
        await readJsonResponse(response, "分享轮次保存失败");
        await loadShareRounds();
      } catch (reason) {
        setReactionError(
          reason instanceof Error ? reason.message : "分享轮次保存失败",
        );
        await loadShareRounds().catch(() => undefined);
      }
    },
    [account.id, apiBaseUrl, loadShareRounds],
  );

  const applyDecision = useCallback(
    (itemId: string, decision: ItemDecisionInfo) => {
      setMessages((current) =>
        current.map((message) => {
          const patch = (item: CollaborationItem | null | undefined) =>
            item && item.id === itemId ? { ...item, decision } : item;
          const item = patch(message.item);
          const bundleItems = message.bundleItems?.map(
            (entry) => patch(entry) ?? entry,
          );
          const replyItem = patch(message.replyTo?.item);
          if (
            item === message.item &&
            bundleItems === message.bundleItems &&
            replyItem === message.replyTo?.item
          )
            return message;
          return {
            ...message,
            item,
            bundleItems,
            replyTo: message.replyTo
              ? { ...message.replyTo, item: replyItem }
              : message.replyTo,
          };
        }),
      );
      setShareRounds((current) =>
        current.map((round) => {
          if (!round.items.some((row) => row.itemId === itemId)) return round;
          return {
            ...round,
            items: round.items.map((row) =>
              row.itemId === itemId
                ? { ...row, decision, item: { ...row.item, decision } }
                : row,
            ),
          };
        }),
      );
    },
    [],
  );

  async function decide(
    item: CollaborationItem,
    status: ItemDecisionStatus,
    provenance?: { roundId?: string; messageId?: string },
  ) {
    applyDecision(item.id, {
      status,
      decidedById: account.id,
      decidedByName: account.displayName,
      decidedAt: new Date().toISOString(),
    });
    try {
      const response = await fetch(`${apiBaseUrl}/collaboration/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          itemId: item.id,
          status,
          roundId: provenance?.roundId,
          messageId: provenance?.messageId,
        }),
      });
      const saved = await readJsonResponse<{
        status: ItemDecisionStatus;
        decidedById: string;
        decidedByName: string | null;
        decidedAt: string;
      }>(response, "决定保存失败");
      applyDecision(item.id, {
        status: saved.status,
        decidedById: saved.decidedById,
        decidedByName: saved.decidedByName,
        decidedAt: saved.decidedAt,
      });
      if (status === "negotiate")
        void loadNegotiations().catch(() => undefined);
      onActivityChanged();
    } catch (reason) {
      setReactionError(
        reason instanceof Error ? reason.message : "决定保存失败",
      );
      void pollerRef.current?.runNow();
      void loadShareRounds().catch(() => undefined);
    }
  }
  // Copying a round's script or share text counts the copy on its own: the
  // local rows flip optimistically so the 已复制 n/m progress moves at once,
  // and the request itself is fire-and-forget (see markShareRoundItemsCopied).
  const markCopiedInRound = useCallback(
    (roundId: string, itemIds?: string[]) => {
      const ids = itemIds?.length ? [...new Set(itemIds)] : undefined;
      setShareRounds((current) =>
        current.map((round) => {
          if (round.id !== roundId) return round;
          const now = new Date().toISOString();
          const items = round.items.map((row) =>
            row.copiedAt || (ids && !ids.includes(row.itemId))
              ? row
              : { ...row, copiedAt: now },
          );
          return {
            ...round,
            items,
            copiedCount: items.filter((row) => row.copiedAt).length,
          };
        }),
      );
      void markShareRoundItemsCopied(apiBaseUrl, account.id, roundId, ids);
    },
    [account.id, apiBaseUrl],
  );

  // A copied analysis script marks its round items copied, grouped by
  // the round each item was selected from (B4-2 accounting).
  const markAnalysisCopied = useCallback(
    (itemIds: string[]) => {
      const byRound = new Map<string, string[]>();
      for (const itemId of itemIds) {
        const roundId = analysisSelectionRef.current.get(itemId)?.roundId;
        if (!roundId) continue;
        byRound.set(roundId, [...(byRound.get(roundId) ?? []), itemId]);
      }
      for (const [roundId, ids] of byRound) markCopiedInRound(roundId, ids);
    },
    [markCopiedInRound],
  );

  const roundIdForItem = useCallback(
    (itemId: string) =>
      shareRounds.find((round) =>
        (round.items ?? []).some((row) => row.itemId === itemId),
      )?.id ?? null,
    [shareRounds],
  );

  const loadMessages = useCallback(
    async (signal?: AbortSignal) => {
      const query = new URLSearchParams({ accountId: account.id });
      if (afterRef.current) query.set("after", afterRef.current);
      const [response] = await Promise.all([
        fetch(`${apiBaseUrl}/collaboration/messages?${query}`, {
          cache: "no-store",
          signal,
        }),
        loadNegotiations(signal),
        loadShareRounds(signal).catch(() => undefined),
      ]);
      const data = await readJsonResponse<MessageListResponse>(
        response,
        "消息同步失败",
      );
      setMessages((current) => {
        const localById = new Map(
          current.map((message) => [message.id, message]),
        );
        const protectedIncoming = data.messages.map((message) => {
          if (!reactionMutationsRef.current.has(message.id)) return message;
          const local = localById.get(message.id);
          return local ? { ...message, reactions: local.reactions } : message;
        });
        const next = mergeMessages(current, protectedIncoming);
        writeConversationSnapshot(chatCacheKey, {
          messages: next,
          nextAfter: data.nextAfter,
        });
        return next;
      });
      afterRef.current = data.nextAfter;
      setError("");
      setLoading(false);
      void markRead(data.messages).catch(() => undefined);
    },
    [
      account.id,
      apiBaseUrl,
      chatCacheKey,
      loadNegotiations,
      loadShareRounds,
      markRead,
    ],
  );

  useEffect(() => {
    const snapshot = readConversationSnapshot(chatCacheKey);
    setMessages(snapshot?.messages ?? []);
    setLoading(!snapshot);
    setError("");
    setReactionError("");
    afterRef.current = snapshot?.nextAfter ?? null;
    initialScrollRestoredRef.current = false;
  }, [chatCacheKey]);

  useEffect(() => {
    const poller = createVisibilityPoller({
      task: (signal) => loadMessages(signal),
      intervalMs: 1_800,
      maxBackoffMs: 30_000,
      isPaused: () => !active || document.hidden,
      onError: (reason) => {
        setLoading(false);
        setError(reason instanceof Error ? reason.message : "消息同步失败");
      },
    });
    pollerRef.current = poller;
    const onVisibility = () =>
      document.hidden ? poller.pause() : poller.resume();
    poller.start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", poller.resume);
    return () => {
      poller.stop();
      pollerRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", poller.resume);
    };
  }, [active, loadMessages]);

  useEffect(() => {
    if (loading) return;
    writeConversationSnapshot(chatCacheKey, {
      messages,
      nextAfter: afterRef.current,
    });
  }, [chatCacheKey, loading, messages]);

  useEffect(() => {
    if (!activeActionMessageId) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".collaboration-message.is-actions-open")
      )
        return;
      setActiveActionMessageId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveActionMessageId(null);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeActionMessageId]);

  useEffect(() => {
    if (!negotiationFilter && !negotiationRailOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (negotiationFilter) setNegotiationFilter(null);
      else setNegotiationRailOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [negotiationFilter, negotiationRailOpen]);

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed || loading || !active) return;
    if (!initialScrollRestoredRef.current) {
      const stored = Number(
        window.sessionStorage.getItem(chatScrollStorageKey),
      );
      feed.scrollTop =
        Number.isFinite(stored) && stored > 0 ? stored : feed.scrollHeight;
      stickToBottomRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 72;
      initialScrollRestoredRef.current = true;
      return;
    }
    if (stickToBottomRef.current) feed.scrollTop = feed.scrollHeight;
  }, [active, chatScrollStorageKey, loading, messages]);
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (activeRef.current && stickToBottomRef.current) feed.scrollTop = feed.scrollHeight;
    });
    observer.observe(feed);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active) {
      setActiveActionMessageId(null);
      setNegotiationFilter(null);
      setNegotiationRailOpen(false);
    }
  }, [active]);

  useEffect(
    () => () => {
      const feed = feedRef.current;
      if (feed)
        window.sessionStorage.setItem(
          chatScrollStorageKey,
          String(feed.scrollTop),
        );
    },
    [chatScrollStorageKey],
  );

  const grouped = useMemo(() => messages, [messages]);

  function locateReply(id: string) {
    const feed = feedRef.current;
    const target = document.getElementById(`collaboration-message-${id}`);
    if (!feed || !target || !feed.contains(target)) return;
    stickToBottomRef.current = false;
    setQuotedMessageId(id);
    setActiveActionMessageId(null);
    const top = feed.scrollTop + target.getBoundingClientRect().top - feed.getBoundingClientRect().top - 20;
    target.focus({ preventScroll: true });
    feed.scrollTo({ top: Math.max(0, top), behavior: reduceMotion || !pointerInputRef.current ? "instant" : "smooth" });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    const activeItems =
      attachedBundleItems.length > 0
        ? attachedBundleItems
        : attachedItem
          ? [attachedItem]
          : [];
    if ((!text && !activeItems.length) || !other || sendingRef.current) return;
    sendingRef.current = true;
    stickToBottomRef.current = true;
    const parsedTargetPrice = bundleTargetPrice.trim()
      ? Math.round(Number(bundleTargetPrice.trim()))
      : null;
    const validTargetPrice =
      parsedTargetPrice && Number.isFinite(parsedTargetPrice) && parsedTargetPrice > 0
        ? parsedTargetPrice
        : null;
    const primaryItem = activeItems[0] ?? null;
    const itemTargets: Record<string, number> = {};
    for (const entry of activeItems) {
      const raw = bundleItemTargets[entry.id];
      const parsed = raw?.trim() ? Math.round(Number(raw.trim())) : null;
      if (parsed && Number.isFinite(parsed) && parsed > 0)
        itemTargets[entry.id] = parsed;
    }
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: DirectMessage = {
      id: optimisticId,
      senderId: account.id,
      recipientId: other.id,
      text: text || null,
      itemId: primaryItem?.id,
      replyToId: replyTo?.id,
      forwardedFromId: forwardedFrom?.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sender: account,
      recipient: other,
      item: primaryItem,
      bundleItems: activeItems.length > 0 ? activeItems : undefined,
      targetPriceYen: validTargetPrice,
      replyTo: replyTo,
      reactions: [],
      optimistic: true,
    };
    setMessages((current) => [...current, optimistic]);
    setInput("");
    setReplyTo(null);
    setForwardedFrom(null);
    setAttachedItem(null);
    setAttachedBundleItems([]);
    setBundleTargetPrice("");
    onPendingItemConsumed();
    onPendingBundleConsumed?.();
    setSending(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/collaboration/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          senderId: account.id,
          recipientId: other.id,
          text: text || undefined,
          itemId: primaryItem?.id,
          itemIds:
            activeItems.length > 1
              ? activeItems.map((entry) => entry.id)
              : undefined,
          targetPriceYen: validTargetPrice ?? undefined,
          itemTargets:
            Object.keys(itemTargets).length > 0 ? itemTargets : undefined,
          replyToId: optimistic.replyToId,
          forwardedFromId: optimistic.forwardedFromId,
        }),
      });
      const saved = await readJsonResponse<DirectMessage>(
        response,
        "消息发送失败",
      );
      setMessages((current) =>
        mergeMessages(
          current.filter((message) => message.id !== optimisticId),
          [saved],
        ),
      );
      afterRef.current = saved.updatedAt;
      if (optimistic.itemId) onActivityChanged();
      void pollerRef.current?.runNow();
    } catch (reason) {
      setMessages((current) =>
        current.filter((message) => message.id !== optimisticId),
      );
      setInput(text);
      if (activeItems.length > 1) {
        setAttachedBundleItems(activeItems);
      } else {
        setAttachedItem(primaryItem);
      }
      if (validTargetPrice) setBundleTargetPrice(String(validTargetPrice));
      setReplyTo(replyTo);
      setForwardedFrom(forwardedFrom);
      setError(reason instanceof Error ? reason.message : "消息发送失败");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function toggleReaction(
    message: DirectMessage,
    reaction: keyof typeof reactionMeta,
  ) {
    const present = message.reactions.some(
      (entry) => entry.accountId === account.id && entry.reaction === reaction,
    );
    const optimisticId = `optimistic-reaction-${message.id}-${reaction}`;
    const previousReaction = message.reactions.find(
      (entry) => entry.accountId === account.id && entry.reaction === reaction,
    );
    reactionMutationsRef.current.add(message.id);
    setMessages((current) =>
      current.map((entry) =>
        entry.id !== message.id
          ? entry
          : {
              ...entry,
              reactions: present
                ? entry.reactions.filter(
                    (candidate) =>
                      candidate.accountId !== account.id ||
                      candidate.reaction !== reaction,
                  )
                : [
                    ...entry.reactions,
                    {
                      id: optimisticId,
                      accountId: account.id,
                      reaction,
                      account,
                    },
                  ],
            },
      ),
    );
    setActiveActionMessageId(null);
    setReactionError("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/collaboration/messages/${message.id}/reactions`,
        {
          method: present ? "DELETE" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: account.id, reaction }),
        },
      );
      const saved = await readJsonResponse<Partial<MessageReaction>>(
        response,
        "互动保存失败",
      );
      if (!present && saved.id) {
        setMessages((current) =>
          current.map((entry) =>
            entry.id !== message.id
              ? entry
              : {
                  ...entry,
                  reactions: entry.reactions.map((candidate) =>
                    candidate.id === optimisticId
                      ? { ...candidate, id: saved.id! }
                      : candidate,
                  ),
                },
          ),
        );
      }
    } catch (reason) {
      setMessages((current) =>
        current.map((entry) => {
          if (entry.id !== message.id) return entry;
          const withoutMutation = entry.reactions.filter(
            (candidate) =>
              !(
                candidate.accountId === account.id &&
                candidate.reaction === reaction
              ),
          );
          return {
            ...entry,
            reactions:
              present && previousReaction
                ? [...withoutMutation, previousReaction]
                : withoutMutation,
          };
        }),
      );
      setReactionError(
        reason instanceof Error ? reason.message : "互动保存失败",
      );
    } finally {
      reactionMutationsRef.current.delete(message.id);
    }
  }

  async function startCartNegotiations() {
    if (!cartCount || negotiationBusy) return;
    setNegotiationBusy(true);
    setReactionError("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/collaboration/negotiations/from-cart`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: account.id }),
        },
      );
      await readJsonResponse(response, "购物车迁移失败");
      onCartMigrated();
      setNegotiationFilter("in_progress");
      await Promise.all([loadNegotiations(), pollerRef.current?.runNow()]);
    } catch (reason) {
      setReactionError(
        reason instanceof Error ? reason.message : "购物车迁移失败",
      );
    } finally {
      setNegotiationBusy(false);
    }
  }

  async function setNegotiationStatus(
    entry: NegotiationCase,
    status: NegotiationStatus,
  ) {
    if (negotiationBusy) return;
    setNegotiationBusy(true);
    setNegotiations((current) =>
      current.map((candidate) =>
        candidate.id === entry.id ? { ...candidate, status } : candidate,
      ),
    );
    try {
      const response = await fetch(
        `${apiBaseUrl}/collaboration/negotiations/${entry.id}/status`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: account.id, status }),
        },
      );
      await readJsonResponse(response, "砍价状态保存失败");
      await Promise.all([loadNegotiations(), pollerRef.current?.runNow()]);
    } catch (reason) {
      setReactionError(
        reason instanceof Error ? reason.message : "砍价状态保存失败",
      );
      await loadNegotiations().catch(() => undefined);
    } finally {
      setNegotiationBusy(false);
    }
  }

  async function clearFailedNegotiations() {
    if (negotiationBusy) return;
    setNegotiationBusy(true);
    setReactionError("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/collaboration/negotiations/failed/dislike`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: account.id }),
        },
      );
      await readJsonResponse(response, "迁移失败");
      await loadNegotiations();
      onActivityChanged();
      setNegotiationFilter(null);
    } catch (reason) {
      setReactionError(reason instanceof Error ? reason.message : "迁移失败");
    } finally {
      setNegotiationBusy(false);
    }
  }

  const negotiationCounts = {
    in_progress: negotiations.filter((entry) => entry.status === "in_progress")
      .length,
    success: negotiations.filter((entry) => entry.status === "success").length,
    failed: negotiations.filter((entry) => entry.status === "failed").length,
  };
  const visibleNegotiations = negotiationFilter
    ? negotiations.filter((entry) => entry.status === negotiationFilter)
    : [];
  // Primary grouping is the share round; inside a round, cases group by
  // seller with listed and target subtotals. Ungrouped cases keep the flat
  // seller grouping under the final history bucket.
  const visibleRoundGroups = groupNegotiationsByRound(
    visibleNegotiations,
    shareRounds,
  );
  // The script panel acts on one round: an explicit prop wins, otherwise
  // the newest round that has cases in this dialog, otherwise the newest
  // round overall.
  const negotiationScriptRoundId =
    shareRoundId ??
    visibleRoundGroups.find((group) => group.round)?.round?.id ??
    shareRounds[0]?.id ??
    null;

  const copyAttachedBundleShareText = () => {
    const parsed = bundleTargetPrice.trim()
      ? Math.round(Number(bundleTargetPrice.trim()))
      : null;
    void navigator.clipboard?.writeText(
      buildBundleShareText(
        attachedBundleItems,
        bundleItemTargets,
        parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      ),
    );
    setBundleShareCopied(true);
    window.setTimeout(() => setBundleShareCopied(false), 2000);
    // The composer bundle normally has no round yet (a round is created on
    // send), so there is nothing to account. When the bundle was forwarded
    // in from a round message, that round is the copy's home.
    if (forwardedFrom?.roundId)
      markCopiedInRound(
        forwardedFrom.roundId,
        attachedBundleItems.map((entry) => entry.id),
      );
  };

  return (
    <section className={`collaboration-chat ${styles.chat}`} aria-label="管理者协作消息" onPointerDownCapture={() => { pointerInputRef.current = true; }} onKeyDownCapture={() => { pointerInputRef.current = false; }}>
      <header className="collaboration-heading">
        <div className="min-w-0 flex-1">
          <h2>{other ? `与${other.displayName}的对话` : "管理者对话"}</h2>
          <p>{other?.online ? "对方在线" : "商品与采购，在这里一起确认"}</p>
        </div>
        <button
          type="button"
          className="collaboration-account-button"
          aria-pressed={selectionMode}
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else setSelectionMode(true);
          }}
        >
          <span>{selectionMode ? "完成" : "选择"}</span>
        </button>
        <span
          className="collaboration-account-button"
          aria-label={`当前账号：${account.displayName}`}
        >
          <small>{account.displayName}</small>
        </span>
      </header>

      <details className={styles.activityDetails}>
        <summary>协作数据<span>分享 · 收藏 · 不感兴趣</span></summary>
        <section className="collaboration-activity-strip" aria-label="管理者协作数据">
        {accounts.map((entry) => (
          <ManagerActivitySummary key={entry.id} account={entry} />
        ))}
        </section>
      </details>

      <details className={styles.activityDetails}>
        <summary>分享轮次<span>逐件目标价 · 复制进度</span></summary>
        <section className="grid gap-2 p-2" aria-label="分享轮次">
          {shareRounds.length ? (
            shareRounds.map((round) => (
              <ShareRoundPanel
                key={round.id}
                round={round}
                selectionMode={selectionMode}
                selectedIds={new Set(selection.keys())}
                onToggleSelect={(roundId, item) =>
                  toggleSelectItem(item.id, roundId)
                }
                onToggleCopied={(roundId, itemId, copied) =>
                  void patchShareRoundItem(roundId, itemId, { copied })
                }
                onSaveTarget={(roundId, itemId, value) =>
                  void patchShareRoundItem(roundId, itemId, {
                    targetPriceYen: value,
                  })
                }
                onDecide={(decidedRound, row, status) =>
                  void decide(row.item, status, { roundId: decidedRound.id })
                }
              />
            ))
          ) : (
            <EmptyState art="chat" title="暂无分享轮次" compact />
          )}
        </section>
      </details>

      {active &&
        typeof document !== "undefined" &&
        createPortal(
          <aside
            ref={negotiationFloat.rootRef}
            style={negotiationFloat.style}
            data-edge={negotiationFloat.edge}
            data-rail-direction={negotiationFloat.down ? "down" : "up"}
            className={`collaboration-negotiation-float floating-control ${negotiationRailOpen ? "is-open" : ""} ${negotiationFloat.dragging ? "is-dragging" : ""}`}
            aria-label="砍价进度"
          >
            <button
              type="button"
              className={`negotiation-float-button ${negotiationCounts.in_progress ? "has-active" : ""}`}
              aria-expanded={negotiationRailOpen}
              aria-controls="negotiation-status-rail"
              aria-label="砍价进度"
              {...negotiationFloat.handlers}
              onClick={() => {
                if (negotiationFloat.allowClick())
                  setNegotiationRailOpen((open) => !open);
              }}
            >
              <TagIcon />
              {negotiationCounts.in_progress > 0 && (
                <small>{negotiationCounts.in_progress}</small>
              )}
            </button>
            <div
              id="negotiation-status-rail"
              className="negotiation-status-rail"
              aria-hidden={!negotiationRailOpen}
              inert={!negotiationRailOpen}
            >
              {cartCount > 0 && (
                <button
                  type="button"
                  disabled={negotiationBusy}
                  onClick={() => void startCartNegotiations()}
                  aria-label={`将购物车的 ${cartCount} 件商品移入砍价`}
                >
                  <span>加入</span>
                  <strong>{cartCount}</strong>
                </button>
              )}
              {(["in_progress", "success", "failed"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    setNegotiationFilter(status);
                    setNegotiationRailOpen(false);
                  }}
                >
                  <span>
                    {status === "in_progress"
                      ? "进行中"
                      : status === "success"
                        ? "成功"
                        : "失败"}
                  </span>
                  <strong>{negotiationCounts[status]}</strong>
                </button>
              ))}
            </div>
          </aside>,
          document.getElementById("floating-controls-root") ?? document.body,
        )}

      <div
        ref={feedRef}
        className="collaboration-feed"
        role="log"
        aria-live="polite"
        onScroll={(event) => {
          const node = event.currentTarget;
          stickToBottomRef.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 72;
          window.sessionStorage.setItem(
            chatScrollStorageKey,
            String(node.scrollTop),
          );
        }}
      >
        {loading && !grouped.length ? (
          <div className="collaboration-empty" role="status">
            <span className="collaboration-loader" />
            正在同步对话
          </div>
        ) : !grouped.length ? (
          <div className="collaboration-empty">
            <div className="collaboration-empty-mark">
              <ProductGlyph />
            </div>
            <strong>从第一件商品开始讨论</strong>
            <p>商品卡可直接发送到这里，也可以先发一条消息。</p>
          </div>
        ) : (
          grouped.map((message) => {
            const own = message.senderId === account.id;
            const actionsOpen = activeActionMessageId === message.id;
            return (
              <motion.article
                key={message.id}
                id={`collaboration-message-${message.id}`}
                data-quoted={quotedMessageId === message.id}
                data-apple-motion-owned="true"
                className={`collaboration-message ${own ? "is-own" : "is-peer"} ${message.optimistic ? "is-sending" : ""} ${actionsOpen ? "is-actions-open" : ""}`}
                data-actions-open={actionsOpen}
                aria-label="打开消息操作"
                aria-expanded={actionsOpen}
                aria-controls={
                  actionsOpen ? `message-actions-${message.id}` : undefined
                }
                tabIndex={0}
                initial={message.optimistic && !reduceMotion && pointerInputRef.current ? { opacity: 0 } : false}
                animate={{ opacity: message.optimistic ? 0.62 : 1 }}
                transition={reduceMotion || !pointerInputRef.current ? { duration: 0 } : springs.appleSpatial}
                onClick={(event) => {
                  if (isMessageInteractiveTarget(event.target)) return;
                  setActiveActionMessageId((current) =>
                    current === message.id ? null : message.id,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  if (isMessageInteractiveTarget(event.target)) return;
                  event.preventDefault();
                  setActiveActionMessageId((current) =>
                    current === message.id ? null : message.id,
                  );
                }}
                onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setQuotedMessageId(current => current === message.id ? null : current); }}
              >
                <div className="collaboration-message-stack">
                  {message.replyTo && (
                    <div className="collaboration-reply-decision">
                      <button
                        type="button"
                        className="collaboration-reply-quote"
                        disabled={!message.replyTo.item && !messages.some(entry => entry.id === message.replyTo!.id)}
                        aria-label={message.replyTo.item ? `打开引用商品：${itemTitle(message.replyTo.item)}` : `定位 ${message.replyTo.sender.displayName} 的原消息`}
                        onClick={() => { if (message.replyTo?.item) void onOpenItem(message.replyTo.item.id); else if (message.replyTo) locateReply(message.replyTo.id); }}
                      >
                        <strong>{message.replyTo.sender.displayName}</strong>
                        <span>
                          {message.replyTo.item
                            ? itemTitle(message.replyTo.item)
                            : message.replyTo.text}
                        </span>
                      </button>
                      {message.replyTo.item && (
                        <DecisionControls
                          decision={message.replyTo.item.decision}
                          onDecide={(status) =>
                            void decide(message.replyTo!.item!, status, {
                              messageId: message.replyTo!.id,
                            })
                          }
                        />
                      )}
                    </div>
                  )}
                  {message.forwardedFromId && (
                    <span className="collaboration-forward-label">
                      <ForwardIcon /> 已转发商品
                    </span>
                  )}
                  <div className="collaboration-bubble">
                    {message.text && <p>{message.text}</p>}
                    {message.bundleItems && message.bundleItems.length > 1 ? (
                      <BundleProductReference
                        items={message.bundleItems}
                        targetPriceYen={message.targetPriceYen}
                        selectionMode={selectionMode}
                        selectedIds={new Set(selection.keys())}
                        onToggleSelect={(item) =>
                          toggleSelectItem(
                            item.id,
                            message.roundId ?? roundIdForItem(item.id),
                          )
                        }
                        onOpenItem={(id) => void onOpenItem(id)}
                        onDecide={(item, status) =>
                          void decide(item, status, {
                            messageId: message.id,
                            roundId: message.roundId ?? undefined,
                          })
                        }
                        onCopyItems={(itemIds) => {
                          if (message.roundId)
                            markCopiedInRound(message.roundId, itemIds);
                        }}
                      />
                    ) : message.item ? (
                      <ProductReference
                        item={message.item}
                        targetPriceYen={message.targetPriceYen}
                        selectionMode={selectionMode}
                        selected={selection.has(message.item.id)}
                        onToggleSelect={(item) =>
                          toggleSelectItem(
                            item.id,
                            message.roundId ?? roundIdForItem(item.id),
                          )
                        }
                        onOpen={() => void onOpenItem(message.item!.id)}
                        onDecide={(item, status) =>
                          void decide(item, status, {
                            messageId: message.id,
                            roundId: message.roundId ?? undefined,
                          })
                        }
                        onCopyItem={(item) => {
                          const roundId =
                            message.roundId ?? roundIdForItem(item.id);
                          if (roundId) markCopiedInRound(roundId, [item.id]);
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="collaboration-message-meta">
                    <time dateTime={message.createdAt}>{messageTime(message.createdAt)}</time>
                    {own && (
                      <span>
                        {message.optimistic
                          ? "发送中"
                          : message.readAt
                            ? "已读"
                            : "已送达"}
                      </span>
                    )}
                  </div>
                  {Object.keys(reactionMeta).some((reaction) =>
                    message.reactions.some(
                      (entry) => entry.reaction === reaction,
                    ),
                  ) && (
                    <div
                      className="collaboration-reaction-summary"
                      aria-label="消息互动"
                    >
                      {(
                        Object.keys(reactionMeta) as Array<
                          keyof typeof reactionMeta
                        >
                      ).map((reaction) => {
                        const count = message.reactions.filter(
                          (entry) => entry.reaction === reaction,
                        ).length;
                        if (!count) return null;
                        return (
                          <span key={reaction}>
                            {reactionMeta[reaction].glyph}
                            {count > 1 ? <small>{count}</small> : null}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {actionsOpen && (
                    <motion.div
                      id={`message-actions-${message.id}`}
                      className="collaboration-message-actions"
                      role="toolbar"
                      aria-label="消息操作"
                      data-apple-motion-owned="true"
                      initial={reduceMotion || !pointerInputRef.current ? false : { opacity: 0, transform: "translateY(8px) scale(.94)" }}
                      animate={{ opacity: 1, transform: reduceMotion || !pointerInputRef.current ? "none" : "translateY(0px) scale(1)" }}
                      transition={reduceMotion || !pointerInputRef.current ? { duration: 0 } : springs.appleSpatial}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setReplyTo(message);
                          setActiveActionMessageId(null);
                          composerInputRef.current?.focus({ preventScroll: true });
                        }}
                        aria-label="回复消息"
                        title="回复"
                      >
                        <ReplyIcon />
                      </button>
                      {message.item && (
                        <button
                          type="button"
                          onClick={() => {
                            if (message.bundleItems && message.bundleItems.length > 1) {
                              setAttachedBundleItems(message.bundleItems);
                              setAttachedItem(null);
                              setBundleTargetPrice(
                                message.targetPriceYen ? String(message.targetPriceYen) : "",
                              );
                            } else {
                              setAttachedItem(message.item!);
                              setAttachedBundleItems([]);
                            }
                            setForwardedFrom(message);
                            setActiveActionMessageId(null);
                            composerInputRef.current?.focus({ preventScroll: true });
                          }}
                          aria-label="转发商品"
                          title="转发商品"
                        >
                          <ForwardIcon />
                        </button>
                      )}
                      {(
                        Object.keys(reactionMeta) as Array<
                          keyof typeof reactionMeta
                        >
                      ).map((reaction) => {
                        const count = message.reactions.filter(
                          (entry) => entry.reaction === reaction,
                        ).length;
                        const active = message.reactions.some(
                          (entry) =>
                            entry.reaction === reaction &&
                            entry.accountId === account.id,
                        );
                        return (
                          <button
                            key={reaction}
                            type="button"
                            aria-pressed={active}
                            aria-label={reactionMeta[reaction].label}
                            title={reactionMeta[reaction].label}
                            onClick={() =>
                              void toggleReaction(message, reaction)
                            }
                          >
                            {reactionMeta[reaction].glyph}
                            {count ? <span>{count}</span> : null}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </div>
              </motion.article>
            );
          })
        )}
      </div>

      {analysisGroups && (
        <NegotiationAnalysisPanel
          groups={analysisGroups}
          onCopied={markAnalysisCopied}
          onClose={() => setAnalysisGroups(null)}
        />
      )}
      {selectionMode && (
        <div className="flex items-center gap-2 border-t border-black/[0.06] bg-white/95 px-3 py-2 backdrop-blur">
          <span className="text-xs font-bold text-ink">
            已选 {selection.size} 件
          </span>
          {analysisError ? (
            <span className="text-[11px] font-semibold text-red-700">
              {analysisError}
            </span>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              setSelection(new Map());
              setAnalysisGroups(null);
            }}
            disabled={selection.size === 0}
            className="inline-flex min-h-10 items-center rounded-xl px-3 text-xs font-semibold text-ink/60 transition hover:bg-black/[0.05] disabled:opacity-40"
          >
            清空
          </button>
          <button
            type="button"
            onClick={() => void runNegotiationAnalysis()}
            disabled={selection.size === 0 || analysisBusy}
            className="inline-flex min-h-10 items-center rounded-xl bg-ink px-4 text-xs font-bold text-white transition active:scale-[0.97] disabled:opacity-40"
          >
            {analysisBusy ? "分析中…" : "分析"}
          </button>
        </div>
      )}

      <form className="collaboration-composer" onSubmit={send}>
        {(error || reactionError) && (
          <LoadError
            message={reactionError || error}
            onRetry={error ? () => void loadMessages() : undefined}
            retryTestId="retry-collaboration"
            className="collaboration-error"
            actionClassName={null}
          />
        )}
        {attachedBundleItems.length > 0 && (
          <motion.div
            key="composer-bundle-context"
            className="mb-2.5 rounded-2xl border border-black/[0.08] bg-white/95 p-3 shadow-sm backdrop-blur-md"
            data-apple-motion-owned="true"
            initial={
              reduceMotion || !pointerInputRef.current
                ? false
                : { opacity: 0, transform: "translateY(8px)" }
            }
            animate={{
              opacity: 1,
              transform:
                reduceMotion || !pointerInputRef.current
                  ? "none"
                  : "translateY(0px)",
            }}
            transition={
              reduceMotion || !pointerInputRef.current
                ? { duration: 0 }
                : springs.appleSpatial
            }
          >
            {(() => {
              const totalOriginalYen = attachedBundleItems.reduce(
                (sum, entry) => sum + entry.priceCurrent,
                0,
              );
              const presets = [
                {
                  label: "9折",
                  value: Math.round((totalOriginalYen * 0.9) / 100) * 100,
                },
                {
                  label: "85折",
                  value: Math.round((totalOriginalYen * 0.85) / 100) * 100,
                },
                {
                  label: "8折",
                  value: Math.round((totalOriginalYen * 0.8) / 100) * 100,
                },
              ];
              return (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-white">
                        待发集合 · {attachedBundleItems.length} 件
                      </span>
                      <span className="truncate font-mono text-xs font-semibold text-ink/75 tabular-nums">
                        合计 {yen(totalOriginalYen)}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label="清空集合商品"
                      onClick={() => {
                        setAttachedBundleItems([]);
                        setBundleTargetPrice("");
                        setForwardedFrom(null);
                        onPendingBundleConsumed?.();
                        composerInputRef.current?.focus({ preventScroll: true });
                      }}
                      className="grid h-7 w-7 place-items-center rounded-full bg-black/[0.05] text-ink/60 hover:bg-black/[0.1]"
                    >
                      <CloseIcon />
                    </button>
                  </div>

                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                    {attachedBundleItems.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-black/[0.08] bg-black/[0.02] p-1.5 pr-2"
                      >
                        {entry.images[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={entry.images[0].url}
                            alt=""
                            className="h-8 w-8 rounded-lg object-cover"
                          />
                        ) : null}
                        <div className="max-w-[130px] text-left">
                          <b className="block truncate text-[11px] font-semibold text-ink">
                            {itemTitle(entry)}
                          </b>
                          <span className="block font-mono text-[10px] text-ink/55 tabular-nums">
                            {yen(entry.priceCurrent)}
                          </span>
                        </div>
                        <input
                          inputMode="numeric"
                          aria-label={`目标价：${itemTitle(entry)}`}
                          value={
                            bundleItemTargets[entry.id] ??
                            String(entry.priceCurrent)
                          }
                          onChange={(event) =>
                            setBundleItemTargets((current) => ({
                              ...current,
                              [entry.id]: event.target.value.replace(
                                /[^\d]/g,
                                "",
                              ),
                            }))
                          }
                          placeholder="目标价"
                          className="h-7 w-[68px] shrink-0 rounded-lg border border-black/[0.12] bg-white px-1.5 font-mono text-[11px] text-ink tabular-nums"
                        />
                        <button
                          type="button"
                          aria-label={`移除 ${itemTitle(entry)}`}
                          onClick={() => {
                            const next = attachedBundleItems.filter(
                              (candidate) => candidate.id !== entry.id,
                            );
                            if (next.length === 1) {
                              setAttachedItem(next[0] ?? null);
                              setAttachedBundleItems([]);
                            } else {
                              setAttachedBundleItems(next);
                            }
                          }}
                          className="ml-0.5 text-xs text-ink/45 hover:text-ink"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-ink/55">
                      目标打包价：
                    </span>
                    {presets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setBundleTargetPrice(String(preset.value))
                        }
                        className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition active:scale-[0.97] ${
                          bundleTargetPrice === String(preset.value)
                            ? "bg-ink text-white"
                            : "bg-black/[0.05] text-ink/75 hover:bg-black/[0.09]"
                        }`}
                      >
                        {preset.label} {yen(preset.value)}
                      </button>
                    ))}
                    <input
                      inputMode="numeric"
                      value={bundleTargetPrice}
                      onChange={(event) =>
                        setBundleTargetPrice(
                          event.target.value.replace(/[^\d]/g, ""),
                        )
                      }
                      placeholder="自定义日元"
                      className="h-7 w-28 rounded-lg border border-black/[0.12] bg-white px-2 font-mono text-xs text-ink tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={copyAttachedBundleShareText}
                      className="rounded-lg bg-black/[0.05] px-2 py-1 text-[11px] font-semibold text-ink/75 transition active:scale-[0.97] hover:bg-black/[0.09]"
                    >
                      {bundleShareCopied
                        ? "✓ 已复制链接+目标价"
                        : "复制链接+目标价"}
                    </button>
                  </div>
                </>
              );
            })()}
          </motion.div>
        )}
        {(replyTo || attachedItem) && attachedBundleItems.length === 0 && (
          <motion.div key="composer-context" className="collaboration-composer-context"
            data-apple-motion-owned="true"
            initial={reduceMotion || !pointerInputRef.current ? false : { opacity: 0, transform: "translateY(8px)" }} animate={{ opacity: 1, transform: reduceMotion || !pointerInputRef.current ? "none" : "translateY(0px)" }} transition={reduceMotion || !pointerInputRef.current ? { duration: 0 } : springs.appleSpatial}>
            <span className="collaboration-composer-context-icon">
              {attachedItem ? <ProductGlyph /> : <ReplyIcon />}
            </span>
            <span className="min-w-0 flex-1">
              <small>
                {forwardedFrom
                  ? "转发商品"
                  : attachedItem
                    ? "引用商品"
                    : `回复 ${replyTo?.sender.displayName}`}
              </small>
              <strong>
                {attachedItem ? itemTitle(attachedItem) : replyTo?.text}
              </strong>
            </span>
            {attachedItem && (
              <input
                inputMode="numeric"
                value={bundleTargetPrice}
                onChange={(event) =>
                  setBundleTargetPrice(event.target.value.replace(/[^\d]/g, ""))
                }
                placeholder="目标日元(可选)"
                className="h-8 w-28 shrink-0 rounded-lg border border-black/[0.12] bg-white px-2 font-mono text-xs text-ink tabular-nums"
              />
            )}
            <button
              type="button"
              aria-label="移除引用"
              onClick={() => {
                setReplyTo(null);
                setAttachedItem(null);
                setBundleTargetPrice("");
                setForwardedFrom(null);
                onPendingItemConsumed();
                onPendingBundleConsumed?.();
                composerInputRef.current?.focus({ preventScroll: true });
              }}
            >
              <CloseIcon />
            </button>
          </motion.div>
        )}
        <div className="collaboration-composer-row">
          <textarea
            ref={composerInputRef}
            enterKeyHint="enter"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={1}
            maxLength={1200}
            placeholder={
              attachedBundleItems.length > 0
                ? "补充一句给砍价搭档（可直接点发送）…"
                : attachedItem
                  ? "补充一句…"
                  : `发消息给${other?.displayName ?? "对方"}`
            }
            aria-label="消息内容"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !window.matchMedia("(pointer: coarse)").matches
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            onPointerDown={(event) => {
              if (event.pointerType === "touch") event.preventDefault();
            }}
            disabled={
              sending ||
              (!input.trim() && !attachedItem && !attachedBundleItems.length)
            }
            aria-label="发送消息"
          >
            <SendIcon />
          </button>
        </div>
      </form>

      {active && negotiationFilter && typeof document !== "undefined"
        ? createPortal(
            <div
              className="negotiation-dialog-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget)
                  setNegotiationFilter(null);
              }}
            >
              <section
                className="negotiation-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="negotiation-dialog-title"
              >
                <header>
                  <div>
                    <p>
                      {negotiationFilter === "in_progress"
                        ? "进行中"
                        : negotiationFilter === "success"
                          ? "成功"
                          : "失败"}
                    </p>
                    <h2 id="negotiation-dialog-title">
                      {visibleNegotiations.length} 件商品
                    </h2>
                  </div>
                  <button
                    type="button"
                    autoFocus
                    aria-label="关闭"
                    onClick={() => setNegotiationFilter(null)}
                  >
                    <CloseIcon />
                  </button>
                </header>
                {negotiationFilter === "failed" &&
                  visibleNegotiations.length > 0 && (
                    <button
                      type="button"
                      className="negotiation-clear-failed"
                      disabled={negotiationBusy}
                      onClick={() => void clearFailedNegotiations()}
                    >
                      全部移入不感兴趣
                    </button>
                  )}
                {negotiationScriptRoundId ? (
                  <NegotiationScriptPanel
                    roundId={negotiationScriptRoundId}
                    apiBaseUrl={apiBaseUrl}
                    onCopied={(roundId, itemIds) =>
                      markCopiedInRound(roundId, itemIds)
                    }
                  />
                ) : null}
                <div className="negotiation-dialog-list">
                  {visibleNegotiations.length ? (
                    visibleRoundGroups.map((roundGroup) => (
                      <div key={roundGroup.key} className="grid gap-2">
                        <div className="flex items-center justify-between gap-2 px-1 pt-2">
                          <strong className="truncate text-sm font-bold text-ink">
                            {roundGroup.round
                              ? `分享轮次 · ${roundTime(roundGroup.round.createdAt)}${roundGroup.round.createdBy?.displayName ? ` · ${roundGroup.round.createdBy.displayName}` : ""}`
                              : "历史 / 未分组"}
                          </strong>
                          {roundGroup.round?.note ? (
                            <span className="min-w-0 truncate text-[11px] text-ink/55">
                              {roundGroup.round.note}
                            </span>
                          ) : null}
                        </div>
                        {roundGroup.sellerGroups.map((group) => (
                          <div key={group.key} className="grid gap-2">
                            <div className="flex items-center justify-between gap-2 px-1 pt-1">
                              <strong className="truncate text-xs font-bold text-ink">
                                {group.sellerName}
                              </strong>
                              <span className="shrink-0 font-mono text-[11px] text-ink/55 tabular-nums">
                                {group.entries.length} 件 · 小计{" "}
                                {yen(group.listedTotalYen)}
                                {group.targetTotalYen !== null
                                  ? ` · 目标 ${yen(group.targetTotalYen)}`
                                  : ""}
                              </span>
                            </div>
                            {group.entries.map((entry) => (
                      <article key={entry.id}>
                        <button
                          type="button"
                          className="negotiation-item-main"
                          onClick={() => void onOpenItem(entry.item.id)}
                        >
                          {entry.item.images[0]?.url ? (
                            <img src={entry.item.images[0].url} alt="" />
                          ) : (
                            <span className="negotiation-item-placeholder">
                              <ProductGlyph />
                            </span>
                          )}
                          <span>
                            <strong>{itemTitle(entry.item)}</strong>
                            <small>
                              {yen(entry.item.priceCurrent)} ·{" "}
                              {entry.item.source.displayName}
                            </small>
                            <YahooDiscount
                              sourceKey={entry.item.source.key}
                              priceYen={entry.item.priceCurrent}
                            />
                          </span>
                        </button>
                        <div className="negotiation-item-actions">
                          {entry.status !== "in_progress" && (
                            <button
                              type="button"
                              onClick={() =>
                                void setNegotiationStatus(entry, "in_progress")
                              }
                            >
                              继续
                            </button>
                          )}
                          {entry.status !== "success" && (
                            <button
                              type="button"
                              onClick={() =>
                                void setNegotiationStatus(entry, "success")
                              }
                            >
                              成功
                            </button>
                          )}
                          {entry.status !== "failed" && (
                            <button
                              type="button"
                              onClick={() =>
                                void setNegotiationStatus(entry, "failed")
                              }
                            >
                              失败
                            </button>
                          )}
                        </div>
                      </article>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))
                  ) : (
                    <EmptyState art="tag" title="暂无商品" compact />
                  )}
                </div>
              </section>
            </div>,
            getShellOverlayRoot(),
          )
        : null}
    </section>
  );
}
