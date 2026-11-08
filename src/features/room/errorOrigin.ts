/**
 * The room shows one error line for both failed loads and failed actions.
 * A successful load clears only a load error, so the origin is tracked
 * explicitly — message text alone can collide between the two paths.
 */
export type ShownError = { origin: 'load' | 'action'; message: string } | null;

export function actionError(message: string | null): ShownError {
  return message === null ? null : { origin: 'action', message };
}

export function loadError(message: string): ShownError {
  return { origin: 'load', message };
}

/** A successful load clears its own error, never a newer action error. */
export function clearLoadError(showing: ShownError): ShownError {
  return showing?.origin === 'load' ? null : showing;
}
