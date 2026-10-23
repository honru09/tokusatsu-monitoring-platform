type PeriodicTaskOptions = {
  intervalMs: number;
  task: () => Promise<unknown>;
  onError: (error: unknown) => void;
};

/** A slow tick shares its current run; ticks never accumulate in a backlog. */
export function startPeriodicTask({ intervalMs, task, onError }: PeriodicTaskOptions) {
  let current: Promise<void> | undefined;
  let stopped = false;
  function run(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (current) return current;
    const operation = Promise.resolve().then(task).then(
      () => undefined,
      (error) => { onError(error); },
    );
    current = operation;
    const clear = () => { if (current === operation) current = undefined; };
    void operation.then(clear, clear);
    return operation;
  }
  const timer = setInterval(() => { void run(); }, intervalMs);
  timer.unref?.();
  return {
    run,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await current;
    },
  };
}
