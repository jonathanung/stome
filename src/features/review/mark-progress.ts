import { orderReviewQueue } from './session.ts';

/**
 * A successful replay acknowledges the revision stored on that operation.
 * The note on screen counts as reviewed only when that is the revision
 * the person is looking at.
 */
export function displayedRevisionWasMarked(input: {
  displayedRevision: number;
  markedRevision: number | undefined;
}): boolean {
  return input.markedRevision === input.displayedRevision;
}

export function acknowledgeDisplayedCards<T extends { id: string }>(input: {
  cards: readonly T[];
  done: number;
  displayedId: string;
  displayedRevision: number;
  markedRevision: number | undefined;
}): { cards: T[]; done: number; reviewedDisplayedRevision: boolean } {
  const reviewedDisplayedRevision = displayedRevisionWasMarked({
    displayedRevision: input.displayedRevision,
    markedRevision: input.markedRevision,
  });
  if (!reviewedDisplayedRevision) {
    return { cards: [...input.cards], done: input.done, reviewedDisplayedRevision };
  }
  return {
    cards: input.cards.filter((card) => card.id !== input.displayedId),
    done: input.done + 1,
    reviewedDisplayedRevision,
  };
}

/** Opens on the requested note, or on a note whose lost mark is still held. */
export function reviewQueueOnOpen<T extends { id: string }>(input: {
  ready: readonly T[];
  all: readonly T[];
  startId: string | undefined;
  retainedIds: readonly string[];
}): T[] {
  const retainedId = input.retainedIds.find((id) => input.all.some((chunk) => chunk.id === id));
  return orderReviewQueue(input.ready, input.startId ?? retainedId, input.all);
}
