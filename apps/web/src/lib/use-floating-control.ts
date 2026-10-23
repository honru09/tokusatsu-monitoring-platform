"use client";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type FloatingPosition = { edge: "left" | "right"; top: number };
const SIZE = 44;
// Keep the control reachable without pinning it against the bezel. The
// bottom dock already owns the safe-area inset; this edge inset gives the
// draggable rail a comfortable thumb target on both desktop and mobile.
const EDGE = 12;
export function clampFloatingPosition(
  position: FloatingPosition,
  width: number,
  height: number,
  size = SIZE,
) {
  // Keep the existing bottom-nav clearance contract. The size only affects
  // horizontal clamping; vertical clearance is intentionally conservative so
  // the rail never lands over the dock or the keyboard composer.
  const top = Math.max(76, Math.min(position.top, Math.max(76, height - 170)));
  return {
    edge: position.edge,
    top,
    left: position.edge === "left" ? EDGE : Math.max(EDGE, width - size - EDGE),
  };
}

export function useFloatingControl(
  storageKey: string,
  defaultEdge: "left" | "right",
  onDragStart: () => void,
  desktopSize = SIZE,
  defaultPlacement: "middle" | "lower" = "middle",
) {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [free, setFree] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const suppressUntil = useRef(0);
  const moveFrameRef = useRef<number | null>(null);
  const pendingFreeRef = useRef<{ left: number; top: number } | null>(null);
  const onStartRef = useRef(onDragStart);
  onStartRef.current = onDragStart;
  const session = useRef<{
    id: number;
    originX: number;
    originY: number;
    left: number;
    top: number;
    currentLeft: number;
    currentTop: number;
    active: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const bounds = () => ({
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  });
  const controlSize = () =>
    typeof window !== "undefined" && window.innerWidth <= 699
      ? SIZE
      : desktopSize;
  useEffect(() => {
    let next: FloatingPosition = {
      edge: defaultEdge,
      top:
        defaultPlacement === "lower"
          ? window.innerHeight - 170
          : window.innerHeight * (defaultEdge === "left" ? 0.55 : 0.3),
    };
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (
        value &&
        ["left", "right"].includes(value.edge) &&
        Number.isFinite(value.top)
      )
        next = value;
    } catch {
      /* Storage is optional. */
    }
    const update = () => {
      const { width, height } = bounds();
      setPosition((current) => {
        const safe = clampFloatingPosition(
          current ?? next,
          width,
          height,
          controlSize(),
        );
        return { edge: safe.edge, top: safe.top };
      });
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      if (moveFrameRef.current != null)
        window.cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
      pendingFreeRef.current = null;
      if (session.current?.timer) clearTimeout(session.current.timer);
    };
  }, [defaultEdge, defaultPlacement, desktopSize, storageKey]);
  const savePosition = (next: FloatingPosition) => {
    setPosition(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Storage is optional. */
    }
  };
  const start = () => {
    const s = session.current;
    if (!s || s.active) return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.active = true;
    setDragging(true);
    onStartRef.current();
  };
  const finish = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) => {
    const s = session.current;
    if (!s || s.id !== event.pointerId) return;
    if (s.timer) clearTimeout(s.timer);
    if (moveFrameRef.current != null)
      window.cancelAnimationFrame(moveFrameRef.current);
    moveFrameRef.current = null;
    pendingFreeRef.current = null;
    session.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* Already released on pointer cancel. */
    }
    if (!s.active) return;
    suppressUntil.current = Date.now() + 450;
    const { width, height } = bounds();
    const size = controlSize();
    const safe = clampFloatingPosition(
      {
        edge: cancelled
          ? (position?.edge ?? defaultEdge)
          : s.currentLeft + size / 2 < width / 2
            ? "left"
            : "right",
        top: cancelled ? s.top : s.currentTop,
      },
      width,
      height,
      size,
    );
    const next = { edge: safe.edge, top: safe.top };
    savePosition(next);
    setFree(null);
    setDragging(false);
  };
  const safe =
    position && typeof window !== "undefined"
      ? clampFloatingPosition(
          position,
          bounds().width,
          bounds().height,
          controlSize(),
        )
      : null;
  const style: CSSProperties = {
    visibility: safe ? "visible" : "hidden",
    transform: `translate3d(${free?.left ?? safe?.left ?? 0}px, ${free?.top ?? safe?.top ?? 0}px, 0)`,
  };
  const viewportHeight = typeof window !== "undefined" ? bounds().height : 0;
  const availableAbove = Math.max(0, (safe?.top ?? 0) - 20);
  const availableBelow = Math.max(
    0,
    viewportHeight - (safe?.top ?? 0) - controlSize() - 100,
  );
  const down = availableBelow > availableAbove;
  const moveToEdge = (edge: FloatingPosition["edge"]) => {
    const { width, height } = bounds();
    const next = clampFloatingPosition(
      { edge, top: position?.top ?? height - 170 },
      width,
      height,
      controlSize(),
    );
    savePosition({ edge: next.edge, top: next.top });
  };
  return {
    rootRef,
    style,
    dragging,
    edge: position?.edge ?? defaultEdge,
    down,
    railMaxHeight: Math.max(44, down ? availableBelow : availableAbove),
    moveToEdge,
    allowClick: () => Date.now() >= suppressUntil.current,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
        if (
          session.current ||
          event.isPrimary === false ||
          (event.pointerType === "mouse" && event.button !== 0)
        )
          return;
        const rootBounds = rootRef.current?.getBoundingClientRect();
        const r = rootBounds?.width
          ? rootBounds
          : event.currentTarget.getBoundingClientRect();
        session.current = {
          id: event.pointerId,
          originX: event.clientX,
          originY: event.clientY,
          left: r.left,
          top: r.top,
          currentLeft: r.left,
          currentTop: r.top,
          active: false,
          timer: setTimeout(start, 280),
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* Older WebViews. */
        }
      },
      onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
        const s = session.current;
        if (!s || s.id !== event.pointerId) return;
        const x = event.clientX - s.originX,
          y = event.clientY - s.originY;
        // Movement begins a drag, it never cancels the long-press and strands the control.
        if (!s.active && Math.hypot(x, y) >= 6) start();
        if (!s.active) return;
        event.preventDefault();
        const { width, height } = bounds();
        s.currentLeft = Math.max(
          EDGE,
          Math.min(width - controlSize() - EDGE, s.left + x),
        );
        s.currentTop = clampFloatingPosition(
          { edge: defaultEdge, top: s.top + y },
          width,
          height,
          controlSize(),
        ).top;
        pendingFreeRef.current = { left: s.currentLeft, top: s.currentTop };
        if (moveFrameRef.current == null) {
          moveFrameRef.current = window.requestAnimationFrame(() => {
            moveFrameRef.current = null;
            const next = pendingFreeRef.current;
            if (next) setFree(next);
          });
        }
      },
      onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) =>
        finish(event),
      onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) =>
        finish(event, true),
      onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) =>
        finish(event, true),
      onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) =>
        event.preventDefault(),
    },
  };
}
