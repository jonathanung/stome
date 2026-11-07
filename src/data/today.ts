import type { DueChunk } from './models.ts';
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
