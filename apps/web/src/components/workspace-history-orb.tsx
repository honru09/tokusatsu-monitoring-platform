"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  RecentWorkspaceEntry,
  Workspace,
} from "../lib/workspace-navigation";
import { useFloatingControl } from "../lib/use-floating-control";
import styles from "./workspace-history-orb.module.css";

const workspaceLabels: Record<Workspace, string> = {
  inventory: "首页",
  catalog: "在售商品",
  links: "链接专区",
  purchases: "购买记录",
  orders: "库存订单",
  favorites: "收藏",
  sellers: "卖家",
  intel: "资讯专区",
  disliked: "不感兴趣",
  monitoring: "监控运行",
  resale: "闲鱼上架",
  ai: "AI 状态",
  logistics: "物流测算",
  calculator: "进货计算器",
  operations: "运营台",
  assistant: "AI",
  collaboration: "消息",
  workbench: "工作台",
  profile: "个人主页",
};

const workspaceGlyphs: Record<Workspace, string> = {
  inventory: "m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9",
  catalog: "M5 8h14l1 12H4L5 8Zm3 0V6a4 4 0 0 1 8 0v2",
  links:
    "m10 14 4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  purchases: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6",
  orders: "m3 7 9-4 9 4v11l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v11m-5-17 10 4",
  favorites:
    "M20.4 4.6a5.5 5.5 0 0 0-7.8 0L12 5.2l-.6-.6a5.5 5.5 0 0 0-7.8 7.8L12 21l8.4-8.6a5.5 5.5 0 0 0 0-7.8Z",
  sellers: "M4 10v10h16V10M3 10l2-7h14l2 7M3 10h18M9 20v-6h6v6",
  intel: "M4 4h16v16H4V4Zm4 4h4v4H8V8Zm7 0h2m-2 4h2m-9 4h9",
  disliked: "M5 5l14 14M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  monitoring: "M3 12h4l3-8 4 16 3-8h4",
  resale: "M5 8h14l1 12H4L5 8Zm3 0V6a4 4 0 0 1 8 0v2",
  ai: "M4 8V4h4m8 0h4v4m0 8v4h-4m-8 0H4v-4m4-7h.01M16 9h.01M8 15h8",
  logistics: "M3 5h11v13H3V5Zm11 5h4l3 4v4h-7M6 18v2m12-2v2",
  calculator: "M5 3h14v18H5V3Zm3 4h8m-8 5h1m6 0h1m-8 5h1m6 0h1",
  operations: "M3 4h18v13H3V4Zm5 17h8m-4-4v4M3 8h18",
  assistant: "M4 4h16v13H9l-5 4V4Zm4 5h8m-8 4h5",
  collaboration: "M4 4h16v13H9l-5 4V4Zm4 5h8m-8 4h5",
  workbench: "M3 7h18v13H3V7Zm5 0V3h8v4M3 12h18m-11 0v3h2v-3",
  profile: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
};

function WorkspaceGlyph({ workspace }: { workspace: Workspace }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={workspaceGlyphs[workspace]} />
    </svg>
  );
}

export function WorkspaceHistoryOrb({
  entries,
  currentWorkspace,
  onSelect,
}: {
  entries: readonly RecentWorkspaceEntry[];
  currentWorkspace: Workspace;
  onSelect: (entry: RecentWorkspaceEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyboardInteraction, setKeyboardInteraction] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpenRef = useRef<"first" | "last" | null>(null);
  const menuId = useId();
  const floating = useFloatingControl(
    "kamen-workspace-history-orb-v1",
    "left",
    () => setOpen(false),
    48,
    "lower",
  );
  const visibleEntries = entries
    .filter((entry) => entry.workspace !== currentWorkspace)
    .slice(0, 3);
  useEffect(() => setOpen(false), [currentWorkspace]);
  useLayoutEffect(() => {
    if (!open || !focusOnOpenRef.current) return;
    const controls =
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    const index =
      focusOnOpenRef.current === "last" ? (controls?.length ?? 1) - 1 : 0;
    controls?.[index]?.focus({ preventScroll: true });
    focusOnOpenRef.current = null;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !floating.rootRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setKeyboardInteraction(true);
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, floating.rootRef]);
  if (!visibleEntries.length) return null;
  return (
    <aside
      ref={floating.rootRef}
      style={floating.style}
      className={`${styles.orb} workspace-history-orb floating-control ${open ? "is-open" : ""} ${floating.dragging ? "is-dragging" : ""}`}
      data-edge={floating.edge}
      data-rail-direction={floating.down ? "down" : "up"}
      data-keyboard={keyboardInteraction || undefined}
      aria-label="最近浏览"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} workspace-history-trigger`}
        aria-label={open ? "收起最近浏览" : "打开最近浏览"}
        title="最近浏览 · 长按移动"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        {...floating.handlers}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setKeyboardInteraction(true);
          focusOnOpenRef.current = event.key === "ArrowUp" ? "last" : "first";
          if (open) {
            const controls =
              menuRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]',
              );
            controls?.[
              event.key === "ArrowUp" ? controls.length - 1 : 0
            ]?.focus({ preventScroll: true });
            focusOnOpenRef.current = null;
          } else setOpen(true);
        }}
        onClick={(event) => {
          if (!floating.allowClick()) {
            event.preventDefault();
            return;
          }
          setKeyboardInteraction(event.detail === 0);
          focusOnOpenRef.current = event.detail === 0 && !open ? "first" : null;
          setOpen((value) => !value);
        }}
      >
        <svg
          className={`${styles.triggerGlyph} workspace-history-trigger-glyph`}
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.5 8.5A8 8 0 1 1 4 13M4.5 4.5v4h4M12 7.5V12l3 2" />
        </svg>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label="最近浏览"
        className={styles.rail}
        style={{ maxHeight: floating.railMaxHeight }}
        aria-hidden={!open}
        inert={!open}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          setKeyboardInteraction(true);
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]',
            ),
          );
          const current = controls.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? controls.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    controls.length) %
                  controls.length;
          controls[next]?.focus({ preventScroll: true });
        }}
      >
        <div className={styles.heading} aria-hidden="true">
          最近浏览
        </div>
        {visibleEntries.map((entry) => (
          <button
            key={entry.workspace}
            type="button"
            role="menuitem"
            data-history-entry=""
            className={styles.entry}
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus({ preventScroll: true });
              onSelect(entry);
            }}
          >
            <span className={styles.entryIcon}>
              <WorkspaceGlyph workspace={entry.workspace} />
            </span>
            <span className={styles.entryLabel}>
              {workspaceLabels[entry.workspace]}
            </span>
            <svg
              aria-hidden="true"
              className={styles.returnGlyph}
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 5v6H5m4-4-4 4 4 4" />
            </svg>
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          className={styles.positionAction}
          onClick={() => {
            floating.moveToEdge(floating.edge === "left" ? "right" : "left");
            setOpen(false);
            triggerRef.current?.focus({ preventScroll: true });
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d={
                floating.edge === "left"
                  ? "M4 10h9m-3-3 3 3-3 3M16 5v10"
                  : "M16 10H7m3-3-3 3 3 3M4 5v10"
              }
            />
          </svg>
          {floating.edge === "left" ? "移到右侧" : "移到左侧"}
        </button>
      </div>
    </aside>
  );
}
