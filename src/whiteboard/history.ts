/** Undo stack for the shipped whiteboard. Pure: the screen keeps the refs in step. */

export function appendBoardHistory<T>(
  history: readonly T[],
  index: number,
  next: T,
  limit: number,
): { history: T[]; index: number } {
  const base = history.slice(0, Math.max(0, index) + 1);
  const updated = [...base, next].slice(-limit);
  return { history: updated, index: updated.length - 1 };
}
