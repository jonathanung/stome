/**
 * Lets the focused room reload after a global Quick Capture commit lands.
 * The capture panel owns the write; the room screen owns its visible state,
 * so the write has to announce itself the way `openSignal` does for opening.
 */
import type { Operation } from '../../data/operations.ts';
import type { SaveResult } from './session.ts';

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
 * Commit a quick capture, then announce the room it landed in. This is the
 * production path QuickCapture uses, so tests can drive the same wiring.
 */
export async function commitCapture(
  operation: Operation<'chunk.create'>,
  commit: (operation: Operation<'chunk.create'>) => Promise<SaveResult>,
): Promise<SaveResult> {
  try {
    const result = await commit(operation);
    if (!result.ok) return result;
    announceCaptureCommit(operation.payload.roomId);
    return result;
  } catch (reason) {
    return { ok: false, message: reason instanceof Error && reason.message ? reason.message : 'Could not save' };
  }
}

/**
 * Reload `refresh` when a capture commits into `roomId`. A capture into
 * another room must not reload this one. The room's refresh reports its own
 * failures and applies only the newest read; the final catch just keeps a
 * rejected refresh from becoming an unhandled rejection.
 */
export function watchRoomCaptureRefresh(
  roomId: string | null,
  refresh: () => Promise<void>,
): () => void {
  if (!roomId) return () => undefined;
  return onCaptureCommit((changed) => {
    if (changed !== roomId) return;
    void refresh().catch(() => undefined);
  });
}
