"use client";
import { YahooDiscount } from "./yahoo-discount";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { readJsonResponse } from "../lib/http-json";
import type { ListingType } from "../lib/listing-type";
import { motionTokens, springs } from "../lib/motion-tokens";
import styles from "./editorial-communications.module.css";

type ChatItem = {
  id: string;
  titleRaw: string;
  titleZh?: string | null;
  sourceUrl: string;
  priceCurrent: number;
  shippingFee?: number | null;
  quantityEst?: number | null;
  listingType: ListingType;
  auctionEndAt?: string | null;
  source: { key: string; displayName: string };
  seller?: { id?: string; name: string } | null;
  images: { url: string; position: number }[];
};

type ChatResponse = {
  answerZh: string;
  items: ChatItem[];
  suggestions: string[];
  model: string;
  provider?: string;
  fallbackUsed: boolean;
  generatedAt: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  items?: ChatItem[];
  suggestions?: string[];
  model?: string;
  generatedAt?: string;
};

const STORAGE_KEY = "kamen-procurement-assistant-v1";
const starters = ["现在最值得看的商品", "即将结束的拍卖", "检查监控运行状态"];

function SparklesIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2.8c.8 4.2 2.7 6.1 6.9 6.9-4.2.8-6.1 2.7-6.9 6.9-.8-4.2-2.7-6.1-6.9-6.9 4.2-.8 6.1-2.7 6.9-6.9Z" />
      <path d="M19 15.6c.35 1.9 1.2 2.75 3.1 3.1-1.9.35-2.75 1.2-3.1 3.1-.35-1.9-1.2-2.75-3.1-3.1 1.9-.35 2.75-1.2 3.1-3.1ZM5 2.4c.25 1.35.85 1.95 2.2 2.2C5.85 4.85 5.25 5.45 5 6.8c-.25-1.35-.85-1.95-2.2-2.2C4.15 4.35 4.75 3.75 5 2.4Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 14-8-4 16-3.2-6.2L5 12Z" />
      <path d="M11.8 13.8 19 4" />
    </svg>
  );
}

function formatYen(value: number) {
  return `¥${new Intl.NumberFormat("zh-CN").format(value)}`;
}

function cleanDisplayText(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

function loadStoredMessages(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.slice(-30) : [];
  } catch {
    return [];
  }
}

export function AssistantChatWorkspace({
  apiBaseUrl,
  exchangeRate,
  onOpenItem,
}: {
  apiBaseUrl: string;
  exchangeRate?: number;
  onOpenItem: (id: string) => Promise<boolean>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const requestInFlightRef = useRef(false);
  const newAnswerIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const reduceMotion = useReducedMotion();
  const pointerInputRef = useRef(false);
  const [hasNewAnswer, setHasNewAnswer] = useState(false);
  const [openingItemId, setOpeningItemId] = useState<string | null>(null);
  const openingItemRef = useRef<string | null>(null);
  const [itemError, setItemError] = useState("");
  const instantMotion = reduceMotion || !pointerInputRef.current;

  useEffect(() => setMessages(loadStoredMessages()), []);
  useEffect(() => {
    if (!messages.length) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      // The current conversation remains available if local storage is full.
    }
    const feed = feedRef.current;
    if (feed && stickToBottomRef.current) feed.scrollTop = feed.scrollHeight;
  }, [messages, loading]);
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) feed.scrollTop = feed.scrollHeight;
    });
    observer.observe(feed);
    return () => observer.disconnect();
  }, []);

  const history = useMemo(
    () => messages.slice(-12).map(({ role, content }) => ({ role, content })),
    [messages],
  );

  async function send(text: string) {
    const message = text.trim();
    if (!message || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    stickToBottomRef.current = true;
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/ai/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const data = await readJsonResponse<
        ChatResponse & {
          message?: string;
        }
      >(response, "AI 暂时无法回答");
      const answerId = `assistant-${Date.now()}`;
      newAnswerIdRef.current = answerId;
      setHasNewAnswer(!stickToBottomRef.current);
      setMessages((current) => [
        ...current,
        {
          id: answerId,
          role: "assistant",
          content: data.answerZh,
          items: data.items,
          suggestions: data.suggestions,
          model: data.model,
          generatedAt: data.generatedAt,
        },
      ]);
    } catch (reason) {
      setInput(message);
      setError(reason instanceof Error ? reason.message : "AI 暂时无法回答");
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  async function openResult(id: string) {
    if (openingItemRef.current) return;
    openingItemRef.current = id;
    setOpeningItemId(id);
    setItemError("");
    try {
      if (!(await onOpenItem(id))) setItemError("商品暂时无法打开，可稍后重试。");
    } catch {
      setItemError("商品暂时无法打开，可稍后重试。");
    } finally {
      openingItemRef.current = null;
      setOpeningItemId(null);
    }
  }

  return (
    <section className={`assistant-chat ${styles.assistant}`} aria-label="AI 采购助手" onPointerDownCapture={() => { pointerInputRef.current = true; }} onKeyDownCapture={() => { pointerInputRef.current = false; }}>
      <header className="assistant-chat-heading">
        <div>
          <h2>采购助手</h2>
          <p>基于商品与库存，按需回答</p>
        </div>
        <span className={styles.serviceLabel}>智谱 · Flash</span>
      </header>

      <div ref={feedRef} className="assistant-chat-feed" role="log" aria-live="polite" onScroll={(event) => {
        const feed = event.currentTarget;
        stickToBottomRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 72;
        if (stickToBottomRef.current) setHasNewAnswer(false);
      }}>
        {messages.length === 0 && (
          <div className="assistant-welcome">
            <SparklesIcon className="h-7 w-7" />
            <p>
              找商品、查价格，或问问当前库存。
            </p>
            <div className="assistant-starters">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  disabled={loading}
                  onClick={() => void send(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <motion.article
            key={message.id}
            className={`assistant-message assistant-message-${message.role}`}
            data-apple-motion-owned="true"
            initial={message.id === newAnswerIdRef.current && !instantMotion ? { opacity: 0, transform: "translateY(12px)" } : false}
            animate={{ opacity: 1, transform: instantMotion ? "none" : "translateY(0px)" }}
            transition={instantMotion ? { duration: 0 } : springs.appleSpatial}
          >
            <div className="assistant-message-body">
              <span className={styles.messageByline}>{message.role === "assistant" ? "采购助手" : "你"}</span>
              <p className="whitespace-pre-wrap">
                {cleanDisplayText(message.content)}
              </p>
              {message.items && message.items.length > 0 && (
                <div className="assistant-result-strip">
                  {message.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="assistant-result-card"
                      onClick={() => void openResult(item.id)}
                      disabled={openingItemId !== null}
                      aria-busy={openingItemId === item.id}
                    >
                      <span className="assistant-result-image">
                        {item.images[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.images[0].url} alt="" loading="lazy" />
                        ) : (
                          <SparklesIcon className="h-5 w-5" />
                        )}
                      </span>
                      <span className="assistant-result-copy">
                        <strong>{item.titleZh ?? item.titleRaw}</strong>
                        {openingItemId === item.id && <small className={styles.resultOpening} role="status">正在打开商品…</small>}
                        <span>
                          {formatYen(item.priceCurrent)} ·{" "}
                          {item.source.displayName}
                        </span>
                        {exchangeRate && (
                          <small>
                            约 ¥{(item.priceCurrent * exchangeRate).toFixed(0)}
                          </small>
                        )}
                        <YahooDiscount sourceKey={item.source.key} priceYen={item.priceCurrent} exchangeRate={exchangeRate} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {message.suggestions && message.suggestions.length > 0 && (
                <div className="assistant-followups">
                  {message.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={loading}
                      onClick={() => void send(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              {message.role === "assistant" && message.generatedAt && (
                <small className="assistant-message-meta">
                  回答于{" "}
                  {new Date(message.generatedAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              )}
            </div>
          </motion.article>
        ))}
        <AnimatePresence initial={false}>
        {loading && (
          <motion.div key="thinking" className="assistant-thinking" role="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : motionTokens.duration.fast }}>
            <SparklesIcon className="h-5 w-5" />
            <span>正在检索实时数据</span>
            <i />
            <i />
            <i />
          </motion.div>
        )}
        </AnimatePresence>
        {error && <p className="assistant-error" role="alert">{error}</p>}
        {itemError && <p className="assistant-error" role="alert">{itemError}</p>}
      </div>

      <AnimatePresence initial={false}>
        {hasNewAnswer && <motion.div className={styles.answerNotice} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: instantMotion ? 0 : motionTokens.duration.feedback }}>
          <button type="button" onClick={() => { const feed = feedRef.current; if (feed) feed.scrollTop = feed.scrollHeight; stickToBottomRef.current = true; setHasNewAnswer(false); }} aria-label="查看新回答">新回答已就绪<span aria-hidden="true">↓</span></button>
        </motion.div>}
      </AnimatePresence>
      <form className="assistant-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="assistant-input">
          向 AI 采购助手提问
        </label>
        <input
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入商品、采购或库存问题…"
          maxLength={2_000}
          disabled={loading}
        />
        <button
          type="submit"
          aria-label="发送"
          disabled={loading || !input.trim()}
        >
          <SendIcon />
        </button>
      </form>
    </section>
  );
}
