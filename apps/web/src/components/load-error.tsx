"use client";

import React, { type ReactNode } from "react";

type LoadErrorProps = {
  message: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  retryTestId: string;
  /** Overrides the default quiet inline alert container styling. */
  className?: string;
  /**
   * Overrides the default retry button styling. Pass null for an
   * unstyled button (surfaces whose container class styles children).
   */
  actionClassName?: string | null;
};

/**
 * Shared load-failure state: an inline alert with a retry action, so a
 * failed fetch never renders as an empty list or an endless spinner.
 * Surfaces with their own alert styling pass className/actionClassName.
 */
export function LoadError({
  message,
  onRetry,
  retrying = false,
  retryTestId,
  className = "quiet-inline-alert mt-3",
  actionClassName,
}: LoadErrorProps) {
  return (
    <div role="alert" data-testid="load-error" className={className}>
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          data-testid={retryTestId}
          className={actionClassName === null ? undefined : (actionClassName ?? "quiet-inline-alert-action")}
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? "重试中" : "重试"}
        </button>
      )}
    </div>
  );
}
