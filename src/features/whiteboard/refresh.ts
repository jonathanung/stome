/**
 * Push/pull refresh for one room's board.
 *
 * Pull strokes with `loadBoard` in `session.ts` (read-only).
 * After a committed stroke create or delete, call `boardRefresh.notify(roomId)`.
 * `WhiteboardScreen` subscribes and reloads. A later preview can subscribe to
 * the same hook. This module does not know about AI tools.
 */

export interface BoardRefreshListener {
  (roomId: string): void;
}

export interface BoardRefreshHook {
  /** Listen for committed board changes. The returned function unsubscribes. */
  subscribe(listener: BoardRefreshListener): () => void;
  /** Tell listeners that `roomId`'s saved strokes changed. */
  notify(roomId: string): void;
}

const listeners = new Set<BoardRefreshListener>();

export function subscribeBoardRefresh(listener: BoardRefreshListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyBoardChanged(roomId: string): void {
  for (const listener of [...listeners]) listener(roomId);
}

export const boardRefresh: BoardRefreshHook = {
  subscribe: subscribeBoardRefresh,
  notify: notifyBoardChanged,
};
