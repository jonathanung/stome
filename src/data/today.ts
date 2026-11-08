import type { DueAnswer, DueChunk, DueItem } from './models.ts';
import { isDueAnswer } from './models.ts';
import type { ReviewState } from '../db/schema.ts';

/** How many due chunks the Today list shows. */
export const TODAY_LIMIT = 10;

const STATE_ORDER: Record<ReviewState, number> = {
  missed: 0,
  unclear: 1,
  got_it: 2,
};

/**
 * Orders chunks that are already due: missed, then unclear, then got it.
 * Inside one state, the chunk that has been due longest comes first.
 * The list is rebuilt by the caller; this function does not read or write.
 */
export function planToday(due: readonly DueChunk[], limit = TODAY_LIMIT): DueChunk[] {
  return [...due]
    .sort((left, right) => {
      const byState = STATE_ORDER[left.mark.state] - STATE_ORDER[right.mark.state];
      if (byState !== 0) return byState;
      if (left.mark.dueAt !== right.mark.dueAt) return left.mark.dueAt - right.mark.dueAt;
      if (left.chunk.id < right.chunk.id) return -1;
      if (left.chunk.id > right.chunk.id) return 1;
      return 0;
    })
    .slice(0, limit);
}

function itemKey(item: DueItem): string {
  return isDueAnswer(item) ? `answer:${item.annotation.id}` : `chunk:${item.chunk.id}`;
}

/**
 * Orders due chunks and due pinned answers together (#127).
 *
 * Dedup ownership (annotation-keyed): a chunk whose answer is due is hidden —
 * the answer replaces its chunk — so one fact is never listed twice. The
 * chunk shows again once its answers are marked into the future.
 *
 * Unmarked answers (due since pinning) come first, oldest pin first; marked
 * items follow the chunk rule (missed, unclear, got it, longest due first).
 * Pure: does not read or write.
 *
 * Note: TodayScreen still calls `planToday` on chunks only; it adopts this
 * once #128 lands (kept out of this diff to avoid editing #128's files).
 */
export function planDueItems(due: readonly DueItem[], limit = TODAY_LIMIT): DueItem[] {
  const answeredChunks = new Set(
    due.filter(isDueAnswer).map((item) => item.chunk.id),
  );
  const kept = due.filter((item) => isDueAnswer(item) || !answeredChunks.has(item.chunk.id));
  const fresh = kept.filter(
    (item): item is DueAnswer => isDueAnswer(item) && item.mark === null,
  );
  const marked = kept.filter(
    (item): item is DueChunk | (DueAnswer & { mark: NonNullable<DueAnswer['mark']> }) =>
      !isDueAnswer(item) || item.mark !== null,
  );
  fresh.sort((left, right) =>
    left.annotation.createdAt !== right.annotation.createdAt
      ? left.annotation.createdAt - right.annotation.createdAt
      : itemKey(left) < itemKey(right) ? -1 : itemKey(left) > itemKey(right) ? 1 : 0,
  );
  marked.sort((left, right) => {
    const byState = STATE_ORDER[left.mark.state] - STATE_ORDER[right.mark.state];
    if (byState !== 0) return byState;
    if (left.mark.dueAt !== right.mark.dueAt) return left.mark.dueAt - right.mark.dueAt;
    const leftKey = itemKey(left);
    const rightKey = itemKey(right);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
  return [...fresh, ...marked].slice(0, limit);
}
