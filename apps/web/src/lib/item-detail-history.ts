export const ITEM_DETAIL_HISTORY_STATE_KEY = "__tokusatsuItemDetail";

export function withItemDetailHistoryState(
  historyState: unknown,
  itemId: string,
): Record<string, unknown> {
  const base =
    historyState && typeof historyState === "object"
      ? (historyState as Record<string, unknown>)
      : {};
  return {
    ...base,
    [ITEM_DETAIL_HISTORY_STATE_KEY]: itemId,
  };
}

export function parseItemDetailHistoryState(
  historyState: unknown,
): string | null {
  if (!historyState || typeof historyState !== "object") return null;
  const itemId = (historyState as Record<string, unknown>)[
    ITEM_DETAIL_HISTORY_STATE_KEY
  ];
  return typeof itemId === "string" && itemId.trim() ? itemId : null;
}

export function withoutItemDetailHistoryState(
  historyState: unknown,
): Record<string, unknown> {
  const next =
    historyState && typeof historyState === "object"
      ? { ...(historyState as Record<string, unknown>) }
      : {};
  delete next[ITEM_DETAIL_HISTORY_STATE_KEY];
  return next;
}
