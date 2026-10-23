"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./editorial-communications.module.css";

export function OperationsWorkspace({ active = true, onOpenChat }: { active?: boolean; onOpenChat?: () => void }) {
  const visited = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [reconnectRequested, setReconnectRequested] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const callback = useRef(onOpenChat);
  callback.current = onOpenChat;
  if (active) visited.current = true;
  const sendVisibility = () => {
    iframe.current?.contentWindow?.postMessage({ type: "kamen-operations:visibility", active }, window.location.origin);
    iframe.current?.contentWindow?.postMessage({ type: "kamen-operations:expanded", expanded }, window.location.origin);
  };
  useEffect(() => {
    sendVisibility();
    if (!active) { setReconnectRequested(false); window.dispatchEvent(new CustomEvent("kamen:embedded-editing", { detail: { editing: false } })); }
  }, [active]);
  useEffect(() => {
    document.documentElement.dataset.operationsExpanded = String(active && expanded);
    iframe.current?.contentWindow?.postMessage({ type: "kamen-operations:expanded", expanded }, window.location.origin);
    return () => { delete document.documentElement.dataset.operationsExpanded; };
  }, [active, expanded]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow || !active) return;
      if (event.data?.type === "kamen-operations:navigate" && event.data.workspace === "collaboration") callback.current?.();
      if (event.data?.type === "kamen-operations:expand") setExpanded(value => !value);
      if (event.data?.type === "kamen-operations:editing") window.dispatchEvent(new CustomEvent("kamen:embedded-editing", { detail: { editing: event.data.editing === true } }));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [active]);
  if (!visited.current) return null;
  return (
    <section className={`operations-workspace ${styles.operations}`} aria-label="运营台" hidden={!active} inert={!active}>
      <header className="operations-workspace-heading">
        <div className={styles.operationsTitle}><h2>运营台</h2>{reconnectRequested && <span role="status" className={styles.reconnectReceipt}>已发送重连请求</span>}</div>
        <div>
          <button
            type="button"
            onClick={() => { if (!iframe.current?.contentWindow) return; iframe.current.contentWindow.postMessage({ type: "kamen-operations:reconnect" }, window.location.origin); setReconnectRequested(true); }}
          >
            重新连接
          </button>
          {onOpenChat && <button type="button" onClick={onOpenChat}>消息</button>}
          <button type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : "展开"}</button>
          <a
            href="/operations-browser/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="打开独立运营窗口"
            title="独立窗口"
          >
            <span className="operations-wide-label">独立窗口</span>
            <svg className="operations-compact-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 4h6v6M20 4 10 14M10 5H5v14h14v-5" /></svg>
          </a>
        </div>
      </header>
      <iframe
        ref={iframe}
        data-operations-frame="true"
        onLoad={sendVisibility}
        title="小红书与抖音运营浏览器"
        src="/operations-browser/"
        allow="fullscreen; clipboard-write"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
        referrerPolicy="same-origin"
      />
    </section>
  );
}
