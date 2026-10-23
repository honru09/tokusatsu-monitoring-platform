"use client";

import React, { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { springs } from "../lib/motion-tokens";
import styles from "./primary-navigation.module.css";

export type PrimaryWorkspace =
  | "inventory"
  | "assistant"
  | "collaboration"
  | "workbench";

const destinations = [
  { key: "inventory", label: "首页" },
  { key: "assistant", label: "AI" },
  { key: "collaboration", label: "消息" },
  { key: "workbench", label: "工作台" },
] as const;

function NavigationIcon({ workspace }: { workspace: PrimaryWorkspace }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {workspace === "inventory" ? (
        <>
          <path d="m3.5 10 8.5-7 8.5 7M5.5 8.5V20h5v-6h3v6h5V8.5" />
        </>
      ) : workspace === "assistant" ? (
        <>
          <path d="m10 3 2.3 6.7L19 12l-6.7 2.3L10 21l-2.3-6.7L1 12l6.7-2.3L10 3Z" />
          <path d="m19 2 .9 2.1L22 5l-2.1.9L19 8l-.9-2.1L16 5l2.1-.9L19 2Z" />
        </>
      ) : workspace === "collaboration" ? (
        <>
          <path d="M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5 10 10 0 0 1-3.7-.7L3 21l1.7-5.3a8.5 8.5 0 1 1 15.8-4.2Z" />
          <path d="M8 10h8M8 14h5" />
        </>
      ) : (
        <>
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.8" />
          <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.8" />
          <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.8" />
          <rect x="14" y="14" width="6.5" height="6.5" rx="1.8" />
        </>
      )}
    </svg>
  );
}

/** The selection moves, not the dock or its hit targets. */
export const PrimaryNavigation = memo(function PrimaryNavigation({
  activeWorkspace,
  unreadCount,
  onNavigate,
}: {
  activeWorkspace: PrimaryWorkspace;
  unreadCount: number;
  onNavigate: (workspace: PrimaryWorkspace) => void;
}) {
  const [pointerMotion, setPointerMotion] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const selectionRef = useRef<HTMLSpanElement>(null);
  const selectionAnimationRef = useRef<{ stop: () => void } | null>(null);
  const activeIndex = Math.max(
    0,
    destinations.findIndex(({ key }) => key === activeWorkspace),
  );
  const initialSelection = useRef(`translateX(${activeIndex * 100}%)`);
  useEffect(() => setMotionReady(true), []);
  useLayoutEffect(() => {
    const node = selectionRef.current;
    if (!node) return;
    selectionAnimationRef.current?.stop();
    selectionAnimationRef.current = null;
    const transform = `translateX(${activeIndex * 100}%)`;
    if (!pointerMotion || reduceMotion) {
      node.style.transform = transform;
      return;
    }
    const animation = animate(node, { transform }, springs.appleSelection);
    selectionAnimationRef.current = animation;
    return () => animation.stop();
  }, [activeIndex, pointerMotion, reduceMotion]);
  return (
    <nav
      aria-label="主要工作区"
      className={`ios-nav primary-navigation ${styles.navigation}`}
      data-pointer-motion={pointerMotion}
      onPointerDown={() => setPointerMotion(true)}
      onPointerLeave={() => setHoverIndex(null)}
      onKeyDown={() => {setPointerMotion(false);setHoverIndex(null);}}
    >
      <span className={styles.track} aria-hidden="true">
        <motion.span
          className={styles.hoverSelection}
          initial={false}
          animate={{ transform: `translateX(${(hoverIndex ?? activeIndex) * 100}%)`, opacity: motionReady && !reduceMotion && hoverIndex !== null && hoverIndex !== activeIndex ? 1 : 0 }}
          transition={pointerMotion && !reduceMotion ? springs.appleSelection : { duration: 0 }}
        />
        <span
          className={styles.selection}
          ref={selectionRef}
          style={{ transform: initialSelection.current }}
        />
      </span>
      {destinations.map(({ key, label }, index) => (
        <motion.button
          key={key}
          type="button"
          tabIndex={0}
          data-apple-motion-owned
          initial={false}
          animate={{transform:"scale(1)"}}
          whileTap={motionReady && pointerMotion && !reduceMotion ? {transform:"scale(.96)"} : undefined}
          transition={pointerMotion && !reduceMotion ? springs.applePress : {duration:0}}
          onPointerEnter={event => {
            if (event.pointerType === "mouse" && matchMedia("(hover: hover) and (pointer: fine)").matches) {
              setPointerMotion(true);
              setHoverIndex(index);
            }
          }}
          onClick={() => onNavigate(key)}
          aria-label={label}
          aria-current={activeWorkspace === key ? "page" : undefined}
          className={`primary-navigation-item ${styles.item}`}
        >
          <motion.span className={`primary-navigation-icon ${styles.icon}`}
            tabIndex={-1}
            initial={false}
            animate={{ transform: !motionReady || reduceMotion ? "none" : activeWorkspace === key ? "translateY(-1px) scale(1.06)" : "translateY(0px) scale(1)" }}
            whileTap={!motionReady || !pointerMotion || reduceMotion ? undefined : { transform: "translateY(1px) scale(0.9)" }}
            transition={pointerMotion && !reduceMotion ? springs.applePress : { duration: 0 }}>
            <NavigationIcon workspace={key} />
            {key === "collaboration" && unreadCount > 0 && (
              <span
                className="message-unread-badge"
                aria-label={`${unreadCount} 条未读消息`}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </motion.span>
          <span className={`primary-navigation-label ${styles.label}`}>
            {label}
          </span>
        </motion.button>
      ))}
    </nav>
  );
});
