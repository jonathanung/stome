import type { CommitResult } from '../../data/operations.ts';
import type { ReviewState } from '../../db/schema.ts';
import { reviewMarkOperation } from './session.ts';

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
  state: ReviewState;
  expectedRevision: number;
};

/**
 * One frozen review.mark for a chunk. The same op id, time zone, revision,
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
    if (flights.has(request.chunkId)) return Promise.resolve({ status: 'busy' });

    const held = retained.get(request.chunkId) ?? null;
    if (
      held &&
      (held.payload.state !== request.state || held.payload.chunkId !== request.chunkId)
    ) {
      return Promise.resolve({ status: 'blocked', attempt: held });
    }

    const attempt = held ?? freezeAttempt(reviewMarkOperation({
      opId: input.newId(),
      chunkId: request.chunkId,
      state: request.state,
      expectedRevision: request.expectedRevision,
      timeZone: input.timeZone(),
    }));
    if (!held) retained.set(request.chunkId, attempt);

    const seen = generation;
    let settle!: (outcome: MarkOutcome) => void;
    const run = new Promise<MarkOutcome>((resolve) => {
      settle = resolve;
    });
    flights.set(request.chunkId, run);

    void (async () => {
      try {
        const result = await input.commit(attempt);
        if (!result.ok) {
          retained.delete(request.chunkId);
          settle({ status: 'rejected', result });
          return;
        }
        if (seen !== generation) {
          retained.delete(request.chunkId);
          settle({ status: 'saved', result, painted: false });
          return;
        }
        try {
          input.report(result, attempt);
        } catch (error) {
          settle({ status: 'ambiguous', error });
          return;
        }
        retained.delete(request.chunkId);
        settle({ status: 'saved', result, painted: true });
      } catch (error) {
        settle({ status: 'ambiguous', error });
      } finally {
        flights.delete(request.chunkId);
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
    retained: (chunkId: string) => retained.get(chunkId) ?? null,
  };
}

export const reviewMarkController = createMarkController();

function freezeAttempt(attempt: MarkAttempt): MarkAttempt {
  return Object.freeze({
    ...attempt,
    payload: Object.freeze({ ...attempt.payload }),
  });
}
