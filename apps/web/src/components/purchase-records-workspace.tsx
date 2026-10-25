"use client";

import React, { type ReactNode } from "react";
import { ContextInfo } from "./context-info";
import { LoadError } from "./load-error";
import { TERMS } from "../lib/terms";
import { friendlyImportError } from "../lib/import-helpers";

/**
 * The records tab of the merged 采购 workspace: link-based purchase
 * registration on top, then the bundle/record list. All state and
 * fetching stay in the dashboard (it polls the analyses and owns the
 * bundle editor dialogs); this component only renders what it is
 * handed, exactly like the block that used to sit inline in page.tsx.
 * The records panel itself is passed in as `recordsPanel` because it
 * shares the dashboard's purchase types.
 */
export type PurchaseLinkJobLike = {
  jobId: string;
  url: string;
  state: "queued" | "waiting" | "active" | "delayed" | "completed" | "failed";
  progress: number;
  item?: {
    titleZh?: string | null;
    titleRaw: string;
    product?: { titleZh?: string | null } | null;
  } | null;
  failedReason?: string | null;
  suggestedAmountYen?: number | null;
  suggestedAmountSource?: "actual" | "listing" | null;
};

export function PurchaseRecordsWorkspace({
  purchaseLinkInput,
  onPurchaseLinkInputChange,
  purchaseLinkUrlCount,
  purchaseLinkSubmitting,
  purchaseLinkMessage,
  purchaseLinkJobs,
  completedPurchaseJobCount,
  selectedPurchaseJobIds,
  onTogglePurchaseJob,
  onSubmitPurchaseLinks,
  onRegisterJob,
  onRegisterSelected,
  purchasesError,
  onRetryPurchases,
  onOpenOrdersTab,
  recordsPanel,
}: {
  purchaseLinkInput: string;
  onPurchaseLinkInputChange: (value: string) => void;
  purchaseLinkUrlCount: number;
  purchaseLinkSubmitting: boolean;
  purchaseLinkMessage: string;
  purchaseLinkJobs: readonly PurchaseLinkJobLike[];
  completedPurchaseJobCount: number;
  selectedPurchaseJobIds: readonly string[];
  onTogglePurchaseJob: (jobId: string) => void;
  onSubmitPurchaseLinks: () => Promise<void>;
  onRegisterJob: (jobId: string) => void;
  onRegisterSelected: () => void;
  purchasesError: string;
  onRetryPurchases: () => void;
  onOpenOrdersTab: () => void;
  recordsPanel: ReactNode;
}) {
  return (
    <div className="purchases-workspace">
      <section className="ios-surface workspace-surface mb-4 rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
        <>
          <div className="mb-4 border-b border-ink/8 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1">
                <h2 className="text-sm font-bold text-ink">
                  链接登记购买
                </h2>
                <ContextInfo
                  label="查看购买链接说明"
                  title="通过链接登记购买"
                >
                  <p>
                    粘贴公开商品链接后，后台只分析商品，不进入链接专区；分析结果会保存，刷新页面不会丢失。
                  </p>
                  <p className="mt-2">
                    已谈好价格时，可在链接后空格加实付金额（如
                    12800），登记时会自动预填，不用再改价。
                  </p>
                  <p className="mt-2">
                    多个链接完成后可登记为同一购买包，并填写打包价格。
                  </p>
                </ContextInfo>
              </div>
              {completedPurchaseJobCount > 0 && (
                <button
                  type="button"
                  onClick={onRegisterSelected}
                  className="min-h-11 rounded-full bg-moss px-5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  {selectedPurchaseJobIds.length > 1
                    ? `打包登记 · ${selectedPurchaseJobIds.length}`
                    : "登记购买"}
                </button>
              )}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <textarea
                value={purchaseLinkInput}
                onChange={(event) =>
                  onPurchaseLinkInputChange(event.target.value)
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    void onSubmitPurchaseLinks();
                  }
                }}
                rows={2}
                placeholder={
                  "每行一个商品链接，可在链接后空格加实付金额，如 12800\n一次最多 20 个"
                }
                aria-label="购买商品链接"
                className="min-h-[72px] resize-y rounded-xl border border-ink/10 bg-fog/55 px-3 py-2 text-sm leading-6 text-ink placeholder:text-ink/35"
              />
              <button
                type="button"
                disabled={
                  purchaseLinkSubmitting || purchaseLinkUrlCount === 0
                }
                onClick={() => void onSubmitPurchaseLinks()}
                className="min-h-11 rounded-xl bg-ink px-4 text-xs font-bold text-white disabled:opacity-40"
              >
                {purchaseLinkSubmitting ? "分析中…" : "分析链接"}
              </button>
            </div>
            {purchaseLinkMessage && (
              <p
                role="status"
                className="mt-2 text-xs font-semibold text-moss"
              >
                {purchaseLinkMessage}
              </p>
            )}
            {purchaseLinkJobs.length > 0 && (
              <div className="mt-3 grid gap-1.5">
                {purchaseLinkJobs.slice(0, 12).map((job) => {
                  const done = job.state === "completed" && job.item;
                  const failed = job.state === "failed";
                  const checked = selectedPurchaseJobIds.includes(
                    job.jobId,
                  );
                  return (
                    <div
                      key={job.jobId}
                      className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-fog/45 px-2 py-1.5"
                    >
                      {done ? (
                        <label className="grid h-11 w-11 place-items-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onTogglePurchaseJob(job.jobId)}
                            aria-label="选择加入购买包"
                            className="h-5 w-5 accent-moss"
                          />
                        </label>
                      ) : (
                        <span
                          aria-hidden="true"
                          className={`mx-auto h-2.5 w-2.5 rounded-full ${failed ? "bg-rust" : "bg-amber-500"}`}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-ink">
                          {job.item
                            ? (job.item.titleZh ??
                              job.item.product?.titleZh ??
                              job.item.titleRaw)
                            : job.url}
                        </p>
                        <p className="truncate text-[10px] text-meta">
                          {failed
                            ? friendlyImportError(job.failedReason)
                            : done
                              ? job.suggestedAmountYen != null
                                ? `分析完成，可登记 · ${job.suggestedAmountSource === "actual" ? "实付" : "挂牌"} ¥${job.suggestedAmountYen.toLocaleString("ja-JP")}`
                                : "分析完成，可登记"
                              : `${job.state === "active" ? "读取商品" : "等待分析"} · ${job.progress}%`}
                        </p>
                      </div>
                      {done ? (
                        <button
                          type="button"
                          onClick={() => onRegisterJob(job.jobId)}
                          className="min-h-11 rounded-xl bg-white px-3 text-xs font-semibold text-moss shadow-sm"
                        >
                          登记
                        </button>
                      ) : (
                        <span className="font-mono text-[10px] tabular-nums text-meta">
                          {job.progress}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      </section>
      <>
        <div className="purchases-next-step"><span>登记完成后，继续跟踪到货与库存。</span><button type="button" onClick={onOpenOrdersTab}>查看{TERMS.orders} <span aria-hidden="true">↗</span></button></div>
        {purchasesError && (
          <LoadError
            message={purchasesError}
            onRetry={onRetryPurchases}
            retryTestId="retry-purchases"
          />
        )}
        {recordsPanel}
      </>
    </div>
  );
}
