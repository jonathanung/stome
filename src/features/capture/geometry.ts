/**
 * Horizontal geometry for the floating Quick Capture layer.
 *
 * The panel hugs the right edge with a fixed inset and shrinks instead of
 * crossing the left edge on narrow viewports. Keeping this pure makes the
 * 320px case a test assertion rather than a CSS coincidence.
 */
export const CAPTURE_PANEL_MAX_WIDTH = 340;
export const CAPTURE_PANEL_INSET = 16;

export type CaptureLayerGeometry = {
  /** Rendered width of the panel and its capture button. */
  width: number;
  /** Distance from the viewport's left edge to the layer's left edge. */
  left: number;
  /** Distance from the layer's right edge to the viewport's right edge. */
  right: number;
};

export function captureLayerGeometry(
  viewportWidth: number,
  options: { maxWidth?: number; inset?: number } = {},
): CaptureLayerGeometry {
  const maxWidth = options.maxWidth ?? CAPTURE_PANEL_MAX_WIDTH;
  const inset = options.inset ?? CAPTURE_PANEL_INSET;

  // Server render and the first frame can report an unknown viewport. Keep the
  // panel visible at its intended width rather than collapsing it to nothing.
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return { width: maxWidth, left: 0, right: inset };
  }

  const width = Math.max(0, Math.min(maxWidth, viewportWidth - inset * 2));
  return { width, left: viewportWidth - inset - width, right: inset };
}
