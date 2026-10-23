export function mobileViewportMetrics(input: {
  layoutHeight: number;
  visualHeight: number;
  visualTop: number;
  scale: number;
  editing: boolean;
  baselineHeight: number;
}) {
  const zoomed = Math.abs(input.scale - 1) > 0.05;
  const height = Math.max(1, input.visualHeight);
  const keyboardOpen =
    !zoomed &&
    input.editing &&
    Math.max(input.layoutHeight, input.baselineHeight) - height > 130;
  return {
    keyboardOpen,
    height: zoomed ? input.layoutHeight : height,
    top: zoomed ? 0 : Math.max(0, input.visualTop),
  };
}
