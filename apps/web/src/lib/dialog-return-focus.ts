export function captureDialogReturnFocus(fallback?: HTMLElement | null) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return fallback ?? null;
}

export function restoreDialogReturnFocus(target: HTMLElement | null) {
  if (!target?.isConnected) return;
  target.focus({ preventScroll: true });
}
