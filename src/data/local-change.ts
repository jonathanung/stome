/**
 * The rooms sidebar reloads when the route changes. A rename or delete on the
 * rooms screen stays on the same route, so the sidebar would keep a room that
 * is already gone. Commits notify here after the transaction lands.
 */

const listeners = new Set<() => void>();

export function subscribeLocalChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyLocalChanges(): void {
  for (const listener of [...listeners]) listener();
}
