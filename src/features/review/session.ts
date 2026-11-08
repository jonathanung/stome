/**
 * Review-session helpers. Writes stay in createCommit. A question is the
 * deterministic mock provider's answer and is not saved.
 */

import type { Operation } from '../../data/operations.ts';
import type { ReviewState } from '../../db/schema.ts';
import { HarnessError, TOOL_NAME, parseProposeOutput, type MockScenario } from '../../harness/contract.ts';
import { settleMockRequest } from '../../harness/provider.ts';

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

/**
 * A pinned answer waiting for review (#127, annotation-keyed due). `position`
 * is the anchor chunk's room position so answers interleave with notes.
 */
export type ReviewQueueAnswer = {
  id: string;
  annotationId: string;
  chunkId: string;
  position: number;
  answer: string;
  quote: string | null;
  chunkBody: string;
  chunkRevision: number;
  /** Carried so the card can show whether the saved passage still matches. */
  anchor: unknown;
  grounding: unknown;
};

/** One review card: a note or a pinned answer. */
export type ReviewCard =
  | { kind: 'chunk'; chunk: ReviewQueueChunk }
  | { kind: 'answer'; answer: ReviewQueueAnswer };

/** Stable identity of a card: the chunk id, or the annotation id for answers. */
export function reviewCardId(card: ReviewCard): string {
  return card.kind === 'answer' ? card.answer.id : card.chunk.id;
}

/**
 * The card a review link should open.
 *
 * A due answer replaces its chunk, so the card id is the annotation id.
 * Links that still carry the chunk id (Today used to) must land on that
 * answer. An unknown id opens the normal queue instead of a missing card.
 */
export function resolveReviewStartId(cards: readonly ReviewCard[], requested: string | undefined): string | undefined {
  if (!requested) return undefined;
  if (cards.some((card) => reviewCardId(card) === requested)) return requested;
  const replacement = cards.find((card) => card.kind === 'answer' && card.answer.chunkId === requested);
  return replacement ? reviewCardId(replacement) : undefined;
}

function cardKey(card: ReviewCard): string {
  return reviewCardId(card);
}

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

const REVIEW_QUESTION_PROMPT = 'What should you remember from this note?';

/**
 * Pinned `ai_answer` annotations with no mark, plus pins whose latest answer
 * mark is already due. Input order is kept (room annotations arrive in room
 * order). Other annotation types never review.
 */
export function answersReadyToReview<T extends { id: string; type: string }>(
  annotations: readonly T[],
  latestByAnnotation: ReadonlyMap<string, { dueAt: number }>,
  now: number,
): T[] {
  return annotations.filter((annotation) => {
    if (annotation.type !== 'ai_answer') return false;
    const mark = latestByAnnotation.get(annotation.id);
    return mark === undefined || mark.dueAt <= now;
  });
}

/**
 * Deterministic stand-in for the answer question, mirroring
 * `localReviewQuestion`. The same answer text always yields the same prompt.
 * An empty answer errors.
 */
export function mockAnswerQuestion(answer: { id: string; answer: string }):
  | { ok: true; question: string }
  | { ok: false; message: string } {
  const text = answer.answer.trim();
  if (!text) {
    return {
      ok: false,
      message: 'Could not make a question for this empty answer. You can mark it or skip to the next one.',
    };
  }
  return { ok: true, question: `What should you remember from this saved answer?\n\n${text}` };
}

/**
 * Ready notes and ready pinned answers as one queue (#127). A note whose
 * answer is due is hidden — the answer card replaces it — so one fact is
 * never due twice (annotation owns its `dueAt`). Room position order, then
 * id. A future due time stays off the session.
 */
export function reviewQueueForRoom(input: {
  chunks: readonly ReviewQueueChunk[];
  answers: readonly ReviewQueueAnswer[];
  latestByChunk: ReadonlyMap<string, { dueAt: number }>;
  latestByAnnotation: ReadonlyMap<string, { dueAt: number }>;
  now: number;
}): ReviewCard[] {
  const readyChunks = chunksReadyToReview(input.chunks, input.latestByChunk, input.now);
  const readyAnnotations = new Set(
    answersReadyToReview(
      input.answers.map((answer) => ({ id: answer.annotationId, type: 'ai_answer' as const })),
      input.latestByAnnotation,
      input.now,
    ).map((answer) => answer.id),
  );
  const answeredChunks = new Set(
    input.answers.filter((answer) => readyAnnotations.has(answer.annotationId)).map((answer) => answer.chunkId),
  );
  const cards: ReviewCard[] = [
    ...readyChunks
      .filter((chunk) => !answeredChunks.has(chunk.id))
      .map((chunk): ReviewCard => ({ kind: 'chunk', chunk })),
    ...input.answers
      .filter((answer) => readyAnnotations.has(answer.annotationId))
      .map((answer): ReviewCard => ({ kind: 'answer', answer })),
  ];
  cards.sort((left, right) => {
    const leftPosition = left.kind === 'answer' ? left.answer.position : left.chunk.position;
    const rightPosition = right.kind === 'answer' ? right.answer.position : right.chunk.position;
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    const leftKey = cardKey(left);
    const rightKey = cardKey(right);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
  return cards;
}

/**
 * Question for one note from the HAR.3 mock provider (`notes.proposeAnnotation`).
 * There is no review-question tool and no live model. The same chunk id and
 * trimmed text always settle to the same answer. A provider error is a message
 * the screen can skip or mark past.
 */
export function mockReviewQuestion(
  chunk: { id: string; roomId: string; body: string },
  scenario: MockScenario = 'success',
):
  | { ok: true; question: string }
  | { ok: false; message: string } {
  const text = chunk.body.trim();
  try {
    const output = settleMockRequest({
      tool: TOOL_NAME,
      scenario,
      input: {
        roomId: chunk.roomId,
        prompt: REVIEW_QUESTION_PROMPT,
        chunks: [{ id: chunk.id, roomId: chunk.roomId, text }],
        priorMessages: [],
      },
    });
    return { ok: true, question: parseProposeOutput(output).body };
  } catch (error) {
    if (text.length === 0) {
      return {
        ok: false,
        message: 'Could not make a question for this empty note. You can mark it or skip to the next one.',
      };
    }
    if (error instanceof HarnessError) return { ok: false, message: error.message };
    return {
      ok: false,
      message: 'Could not make a question for this note. You can mark it or skip to the next one.',
    };
  }
}

/** Unpaired review uses the same HAR.3 mock answer. It does not call a live model. */
export function localReviewQuestion(chunk: { id: string; body: string; roomId?: string }):
  | { ok: true; question: string }
  | { ok: false; message: string } {
  return mockReviewQuestion({ id: chunk.id, roomId: chunk.roomId ?? chunk.id, body: chunk.body });
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

/**
 * The answer mark (#127): a human mark of a pinned answer through the same
 * `review.mark` op. The annotation owns the due clock; the chunk revision on
 * screen is still checked and the room still earns the credit.
 */
export function reviewAnswerMarkOperation(input: {
  opId: string;
  chunkId: string;
  annotationId: string;
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
      annotationId: input.annotationId,
      state: input.state,
      timeZone: input.timeZone,
    },
  };
}
