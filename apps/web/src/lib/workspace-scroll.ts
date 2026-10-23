type WorkspaceScrollElement = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTo" | "scrollTop"
>;

type WorkspaceScrollOptions = {
  getOverflowY?: (element: HTMLElement) => string;
  requestFrame?: (callback: () => void) => unknown;
  scrollWindow?: (options: ScrollToOptions) => void;
};

function defaultOverflowY(element: HTMLElement) {
  return window.getComputedStyle(element).overflowY;
}

export function isWorkspaceElementScrollable(
  element: WorkspaceScrollElement | null | undefined,
  overflowY: string,
) {
  return Boolean(
    element &&
      /^(auto|scroll|overlay)$/u.test(overflowY) &&
      element.scrollHeight > element.clientHeight + 1,
  );
}

export function readWorkspaceScrollTop(
  element: HTMLElement | null,
  windowScrollY: number,
  getOverflowY: (element: HTMLElement) => string = defaultOverflowY,
) {
  if (element && isWorkspaceElementScrollable(element, getOverflowY(element))) {
    return element.scrollTop;
  }
  return windowScrollY;
}

export function restoreWorkspaceScroll(
  scrollY: number,
  element: HTMLElement | null,
  options: WorkspaceScrollOptions = {},
) {
  const getOverflowY = options.getOverflowY ?? defaultOverflowY;
  const requestFrame =
    options.requestFrame ??
    ((callback) => window.requestAnimationFrame(callback));
  const scrollWindow =
    options.scrollWindow ?? ((value) => window.scrollTo(value));

  const apply = () => {
    const top = Math.max(0, scrollY);
    if (
      element &&
      isWorkspaceElementScrollable(element, getOverflowY(element))
    ) {
      element.scrollTo({ top, behavior: "auto" });
      return;
    }
    scrollWindow({ top, behavior: "auto" });
  };

  // Restore before the next paint so returning users never see the top of the
  // workspace. One frame correction handles images/content that settle later.
  apply();
  requestFrame(apply);
}
