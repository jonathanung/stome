/**
 * How far a full-screen quick-capture sheet must move up to clear the keyboard.
 *
 * The phone sheet is the only caller. Wide layouts never mount it.
 */

function clampOverlap(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const rounded = Math.round(value);
  if (!Number.isFinite(max) || max <= 0) return rounded;
  return Math.min(rounded, Math.round(max));
}

/**
 * Native overlap of the keyboard with the bottom of a measured view.
 *
 * `frameY` and `keyboardScreenY` share screen coordinates. Expo's Android
 * window is edge-to-edge and does not shrink for the IME, so a full-screen
 * sheet overlaps the keyboard by its height. If the view's bottom is already
 * at or above the keyboard, the overlap is 0 and padding must not be added
 * again. A missing screen position falls back to the reported keyboard height.
 */
export function frameKeyboardOverlap(metrics: {
  frameY: number;
  frameHeight: number;
  keyboardScreenY: number;
  keyboardHeight?: number;
}): number {
  const { frameY, frameHeight, keyboardScreenY } = metrics;
  const keyboardHeight = metrics.keyboardHeight ?? 0;
  const frameKnown = Number.isFinite(frameY) && Number.isFinite(frameHeight) && frameHeight > 0;
  if (frameKnown && Number.isFinite(keyboardScreenY) && keyboardScreenY > 0) {
    return clampOverlap(frameY + frameHeight - keyboardScreenY, frameHeight);
  }
  return clampOverlap(keyboardHeight, frameKnown ? frameHeight : Number.POSITIVE_INFINITY);
}

/**
 * Browser chrome (the mobile URL bar) can make the visual viewport shorter
 * than the layout viewport without a keyboard. Phone keyboards are taller.
 */
export const WEB_KEYBOARD_MIN_PX = 120;

/**
 * Mobile web overlap. `position: fixed` stays in the layout viewport, and
 * react-native-web's KeyboardAvoidingView does not listen to visualViewport.
 *
 * A real keyboard shrinks `visualViewport` while `layoutHeight` (innerHeight)
 * stays put. Resizing the window shrinks both, so a short window is not
 * treated as a keyboard. `offsetTop` is a pan the browser already applied.
 */
export function visualViewportKeyboardOverlap(metrics: {
  layoutHeight: number;
  viewportHeight: number;
  viewportOffsetTop: number;
}): number {
  const { layoutHeight, viewportHeight, viewportOffsetTop } = metrics;
  if (!Number.isFinite(layoutHeight) || !Number.isFinite(viewportHeight)) return 0;
  const offset = Number.isFinite(viewportOffsetTop) ? viewportOffsetTop : 0;
  const overlap = layoutHeight - viewportHeight - offset;
  if (overlap < WEB_KEYBOARD_MIN_PX) return 0;
  return clampOverlap(overlap, layoutHeight);
}
