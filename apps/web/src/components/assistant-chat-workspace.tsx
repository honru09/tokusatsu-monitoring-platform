"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { readJsonResponse } from "../lib/http-json";

type ChatItem = {
  id: string;
  titleRaw: string;
  titleZh?: string | null;
  sourceUrl: string;
  priceCurrent: number;
  shippingFee?: number | null;
  quantityEst?: number | null;
  listingType: "auction" | "direct";
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
  provider?: "bai" | "openrouter";
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
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMessages(loadStoredMessages()), []);
  useEffect(() => {
    if (!messages.length) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const history = useMemo(
    () => messages.slice(-12).map(({ role, content }) => ({ role, content })),
    [messages],
  );

  async function send(text: string) {
    const message = text.trim();
    if (!message || loading) return;
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
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
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
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <section className="assistant-chat" aria-label="AI 采购助手">
      <header className="assistant-chat-heading">
        <div className="assistant-chat-mark" aria-hidden="true">
          <SparklesIcon />
        </div>
        <div>
          <p>实时采购助手</p>
          <h2>想找什么，直接问我</h2>
        </div>
      </header>

      <div className="assistant-chat-feed" aria-live="polite">
        {messages.length === 0 && (
          <div className="assistant-welcome">
            <SparklesIcon className="h-7 w-7" />
            <p>
              我可以读取当前商品、卖家、收藏、购买、资讯和监控状态，帮你找到具体商品并给出下一步建议。
            </p>
            <div className="assistant-starters">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => void send(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`assistant-message assistant-message-${message.role}`}
          >
            {message.role === "assistant" && (
              <SparklesIcon className="assistant-message-icon" />
            )}
            <div className="assistant-message-body">
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
                      onClick={() => void onOpenItem(item.id)}
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
                        <span>
                          {formatYen(item.priceCurrent)} ·{" "}
                          {item.source.displayName}
                        </span>
                        {exchangeRate && (
                          <small>
                            约 ¥{(item.priceCurrent * exchangeRate).toFixed(0)}
                          </small>
                        )}
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
                      onClick={() => void send(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              {message.role === "assistant" && message.generatedAt && (
                <small className="assistant-message-meta">
                  实时数据 ·{" "}
                  {new Date(message.generatedAt).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              )}
            </div>
          </article>
        ))}
        {loading && (
          <div className="assistant-thinking">
            <SparklesIcon className="h-5 w-5" />
            <span>正在检索实时数据</span>
            <i />
            <i />
            <i />
          </div>
        )}
        {error && <p className="assistant-error">{error}</p>}
        <div ref={endRef} />
      </div>

      <form className="assistant-composer" onSubmit={submit}>
        <span className="assistant-composer-mark" aria-hidden="true">
          <SparklesIcon />
        </span>
        <label className="sr-only" htmlFor="assistant-input">
          向 AI 采购助手提问
        </label>
        <input
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="我能帮你找什么？"
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
