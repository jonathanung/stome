/**
 * Pure review-session helpers. Writes stay in createCommit; this file only
 * decides which note to show and builds the human review.mark operation.
 */

import type { Operation } from '../../data/operations.ts';
import type { ReviewState } from '../../db/schema.ts';

export const REVIEW_LABEL: Record<ReviewState, string> = {
  missed: 'Missed',
  unclear: 'Unclear',
  got_it: 'Got it',
};

export type ReviewQueueChunk = {
  id: string;
  position: number;
  body: string;
  revision: number;
};

/** Room review route. `id` is the room id, matching `/rooms/[id]`. */
export function reviewHref(roomId: string, chunkId?: string): string {
  if (!chunkId) return `/rooms/${roomId}/review`;
  return `/rooms/${roomId}/review?chunk=${encodeURIComponent(chunkId)}`;
}

/**
 * Notes with no mark, plus notes whose latest mark is already due.
 * Room order, then id. A future due time stays off the session.
 */
export function chunksReadyToReview<T extends { id: string; position: number }>(
  chunks: readonly T[],
  latestByChunk: ReadonlyMap<string, { dueAt: number }>,
  now: number,
): T[] {
  return [...chunks]
    .filter((chunk) => {
      const mark = latestByChunk.get(chunk.id);
      return mark === undefined || mark.dueAt <= now;
    })
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/**
 * Start at `startId` when that note is in the room. Due and unreviewed notes
 * keep their order around it. An unknown id leaves the queue unchanged.
 */
export function orderReviewQueue<T extends { id: string }>(
  ready: readonly T[],
  startId: string | undefined,
  all: readonly T[],
): T[] {
  if (!startId) return [...ready];
  const index = ready.findIndex((chunk) => chunk.id === startId);
  if (index > 0) return [...ready.slice(index), ...ready.slice(0, index)];
  if (index === 0) return [...ready];
  const requested = all.find((chunk) => chunk.id === startId);
  return requested ? [requested, ...ready] : [...ready];
}

/**
 * Deterministic question from the note text. The harness mock provider has no
 * review-question tool, so this stays local and never calls a network.
 * An empty note is the error case; the session can still mark or skip it.
 */
export function mockReviewQuestion(chunk: { id: string; body: string }):
  | { ok: true; question: string }
  | { ok: false; message: string } {
  const text = chunk.body.trim();
  if (!text) {
    return {
      ok: false,
      message: 'Could not make a question for this empty note. You can mark it or skip to the next one.',
    };
  }
  return { ok: true, question: `What should you remember from this note?\n\n${text}` };
}

export function deviceTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && zone.trim() ? zone.trim() : 'UTC';
}

export function formatDueAt(dueAt: number): string {
  return new Date(dueAt).toLocaleString();
}

/** The only review write the screen sends: a human mark of the revision on screen. */
export function reviewMarkOperation(input: {
  opId: string;
  chunkId: string;
  state: ReviewState;
  expectedRevision: number;
  timeZone: string;
}): Operation<'review.mark'> {
  return {
    opId: input.opId,
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: input.expectedRevision,
    payload: {
      chunkId: input.chunkId,
      state: input.state,
      timeZone: input.timeZone,
    },
  };
}
