export type Workspace =
  | "inventory"
  | "discovery"
  | "links"
  | "purchases"
  | "favorites"
  | "sellers"
  | "intel"
  | "disliked"
  | "reviews"
  | "monitoring"
  | "ai"
  | "logistics"
  | "assistant"
  | "workbench"
  | "menu";

export type WorkspaceNavigationState = {
  workspace: Workspace;
  trail: Workspace[];
};

export const PRIMARY_WORKSPACES = new Set<Workspace>([
  "inventory",
  "discovery",
  "assistant",
  "workbench",
  "menu",
]);

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
