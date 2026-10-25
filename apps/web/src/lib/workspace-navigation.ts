export type Workspace =
  | "inventory"
  | "catalog"
  | "purchases"
  | "intel"
  | "monitoring"
  | "resale"
  | "assistant"
  | "collaboration"
  | "workbench";

/**
 * Workspaces retired as standalone pages: the account page folded into
 * the workbench account section, the AI status page became the settings
 * section, the operations console left the product with the service
 * split, and the 算账 cost tool (plus its calculator/logistics
 * predecessors) was removed outright. Bookmarks and stored recent
 * entries for these ids land on the workbench.
 */
const LEGACY_WORKSPACE_REDIRECTS: Record<string, Workspace> = {
  profile: "workbench",
  ai: "workbench",
  operations: "workbench",
  "cost-tool": "workbench",
  calculator: "workbench",
  logistics: "workbench",
};

export function legacyWorkspaceRedirect(
  value: string | null | undefined,
): Workspace | null {
  if (typeof value !== "string") return null;
  return LEGACY_WORKSPACE_REDIRECTS[value] ?? null;
}

/**
 * Filter views inside the catalog workspace. Favorites, link imports and
 * disliked items used to be standalone workspaces; they are views of the
 * one 选货 grid now, not separate pages.
 */
export type CatalogView = "browse" | "favorites" | "links" | "disliked";

export const CATALOG_VIEWS: readonly CatalogView[] = [
  "browse",
  "favorites",
  "links",
  "disliked",
];

/**
 * Pre-fold workspace ids that may still appear in bookmarks, stored
 * recent-workspace entries or shared links, mapped to the catalog view
 * they became. The seller directory was a pass-through page, so it lands
 * on the plain catalog.
 */
const LEGACY_WORKSPACE_CATALOG_VIEWS: Record<string, CatalogView> = {
  favorites: "favorites",
  links: "links",
  disliked: "disliked",
  sellers: "browse",
};

export function legacyCatalogView(
  value: string | null | undefined,
): CatalogView | null {
  if (typeof value !== "string") return null;
  return LEGACY_WORKSPACE_CATALOG_VIEWS[value] ?? null;
}

/**
 * Tabs inside the purchases workspace. Purchase records and inventory
 * orders used to be standalone workspaces; they are tabs of the one
 * 采购 page now, not separate pages.
 */
export type PurchasesTab = "records" | "orders" | "shipping";

export const PURCHASES_TABS: readonly PurchasesTab[] = [
  "records",
  "orders",
  "shipping",
];

/**
 * Pre-merge workspace id for the inventory tab: `?workspace=orders`
 * bookmarks and shared links land on the purchases workspace with the
 * inventory tab preselected, same treatment as the catalog fold.
 */
export function legacyPurchasesTab(
  value: string | null | undefined,
): PurchasesTab | null {
  return value === "orders" ? "orders" : null;
}

/** Parse the optional `?tab=` companion of `?workspace=purchases`. */
export function parsePurchasesTabParam(
  value: string | null | undefined,
): PurchasesTab | null {
  if (typeof value !== "string") return null;
  return (PURCHASES_TABS as readonly string[]).includes(value)
    ? (value as PurchasesTab)
    : null;
}

/** Parse the optional `?view=` companion of `?workspace=catalog`. */
export function parseCatalogViewParam(
  value: string | null | undefined,
): CatalogView | null {
  if (typeof value !== "string") return null;
  return (CATALOG_VIEWS as readonly string[]).includes(value)
    ? (value as CatalogView)
    : null;
}

/**
 * Sort fields a shared catalog link may carry. These are the two sorts
 * the app itself applies programmatically (urgent auctions, the xianyu
 * comparison view); the plain grid default needs no param at all.
 */
export const CATALOG_SORT_FIELDS: readonly string[] = [
  "auctionEndAt",
  "xianyuPrice",
];

export type CatalogSort = { sortBy: string; sortOrder: "asc" | "desc" };

/** Parse the optional `?sort=<field>:<asc|desc>` catalog companion. */
export function parseCatalogSortParam(
  value: string | null | undefined,
): CatalogSort | null {
  if (typeof value !== "string") return null;
  const [sortBy, sortOrder] = value.split(":");
  if (!CATALOG_SORT_FIELDS.includes(sortBy)) return null;
  return { sortBy, sortOrder: sortOrder === "desc" ? "desc" : "asc" };
}

export type ViewStateSearchParams = {
  workspace: Workspace;
  view?: CatalogView | null;
  tab?: PurchasesTab | null;
  sortBy?: string | null;
  sortOrder?: string | null;
};

/**
 * Fold the in-workspace view state (catalog view + sort, purchases tab)
 * into a URL next to the `workspace` param. Defaults are omitted so the
 * plain URL stays clean, and params belonging to other workspaces are
 * removed, so a copied link always reproduces exactly one view.
 */
export function applyViewStateSearchParams(
  url: URL,
  state: ViewStateSearchParams,
): URL {
  const next = new URL(url.href);
  if (
    state.workspace === "catalog" &&
    state.view &&
    state.view !== "browse"
  ) {
    next.searchParams.set("view", state.view);
  } else {
    next.searchParams.delete("view");
  }
  if (
    state.workspace === "catalog" &&
    state.sortBy &&
    CATALOG_SORT_FIELDS.includes(state.sortBy)
  ) {
    const order = state.sortOrder === "desc" ? "desc" : "asc";
    next.searchParams.set("sort", `${state.sortBy}:${order}`);
  } else {
    next.searchParams.delete("sort");
  }
  if (
    state.workspace === "purchases" &&
    state.tab &&
    state.tab !== "records"
  ) {
    next.searchParams.set("tab", state.tab);
  } else {
    next.searchParams.delete("tab");
  }
  return next;
}

export type WorkspaceNavigationState = {
  workspace: Workspace;
  trail: Workspace[];
};

export type WorkspaceHistoryEntry = WorkspaceNavigationState & {
  depth: number;
  scrollY: number;
};

export type RecentWorkspaceEntry = WorkspaceNavigationState & {
  scrollY: number;
  visitedAt: number;
};

export const WORKSPACE_HISTORY_STATE_KEY = "__tokusatsuWorkspaceNavigation";
export const RECENT_WORKSPACES_STORAGE_KEY =
  "kamen-procurement-recent-workspaces-v1";
export const RECENT_WORKSPACES_LIMIT = 3;

/** Default landing workspace when `?workspace=` is absent. */
export const DEFAULT_WORKSPACE: Workspace = "inventory";

export const ALL_WORKSPACES = [
  "inventory",
  "catalog",
  "purchases",
  "intel",
  "monitoring",
  "resale",
  "assistant",
  "collaboration",
  "workbench",
] as const satisfies readonly Workspace[];

export const PRIMARY_WORKSPACES = new Set<Workspace>([
  "inventory",
  "catalog",
  "collaboration",
  "workbench",
]);

export function isWorkspace(
  value: string | null | undefined,
): value is Workspace {
  return (
    typeof value === "string" &&
    (ALL_WORKSPACES as readonly string[]).includes(value)
  );
}

export function initialWorkspaceNavigationState(
  workspace: Workspace,
): WorkspaceNavigationState {
  return {
    workspace,
    trail: PRIMARY_WORKSPACES.has(workspace) ? [] : ["workbench"],
  };
}

/** Parse `?workspace=` for deep-links; invalid values are ignored. */
export function parseWorkspaceParam(
  value: string | null | undefined,
): Workspace | null {
  return isWorkspace(value) ? value : null;
}

/**
 * Inventory is the default home — omit it from the query so production URLs
 * stay clean. Other workspaces are written as `?workspace=<id>`.
 */
export function workspaceSearchParam(workspace: Workspace): string | null {
  return workspace === DEFAULT_WORKSPACE ? null : workspace;
}

export function applyWorkspaceSearchParam(url: URL, workspace: Workspace): URL {
  const next = new URL(url.href);
  const param = workspaceSearchParam(workspace);
  if (param) next.searchParams.set("workspace", param);
  else next.searchParams.delete("workspace");
  return next;
}

export function navigateWorkspaceState(
  state: WorkspaceNavigationState,
  next: Workspace,
): WorkspaceNavigationState {
  if (state.workspace === next) return state;
  if (PRIMARY_WORKSPACES.has(next)) return { workspace: next, trail: [] };
  return {
    workspace: next,
    trail: [...state.trail, state.workspace],
  };
}

export function goBackWorkspaceState(
  state: WorkspaceNavigationState,
): WorkspaceNavigationState {
  const previous = state.trail.at(-1);
  if (!previous) return state;
  return {
    workspace: previous,
    trail: state.trail.slice(0, -1),
  };
}

export function withWorkspaceHistoryState(
  historyState: unknown,
  entry: WorkspaceHistoryEntry,
): Record<string, unknown> {
  const base =
    historyState && typeof historyState === "object"
      ? (historyState as Record<string, unknown>)
      : {};
  return {
    ...base,
    [WORKSPACE_HISTORY_STATE_KEY]: entry,
  };
}

export function parseWorkspaceHistoryState(
  historyState: unknown,
): WorkspaceHistoryEntry | null {
  if (!historyState || typeof historyState !== "object") return null;
  const entry = (historyState as Record<string, unknown>)[
    WORKSPACE_HISTORY_STATE_KEY
  ];
  if (!entry || typeof entry !== "object") return null;
  const candidate = entry as Partial<WorkspaceHistoryEntry>;
  if (
    !isWorkspace(candidate.workspace) ||
    !Array.isArray(candidate.trail) ||
    !candidate.trail.every(isWorkspace) ||
    !Number.isInteger(candidate.depth) ||
    Number(candidate.depth) < 0 ||
    typeof candidate.scrollY !== "number" ||
    !Number.isFinite(candidate.scrollY)
  )
    return null;
  return {
    workspace: candidate.workspace,
    trail: candidate.trail,
    depth: Number(candidate.depth),
    scrollY: Math.max(0, candidate.scrollY),
  };
}

function parseRecentWorkspaceEntry(
  value: unknown,
): RecentWorkspaceEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RecentWorkspaceEntry>;
  if (
    !isWorkspace(candidate.workspace) ||
    !Array.isArray(candidate.trail) ||
    !candidate.trail.every(isWorkspace) ||
    typeof candidate.scrollY !== "number" ||
    !Number.isFinite(candidate.scrollY) ||
    typeof candidate.visitedAt !== "number" ||
    !Number.isFinite(candidate.visitedAt)
  )
    return null;
  return {
    workspace: candidate.workspace,
    trail: candidate.trail,
    scrollY: Math.max(0, candidate.scrollY),
    visitedAt: candidate.visitedAt,
  };
}

export function parseRecentWorkspaceEntries(
  serialized: string | null | undefined,
): RecentWorkspaceEntry[] {
  if (!serialized) return [];
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: RecentWorkspaceEntry[] = [];
    for (const value of parsed) {
      const entry = parseRecentWorkspaceEntry(value);
      if (!entry || result.some((item) => item.workspace === entry.workspace))
        continue;
      result.push(entry);
      if (result.length === RECENT_WORKSPACES_LIMIT) break;
    }
    return result;
  } catch {
    return [];
  }
}

export function recordRecentWorkspace(
  entries: readonly RecentWorkspaceEntry[],
  entry: RecentWorkspaceEntry,
): RecentWorkspaceEntry[] {
  return [
    entry,
    ...entries.filter((candidate) => candidate.workspace !== entry.workspace),
  ].slice(0, RECENT_WORKSPACES_LIMIT);
}
