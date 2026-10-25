// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadError } from "./load-error";

describe("LoadError", () => {
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
  });

  function render(element: React.ReactElement) {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(element));
    return host;
  }

  it("renders the message as an alert with a retry action", () => {
    const onRetry = vi.fn();
    const view = render(
      <LoadError message="加载失败" onRetry={onRetry} retryTestId="retry-x" />,
    );
    const alert = view.querySelector('[data-testid="load-error"]');
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("加载失败");
    const button = view.querySelector<HTMLButtonElement>(
      '[data-testid="retry-x"]',
    );
    expect(button?.textContent).toBe("重试");
    act(() => button?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled retrying state while a retry is in flight", () => {
    const view = render(
      <LoadError
        message="加载失败"
        onRetry={() => {}}
        retrying
        retryTestId="retry-x"
      />,
    );
    const button = view.querySelector<HTMLButtonElement>(
      '[data-testid="retry-x"]',
    );
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toBe("重试中");
  });

  it("renders no retry button when no retry handler is given", () => {
    const view = render(<LoadError message="加载失败" retryTestId="retry-x" />);
    expect(view.querySelector('[data-testid="retry-x"]')).toBeNull();
    expect(view.querySelector('[data-testid="load-error"]')).not.toBeNull();
  });
});
