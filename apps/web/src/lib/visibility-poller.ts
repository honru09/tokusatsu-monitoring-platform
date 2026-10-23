export function boundedPollDelay(
  intervalMs: number,
  failureCount: number,
  maxBackoffMs: number,
) {
  const exponent = Math.max(0, Math.floor(failureCount));
  return Math.min(maxBackoffMs, intervalMs * 2 ** exponent);
}

type TimerHandle = ReturnType<typeof setTimeout>;

export type VisibilityPoller = {
  pause: () => void;
  resume: () => void;
  runNow: () => Promise<void>;
  start: (immediate?: boolean) => void;
  stop: () => void;
};

export function createVisibilityPoller({
  task,
  intervalMs,
  maxBackoffMs,
  isPaused = () => false,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
  onError,
}: {
  task: (signal: AbortSignal) => Promise<void>;
  intervalMs: number;
  maxBackoffMs: number;
  isPaused?: () => boolean;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
  onError?: (
    reason: unknown,
    failureCount: number,
    nextDelayMs: number,
  ) => void;
}): VisibilityPoller {
  let stopped = true;
  let timer: TimerHandle | null = null;
  let controller: AbortController | null = null;
  let inFlight: Promise<void> | null = null;
  let runAfterAbort = false;
  let failureCount = 0;

  const clearScheduled = () => {
    if (timer == null) return;
    clearTimer(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    clearScheduled();
    if (stopped || isPaused()) return;
    timer = setTimer(() => {
      timer = null;
      void runNow();
    }, delayMs);
  };

  const runNow = (): Promise<void> => {
    if (stopped || isPaused()) return Promise.resolve();
    clearScheduled();
    if (inFlight) return inFlight;

    const currentController = new AbortController();
    controller = currentController;
    inFlight = (async () => {
      let aborted = false;
      let succeeded = false;
      try {
        await task(currentController.signal);
        succeeded = true;
        failureCount = 0;
      } catch (reason) {
        aborted = currentController.signal.aborted;
        if (!aborted) {
          failureCount += 1;
          onError?.(
            reason,
            failureCount,
            boundedPollDelay(intervalMs, failureCount, maxBackoffMs),
          );
        }
      } finally {
        if (controller === currentController) controller = null;
        inFlight = null;

        if (stopped || isPaused()) {
          runAfterAbort = false;
          return;
        }
        if (runAfterAbort) {
          runAfterAbort = false;
          schedule(0);
          return;
        }
        schedule(
          succeeded || aborted
            ? intervalMs
            : boundedPollDelay(intervalMs, failureCount, maxBackoffMs),
        );
      }
    })();
    return inFlight;
  };

  return {
    start(immediate = true) {
      stopped = false;
      if (isPaused()) return;
      if (immediate) void runNow();
      else schedule(intervalMs);
    },
    pause() {
      clearScheduled();
      controller?.abort();
    },
    resume() {
      if (stopped || isPaused()) return;
      clearScheduled();
      if (inFlight) {
        if (controller?.signal.aborted) runAfterAbort = true;
        return;
      }
      void runNow();
    },
    runNow,
    stop() {
      stopped = true;
      runAfterAbort = false;
      clearScheduled();
      controller?.abort();
    },
  };
}
