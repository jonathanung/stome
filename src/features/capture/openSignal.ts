/** Lets chrome outside QuickCapture (the sidebar's "Quick capture" button) open the panel. */
const listeners = new Set<() => void>();

export function requestCaptureOpen(): void {
  for (const listener of listeners) listener();
}

export function onCaptureOpenRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
