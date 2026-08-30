"use client";

import { useCallback, useEffect, useState } from "react";

type AiSystemData = {
  configured: boolean;
  provider: string;
  models: Array<{
    model: string;
    role: string;
    status: string;
    callsToday: number;
    inputTokensToday: number;
    outputTokensToday: number;
    consecutiveFailures: number;
    lastErrorCode?: string | null;
  }>;
  tasks: Array<{ task: string; status: string; count: number }>;
  errors: Array<{
    id: string;
    task: string;
    requestedModel: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    startedAt: string;
  }>;
  cacheEntries: number;
  backlogs: { translation: number; review: number };
  latestBriefs: Array<{
    id: string;
    period: string;
    model: string;
    result: Record<string, unknown>;
    createdAt: string;
  }>;
  generatedAt: string;
};

const statusText: Record<string, string> = {
  online: "在线",
  ready: "待调用",
  degraded: "已降级",
  unavailable: "不可用 · 已跳过",
  not_configured: "未配置",
};

const taskText: Record<string, string> = {
  bulk_filter: "商品初筛",
  translation: "完整翻译",
  classification: "结构化分类",
  image_analysis: "图片分析",
  seller_analysis: "卖家画像",
  complex_analysis: "高级判断",
  cross_validation: "交叉审核",
  market_analysis: "市场分析",
  crawler_diagnosis: "爬虫诊断",
};

function list(value: unknown) {
  return Array.isArray(value)
    ? value.filter((row) => typeof row === "string")
    : [];
}

export function AiSystemWorkspace({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [data, setData] = useState<AiSystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Record<string, unknown> | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/ai/system`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`AI System ${response.status}`);
      setData((await response.json()) as AiSystemData);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "AI System 暂时不可用",
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => void load(), [load]);

  async function diagnose() {
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const response = await fetch(`${apiBaseUrl}/ai/system/diagnose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(`诊断失败（${response.status}）`);
      const payload = (await response.json()) as {
        data?: Record<string, unknown>;
      };
      setDiagnosis(payload.data ?? payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "诊断失败");
    } finally {
      setDiagnosing(false);
    }
  }

  const calls =
    data?.models.reduce((sum, model) => sum + model.callsToday, 0) ?? 0;
  const tokens =
    data?.models.reduce(
      (sum, model) => sum + model.inputTokensToday + model.outputTokensToday,
      0,
    ) ?? 0;

  return (
    <section
      className="mx-auto max-w-6xl pb-8"
      aria-labelledby="ai-system-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-moss">
            AI Gateway
          </p>
          <h2
            id="ai-system-title"
            className="mt-1 text-2xl font-bold tracking-tight text-ink"
          >
            AI System
          </h2>
          <p className="mt-1 text-sm text-ink/55">
            路由、缓存、回退与审计集中在后端。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void diagnose()}
            disabled={diagnosing || !data?.configured}
            className="min-h-11 rounded-xl border border-ink/10 bg-white/75 px-4 text-xs font-semibold text-ink shadow-sm disabled:opacity-40"
          >
            {diagnosing ? "诊断中…" : "诊断"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="min-h-11 rounded-xl bg-ink px-4 text-xs font-semibold text-white disabled:opacity-40"
          >
            刷新
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {loading && !data && (
        <div className="mt-5 h-44 animate-pulse rounded-3xl bg-white/60" />
      )}
      {data && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [data.configured ? "已连接" : "未配置", data.provider],
              [calls.toLocaleString(), "今日调用"],
              [tokens.toLocaleString(), "今日 Token"],
              [data.cacheEntries.toLocaleString(), "有效缓存"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-2xl border border-white/70 bg-white/65 p-3 shadow-sm backdrop-blur-xl"
              >
                <div className="text-lg font-bold text-ink">{value}</div>
                <div className="mt-1 text-[11px] text-ink/45">{label}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.3fr_.7fr]">
            <section className="min-w-0 rounded-3xl border border-white/70 bg-white/65 p-3 shadow-sm backdrop-blur-xl">
              <h3 className="px-1 text-sm font-semibold text-ink">模型状态</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {data.models.map((model) => (
                  <article
                    key={model.model}
                    className="min-w-0 rounded-2xl bg-white/80 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div
                          className="truncate text-xs font-semibold text-ink"
                          title={model.model}
                        >
                          {model.model}
                        </div>
                        <div className="mt-1 text-[11px] text-ink/45">
                          {model.role}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${model.status === "online" ? "bg-emerald-50 text-emerald-700" : model.status === "unavailable" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}
                      >
                        {statusText[model.status] ?? model.status}
                      </span>
                    </div>
                    <div className="mt-3 flex gap-3 text-[10px] text-ink/45">
                      <span>{model.callsToday} 次</span>
                      <span>
                        {(
                          model.inputTokensToday + model.outputTokensToday
                        ).toLocaleString()}{" "}
                        token
                      </span>
                      {model.lastErrorCode && (
                        <span className="truncate">{model.lastErrorCode}</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="min-w-0 rounded-3xl border border-white/70 bg-white/65 p-4 shadow-sm backdrop-blur-xl">
              <h3 className="text-sm font-semibold text-ink">任务与积压</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white/80 p-3">
                  <div className="text-xl font-bold">
                    {data.backlogs.translation}
                  </div>
                  <div className="text-[11px] text-ink/45">待完整翻译</div>
                </div>
                <div className="rounded-2xl bg-white/80 p-3">
                  <div className="text-xl font-bold">
                    {data.backlogs.review}
                  </div>
                  <div className="text-[11px] text-ink/45">待人工复核</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {data.tasks.slice(0, 12).map((task, index) => (
                  <div
                    key={`${task.task}-${task.status}-${index}`}
                    className="flex items-center justify-between rounded-xl bg-white/65 px-3 py-2 text-xs"
                  >
                    <span>{taskText[task.task] ?? task.task}</span>
                    <span className="font-mono text-ink/45">
                      {task.status} · {task.count}
                    </span>
                  </div>
                ))}
                {!data.tasks.length && (
                  <p className="py-5 text-center text-xs text-ink/40">
                    今日暂无调用
                  </p>
                )}
              </div>
            </section>
          </div>

          {data.latestBriefs.length > 0 && (
            <section className="mt-3 rounded-3xl border border-white/70 bg-white/65 p-4 shadow-sm backdrop-blur-xl">
              <h3 className="text-sm font-semibold text-ink">市场记忆</h3>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {data.latestBriefs.map((brief) => (
                  <article
                    key={brief.id}
                    className="rounded-2xl bg-white/80 p-3"
                  >
                    <div className="flex justify-between gap-2 text-xs font-semibold">
                      <span>{brief.period}</span>
                      <span className="truncate text-[10px] text-ink/40">
                        {brief.model}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-ink/65">
                      {[
                        ...list(brief.result.facts),
                        ...list(brief.result.actions),
                      ]
                        .slice(0, 4)
                        .map((row, index) => (
                          <li key={index}>• {row}</li>
                        ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          )}

          {(data.errors.length > 0 || diagnosis) && (
            <section className="mt-3 rounded-3xl border border-white/70 bg-white/65 p-4 shadow-sm backdrop-blur-xl">
              <h3 className="text-sm font-semibold text-ink">异常与诊断</h3>
              {diagnosis && (
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl bg-ink p-3 text-[11px] leading-5 text-white">
                  {JSON.stringify(diagnosis, null, 2)}
                </pre>
              )}
              <div className="mt-3 space-y-2">
                {data.errors.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl bg-white/80 p-3 text-xs"
                  >
                    <div className="flex justify-between gap-2 font-semibold">
                      <span>{taskText[entry.task] ?? entry.task}</span>
                      <span className="text-red-600">
                        {entry.errorCode ?? "PROVIDER_ERROR"}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-ink/45">
                      {entry.requestedModel} · {entry.errorMessage}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
