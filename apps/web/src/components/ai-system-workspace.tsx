"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { readFetchError } from "../lib/fetch-error";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./ai-system-workspace.module.css";

type Resources = {
  configured: boolean;
  available: boolean;
  model: string;
  tokenLimit: number;
  dailyTokenLimit: number;
  accountedTokens: number;
  todayTokens: number;
  remainingLocalBudget: number;
  expiresAt: string | null;
  allowedUses: string[];
  note: string;
};

export function AiSystemWorkspace({ apiBaseUrl, onOpenChat, onOpenProducts }: { apiBaseUrl: string; onOpenChat?: () => void; onOpenProducts?: () => void }) {
  const [data, setData] = useState<Resources | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reduceMotion = useReducedMotion();
  const pointerInputRef = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/ai/resources`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(await readFetchError(response, "无法读取额度状态"));
      setData(await response.json());
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "连接暂不可用");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apiBaseUrl]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const dailyFraction = data && data.dailyTokenLimit > 0 ? Math.min(1, data.todayTokens / data.dailyTokenLimit) : 0;
  const tokenNumber = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

  return <section className={styles.workspace} aria-labelledby="ai-system-title" onPointerDownCapture={() => { pointerInputRef.current = true; }} onKeyDownCapture={() => { pointerInputRef.current = false; }}>
    <header className={styles.header}>
      <div><h2 id="ai-system-title">AI 与额度</h2><p>智谱 · 按需使用，结果复用</p></div>
      <button type="button" disabled={loading} aria-busy={loading} onClick={() => void load()}>{loading && data ? "刷新中…" : "刷新状态"}</button>
    </header>
    <AnimatePresence initial={false}>
      {error && <motion.p key="error" role="alert" className={styles.error} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : motionTokens.duration.fast }}>{error}</motion.p>}
    </AnimatePresence>
    {loading && !data && <div className={styles.loading} role="status"><span />正在读取服务状态…</div>}
    {data && <>
      <div className={styles.connection}>
        <div>
          <span className={styles.sectionLabel}>当前模型</span>
          <h3>{data.model}</h3>
          <p className={styles.status} data-available={data.configured && data.available}>{!data.configured ? "尚未配置" : data.available ? "赠送资源规则已启用" : "调用已暂停，请检查资源期限和用量"}</p>
        </div>
        {onOpenChat ? <button type="button" className={styles.primary} onClick={onOpenChat}>打开 AI 聊天<span aria-hidden="true">↗</span></button> : <a className={styles.primary} href="/?workspace=assistant">打开 AI 聊天<span aria-hidden="true">↗</span></a>}
      </div>
      <dl className={styles.usage}>
        <div className={styles.daily}>
          <dt>今日计入用量</dt>
          <dd>{tokenNumber(data.todayTokens)}<small> / {tokenNumber(data.dailyTokenLimit)} tokens</small></dd>
          <div className={styles.meter} role="meter" aria-label="今日本地调用用量" aria-valuemin={0} aria-valuemax={data.dailyTokenLimit} aria-valuenow={data.todayTokens}><motion.span data-apple-motion-owned="true" initial={false} animate={{ transform: `scaleX(${dailyFraction})` }} transition={{ duration: reduceMotion || !pointerInputRef.current ? 0 : motionTokens.duration.fast, ease: motionTokens.easing.smooth }} /></div>
        </div>
        <div><dt>剩余本地预算</dt><dd>{tokenNumber(data.remainingLocalBudget)}<small>tokens</small></dd></div>
        <div><dt>资源到期</dt><dd className={styles.date}>{data.expiresAt ? new Date(data.expiresAt).toLocaleDateString("zh-CN") : "期限无效"}</dd><span className={styles.budgetCaption}>到期后停止调用</span></div>
      </dl>
      <p className={styles.note}>{data.note}</p>
      <section className={styles.uses} aria-labelledby="ai-uses-title">
        <header><h3 id="ai-uses-title">从任务开始</h3><span>只有主动操作才调用 AI</span></header>
        <div className={styles.useList}>
          <article data-ai-purpose="product_reading">
            <span className={styles.useIndex} aria-hidden="true">01</span>
            <div><h4>读取商品</h4><p>在商品详情读取图片与资料，核对商品事实。</p></div>
            {onOpenProducts ? <button type="button" onClick={onOpenProducts} aria-label="到商品库，从详情读取商品">商品库<span aria-hidden="true">→</span></button> : <a href="/?workspace=catalog" aria-label="到商品库，从详情读取商品">商品库<span aria-hidden="true">→</span></a>}
          </article>
          <article data-ai-purpose="translation">
            <span className={styles.useIndex} aria-hidden="true">02</span>
            <div><h4>翻译商品</h4><p>在商品详情翻译原文，已有译文直接复用。</p></div>
            {onOpenProducts ? <button type="button" onClick={onOpenProducts} aria-label="到商品库，从详情翻译商品">商品库<span aria-hidden="true">→</span></button> : <a href="/?workspace=catalog" aria-label="到商品库，从详情翻译商品">商品库<span aria-hidden="true">→</span></a>}
          </article>
          <article data-ai-purpose="chat">
            <span className={styles.useIndex} aria-hidden="true">03</span>
            <div><h4>AI 聊天</h4><p>带着商品、采购或库存问题，直接询问助手。</p></div>
            {onOpenChat ? <button type="button" onClick={onOpenChat}>开始聊天<span aria-hidden="true">→</span></button> : <a href="/?workspace=assistant">开始聊天<span aria-hidden="true">→</span></a>}
          </article>
        </div>
      </section>
      <details className={styles.rules}>
        <summary>调用规则与资源口径<span aria-hidden="true">+</span></summary>
        <ul><li>只使用 GLM-5.3-Flash，没有付费模型回退。</li><li>商品翻译和读取结果复用缓存，相同并发请求合并。</li><li>后台批量 AI、模型规划、图片生成和联网搜索均关闭。</li><li>每次调用先预留额度，超时不自动重试。达到预算或到期后停止请求。</li><li>资源包也可能被该账号的其他应用使用，请以智谱控制台余额为准。</li></ul>
      </details>
    </>}
    {!loading && !data && !error && <p className={styles.loading}>暂无可用的服务状态，刷新后重试。</p>}
  </section>;
}
