/**
 * Lets the focused room reload after a global Quick Capture commit lands.
 * The capture panel owns the write; the room screen owns its visible state,
 * so the write has to announce itself the way `openSignal` does for opening.
 */
type CommitListener = (roomId: string) => void;

const listeners = new Set<CommitListener>();

/** Called after a chunk has been committed, with the room it landed in. */
export function announceCaptureCommit(roomId: string): void {
  for (const listener of listeners) listener(roomId);
}

export function onCaptureCommit(listener: CommitListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Reload `refresh` when a capture commits into `roomId`. A capture into
 * another room must not reload this one. Returns the unsubscribe.
 */
export function watchCaptureCommits(
  roomId: string | null,
  refresh: () => void,
): () => void {
  if (!roomId) return () => undefined;
  return onCaptureCommit((changed) => {
    if (changed === roomId) refresh();
  });
}
