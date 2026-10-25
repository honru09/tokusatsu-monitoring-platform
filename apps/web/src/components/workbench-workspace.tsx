"use client";

import type { Workspace } from "../lib/workspace-navigation";
import { TERMS } from "../lib/terms";
import { useEffect, useRef } from "react";
import styles from "./workbench-workspace.module.css";
import { AppleActionRail } from "./apple-action-rail";

/**
 * Workbench entries are grouped short lists: account on top, then
 * data & tools, then a "more" shelf, then settings. Surfaces with
 * their own primary slot （选货/消息/待办） are not repeated here, and
 * the operations console keeps no entry - it leaves the product with
 * the service split.
 */
const toolEntries = [
  ["purchases", TERMS.procurement, "购买记录、到货与库存"],
  ["calculator", TERMS.calculator, "核算报价与采购成本"],
  ["logistics", TERMS.logistics, "比较运费与运输方案"],
  ["resale", TERMS.resale, "选品、编辑、发布与维护"],
] as const;

const moreEntries = [
  ["intel", TERMS.intel, "跟进市场与商品信息"],
  ["assistant", TERMS.aiAssistant, "向 AI 提问、整理与翻译"],
] as const;

export function WorkbenchWorkspace({onNavigate, onOpenDisliked, accountName, position, activeCount, cartCount, language, onToggleLanguage, onOpenSettings}: {
  onNavigate: (workspace: Workspace) => void;
  /** 不感兴趣 is a catalog view now; the entry opens it preselected. */
  onOpenDisliked: () => void;
  accountName?: string;
  position?: number | string;
  activeCount?: number;
  cartCount: number;
  language: "zh" | "original";
  onToggleLanguage: () => void;
  onOpenSettings?: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || typeof IntersectionObserver === "undefined") return;
    const sections = root.current?.querySelectorAll<HTMLElement>("[data-scroll-entry]") ?? [];
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        (entry.target as HTMLElement).dataset.entered = "true";
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.08 });
    sections.forEach(section => { section.dataset.entered = "false"; observer.observe(section); });
    return () => observer.disconnect();
  }, []);
  return <section ref={root} className={styles.workspace} aria-labelledby="workbench-title">
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}>账号与工具</p><h2 id="workbench-title">{TERMS.workbench}</h2></div>
    </header>
    <button type="button" className={styles.account} onClick={()=>onNavigate("profile")} aria-label="前往账号页切换账号">
      <span className={styles.avatar}>{position ?? "·"}</span>
      <span className={styles.accountBody}>
        <strong>{accountName ?? "选择账号"}</strong>
        <small>{position != null ? `第 ${position} 位账号` : "尚未选择账号"} · 切换账号</small>
      </span>
      <b aria-hidden="true">›</b>
    </button>
    <div className={styles.summary}>
      <button type="button" onClick={()=>onNavigate("catalog")}><span>{TERMS.catalog} · 在售</span><strong>{activeCount == null ? "—" : activeCount.toLocaleString("zh-CN")}</strong></button>
      <div><span>{TERMS.cart}</span><strong>{cartCount.toLocaleString("zh-CN")}<small>件</small></strong></div>
      <p>从选货到售卖，沿着商品继续处理。</p>
    </div>
    <section className={styles.group} data-scroll-entry aria-labelledby="workbench-tools-title">
      <h3 id="workbench-tools-title">数据与工具</h3>
      <AppleActionRail>{toolEntries.map(([key,label,detail])=><button type="button" key={key} className={styles.entry} onClick={()=>onNavigate(key)}><span><strong>{label}</strong><small>{detail}</small></span><b aria-hidden="true">›</b></button>)}<button type="button" className={styles.entry} onClick={onOpenDisliked}><span><strong>{TERMS.disliked}</strong><small>回看排除过的商品</small></span><b aria-hidden="true">›</b></button></AppleActionRail>
    </section>
    <section className={styles.group} data-scroll-entry aria-labelledby="workbench-more-title">
      <h3 id="workbench-more-title">更多</h3>
      <AppleActionRail>{moreEntries.map(([key,label,detail])=><button type="button" key={key} className={styles.entry} onClick={()=>onNavigate(key)}><span><strong>{label}</strong><small>{detail}</small></span><b aria-hidden="true">›</b></button>)}</AppleActionRail>
    </section>
    <section className={styles.group} data-scroll-entry aria-labelledby="workbench-settings-title">
      <h3 id="workbench-settings-title">设置</h3>
      <AppleActionRail>
        <button type="button" className={styles.entry} onClick={()=>onNavigate("monitoring")}><span><strong>{TERMS.monitoring}</strong><small>类目、关键词与调度</small></span><b aria-hidden="true">›</b></button>
        {onOpenSettings && <button type="button" className={styles.entry} onClick={onOpenSettings}><span><strong>AI 状态</strong><small>剩余额度与赠送包到期日</small></span><b aria-hidden="true">›</b></button>}
        <button type="button" className={styles.entry} onClick={onToggleLanguage}><span><strong>显示语言</strong><small>{language==="zh"?"中文":"原文"}</small></span><b aria-hidden="true">›</b></button>
      </AppleActionRail>
    </section>
  </section>;
}
