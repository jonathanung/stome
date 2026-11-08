import type { CommitResult } from '../../data/operations.ts';
import type { ReviewState } from '../../db/schema.ts';
import { reviewAnswerMarkOperation, reviewMarkOperation } from './session.ts';

export type MarkAttempt = ReturnType<typeof reviewMarkOperation>;

type Saved = Extract<CommitResult<'review.mark'>, { ok: true }>;
type Rejected = Extract<CommitResult<'review.mark'>, { ok: false }>;

export type MarkOutcome =
  | { status: 'saved'; result: Saved; painted: boolean }
  | { status: 'rejected'; result: Rejected }
  | { status: 'ambiguous'; error: unknown }
  | { status: 'busy' }
  | { status: 'blocked'; attempt: MarkAttempt };

type MarkRequest = {
  chunkId: string;
  /** Present when the mark targets a pinned answer; the attempt is keyed by it. */
  annotationId?: string;
  state: ReviewState;
  expectedRevision: number;
};

function attemptKey(request: MarkRequest): string {
  return request.annotationId ?? request.chunkId;
}

/**
 * One frozen review.mark for a chunk — or for a pinned answer, keyed by its
 * annotation id. The same op id, time zone, revision,
 * and choice are reused when a commit succeeded but the response did not
 * come back, even if the note on screen has a newer revision. A different
 * choice waits. After that attempt is acknowledged or rejected, a later
 * mark is a new operation. The attempt lives in this JavaScript session;
 * a full reload drops it.
 */
export function createMarkController() {
  const retained = new Map<string, MarkAttempt>();
  const flights = new Map<string, Promise<MarkOutcome>>();
  const listeners = new Set<() => void>();
  let generation = 0;

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A refresh failure must not drop the write that just finished.
      }
    }
  }

  function invalidate(): number {
    generation += 1;
    return generation;
  }

  function submit(input: {
    newId: () => string;
    timeZone: () => string;
    commit: (attempt: MarkAttempt) => Promise<CommitResult<'review.mark'>>;
    request: MarkRequest;
    report: (result: Saved, attempt: MarkAttempt) => void;
  }): Promise<MarkOutcome> {
    const { request } = input;
    const key = attemptKey(request);
    if (flights.has(key)) return Promise.resolve({ status: 'busy' });

    const held = retained.get(key) ?? null;
    if (
      held &&
      (held.payload.state !== request.state || (held.payload.annotationId ?? held.payload.chunkId) !== (request.annotationId ?? request.chunkId))
    ) {
      return Promise.resolve({ status: 'blocked', attempt: held });
    }

    const attempt = held ?? freezeAttempt(request.annotationId === undefined
      ? reviewMarkOperation({
        opId: input.newId(),
        chunkId: request.chunkId,
        state: request.state,
        expectedRevision: request.expectedRevision,
        timeZone: input.timeZone(),
      })
      : reviewAnswerMarkOperation({
        opId: input.newId(),
        chunkId: request.chunkId,
        annotationId: request.annotationId,
        state: request.state,
        expectedRevision: request.expectedRevision,
        timeZone: input.timeZone(),
      }));
    if (!held) retained.set(key, attempt);

    const seen = generation;
    let settle!: (outcome: MarkOutcome) => void;
    const run = new Promise<MarkOutcome>((resolve) => {
      settle = resolve;
    });
    flights.set(key, run);

    void (async () => {
      try {
        const result = await input.commit(attempt);
        if (!result.ok) {
          retained.delete(key);
          settle({ status: 'rejected', result });
          return;
        }
        if (seen !== generation) {
          retained.delete(key);
          settle({ status: 'saved', result, painted: false });
          return;
        }
        try {
          input.report(result, attempt);
        } catch (error) {
          settle({ status: 'ambiguous', error });
          return;
        }
        retained.delete(key);
        settle({ status: 'saved', result, painted: true });
      } catch (error) {
        settle({ status: 'ambiguous', error });
      } finally {
        flights.delete(key);
        notify();
      }
    })();

    return run;
  }

  function requestLeave(navigate: () => void | Promise<void>): Promise<void> {
    invalidate();
    return Promise.all([...flights.values()]).then(() => navigate());
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    submit,
    requestLeave,
    invalidate,
    subscribe,
    generation: () => generation,
    retained: (key: string) => retained.get(key) ?? null,
  };
}

export const reviewMarkController = createMarkController();

function freezeAttempt(attempt: MarkAttempt): MarkAttempt {
  return Object.freeze({
    ...attempt,
    payload: Object.freeze({ ...attempt.payload }),
  });
}
