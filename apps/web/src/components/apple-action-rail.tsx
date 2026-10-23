"use client";

import React, { useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { springs } from "../lib/motion-tokens";
import styles from "./apple-action-rail.module.css";

/** One shared light surface follows the current action; the actions stay still. */
export function AppleActionRail({ children, className = "" }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState({ top: 0, height: 100, visible: false });
  const [pointer, setPointer] = useState(false);
  const reduce = useReducedMotion();
  return <div ref={root} className={`${styles.rail} ${className}`}
    onPointerOver={event => {
      if (event.pointerType !== "mouse" || !matchMedia("(hover: hover) and (pointer: fine)").matches || reduce) return;
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
      if (!button || !root.current?.contains(button) || hovered.current === button) return;
      hovered.current = button;
      const rect = button.getBoundingClientRect(), parent = root.current.getBoundingClientRect();
      setPointer(true);
      setTarget({top:rect.top-parent.top,height:rect.height,visible:true});
    }}
    onPointerLeave={() => {hovered.current=null;setTarget(value=>({...value,visible:false}));}}
    onKeyDown={() => {setPointer(false);hovered.current=null;setTarget(value=>({...value,visible:false}));}}>
    <motion.span className={styles.light} aria-hidden="true" initial={false}
      animate={{transform:`translate3d(0,${target.top}px,0) scaleY(${target.height/100})`,opacity:target.visible&&!reduce?1:0}}
      transition={pointer&&!reduce?springs.appleSelection:{duration:0}} />
    {children}
  </div>;
}
