"use client";

import type { Workspace } from "../lib/workspace-navigation";
import { useEffect, useRef } from "react";
import styles from "./workbench-workspace.module.css";
import { AppleActionRail } from "./apple-action-rail";

const stages = [
  { title: "选货", items: [
    ["catalog", "商品库", "比较在售商品与价格"],
    ["links", "链接专区", "把找到的商品带进来"],
    ["favorites", "收藏", "接着看已选的商品"],
    ["sellers", "卖家", "按来源与群体查找"],
  ] },
  { title: "采购", items: [
    ["purchases", "购买记录", "记录、改价与变更历史"],
    ["orders", "库存订单", "追踪到货、库存与销售"],
    ["calculator", "进货计算器", "核算报价与采购成本"],
    ["logistics", "物流测算", "比较运费与运输方案"],
  ] },
  { title: "售卖", items: [
    ["resale", "闲鱼上架", "选品、编辑、发布与维护"],
    ["operations", "运营台", "运行任务与运营协作"],
    ["collaboration", "协作消息", "带着商品沟通与跟进"],
    ["intel", "资讯专区", "跟进市场与商品信息"],
  ] },
] as const;

export function WorkbenchWorkspace({onNavigate, accountName, position, activeCount, cartCount, language, onToggleLanguage}: {
  onNavigate: (workspace: Workspace) => void;
  accountName?: string;
  position?: number | string;
  activeCount?: number;
  cartCount: number;
  language: "zh" | "original";
  onToggleLanguage: () => void;
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
      <div><p className={styles.eyebrow}>采购与售卖</p><h2 id="workbench-title">工作台</h2></div>
      <button type="button" className={styles.identity} onClick={()=>onNavigate("profile")} aria-label="前往个人主页切换账号"><span>{position ?? "·"}</span>{accountName ?? "选择账号"}<b aria-hidden="true">↗</b></button>
    </header>
    <div className={styles.summary}>
      <button type="button" onClick={()=>onNavigate("catalog")}><span>在售商品</span><strong>{activeCount == null ? "—" : activeCount.toLocaleString("zh-CN")}</strong></button>
      <div><span>采购清单</span><strong>{cartCount.toLocaleString("zh-CN")}<small>件</small></strong></div>
      <p>从选货到售卖，沿着商品继续处理。</p>
    </div>
    <div className={styles.stages}>
      {stages.map((stage,index)=><section key={stage.title} className={styles.stage} data-scroll-entry aria-labelledby={`stage-${index}`}>
        <header><span>{String(index+1).padStart(2,"0")}</span><h3 id={`stage-${index}`}>{stage.title}</h3><b aria-hidden="true">{index<2?"→":""}</b></header>
        <AppleActionRail>{stage.items.map(([key,label,detail])=><button type="button" key={key} className={`${styles.entry} ${key==="resale"?styles.resale:""}`} onClick={()=>onNavigate(key)}><span><strong>{label}</strong><small>{detail}</small></span><b aria-hidden="true">↗</b></button>)}</AppleActionRail>
      </section>)}
    </div>
    <section className={styles.system} aria-labelledby="workbench-tools-title"><h3 id="workbench-tools-title">系统与显示</h3><div>
      <button type="button" onClick={()=>onNavigate("monitoring")}><span>监控运行</span><b aria-hidden="true">↗</b></button>
      <button type="button" onClick={()=>onNavigate("ai")}><span>AI 状态</span><b aria-hidden="true">↗</b></button>
      <button type="button" onClick={()=>onNavigate("disliked")}><span>不感兴趣</span><b aria-hidden="true">↗</b></button>
      <button type="button" onClick={onToggleLanguage}><span>显示语言</span><small>{language==="zh"?"中文":"原文"}</small></button>
    </div></section>
  </section>;
}
