"use client";
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./detail-disclosure.module.css";

export function DetailDisclosure({
  title,
  summary,
  children,
  className = "",
  detailsRef,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  className?: string;
  detailsRef?: Ref<HTMLDetailsElement>;
}) {
  return (
    <details ref={detailsRef} className={`detail-disclosure ${styles.disclosure} ${className}`} data-pointer-motion="false" onPointerDownCapture={(event) => { event.currentTarget.dataset.pointerMotion = "true"; }} onKeyDownCapture={(event) => { event.currentTarget.dataset.pointerMotion = "false"; }}>
      <summary>
        <span>{title}</span>
        {summary && <small>{summary}</small>}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="m8 10 4 4 4-4" />
        </svg>
      </summary>
      <div className="detail-disclosure-content">{children}</div>
    </details>
  );
}

export function DetailDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const fromHeightRef = useRef<number | null>(null);
  const pointerRef = useRef(false);
  const reduceMotion = useReducedMotion();
  useLayoutEffect(() => {
    const node = paragraphRef.current;
    const from = fromHeightRef.current;
    fromHeightRef.current = null;
    animationRef.current?.cancel();
    animationRef.current = null;
    if (!node || from === null || reduceMotion || !pointerRef.current || typeof node.animate !== "function") return;
    const to = node.getBoundingClientRect().height;
    node.style.maxHeight = "none";
    const animation = node.animate([{ height:`${from}px` }, { height:`${to}px` }], { duration:motionTokens.duration.sheet * 1000, easing:"cubic-bezier(.23,1,.32,1)", fill:"none" });
    animationRef.current = animation;
    void animation.finished.then(()=>{ node.style.removeProperty("max-height"); }).catch(()=>undefined);
    return () => { animation.cancel(); node.style.removeProperty("max-height"); };
  }, [expanded, reduceMotion]);
  const lengthy = text.length > 180 || text.split("\n").length > 5;
  if (!text.trim()) {
    return (
      <section className={`detail-description ${styles.description}`} aria-label="商品说明">
        <h3>商品说明</h3>
        {/* Empty state: the art slot stays empty in this pass; a later
            batch drops a spot illustration into it. */}
        <div className="detail-description-empty">
          <div className="detail-description-art" data-description-art-slot aria-hidden="true" />
          <p>暂无商品说明</p>
        </div>
      </section>
    );
  }
  return (
    <section className={`detail-description ${styles.description}`} aria-label="商品说明" onPointerDownCapture={() => { pointerRef.current = true; }} onKeyDownCapture={() => { pointerRef.current = false; }}>
      <h3>商品说明</h3>
      <p ref={paragraphRef} id={id} className={lengthy && !expanded ? "is-condensed" : ""}>
        {text}
      </p>
      {lengthy && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => { fromHeightRef.current = paragraphRef.current?.getBoundingClientRect().height ?? null; setExpanded((value) => !value); }}
        >
          {expanded ? "收起" : "阅读全文"}
        </button>
      )}
    </section>
  );
}
