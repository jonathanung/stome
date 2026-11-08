/**
 * STUDY.6 (#136): quiz scoring, due scheduling, and staleness.
 *
 * Pure functions only: no DB, no commits, no clock. These helpers give the
 * session UI and the query layer one shared reading of the study rules so a
 * passing typecheck cannot drift from what the tests pin:
 *
 * - Scoring derives `correct` / `total` / `scorePct` from per-question
 *   right/wrong, so callers never hand-assemble a mismatched attempt.
 * - Due reuses the REV.1 intervals verbatim (`missed` 10m, `unclear` 24h,
 *   `got_it` 72h). A rating is saved as a `review.mark` on the rated card's
 *   source chunk(s), which writes `due_at` with exactly this rule; the due
 *   queries in `src/data/queries.ts` then lift chunk due state onto
 *   cards/questions. Nothing here persists anything.
 * - Staleness is read-time: a derived row is stale when any source chunk is
 *   gone or its revision no longer equals the snapshot taken at generation.
 *   Stale rows are never due and never verified; saved scores are kept as-is
 *   and only flagged.
 * - Local days are computed with `Intl` in the caller's time zone, so
 *   midnight and DST transitions behave the same here as in `commit.ts`.
 */

import type { ReviewState } from '../../db/schema.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Spaced-repetition intervals for study ratings. Identical to the REV.1
 * `REVIEW_DUE_MS` rule in `src/data/commit.ts` by contract: a study rating
 * saves its due time through `review.mark`, which applies these same delays.
 */
export const STUDY_DUE_MS: Record<ReviewState, number> = {
  missed: 10 * MINUTE_MS,
  unclear: DAY_MS,
  got_it: 3 * DAY_MS,
};

/** `due_at` for a rating saved at `markedAt` under the REV.1 rule. */
export function dueAtForReviewState(state: ReviewState, markedAt: number): number {
  return markedAt + STUDY_DUE_MS[state];
}

/** A row whose latest `due_at` is at or before `now` is due. */
export function isDue(dueAt: number, now: number): boolean {
  return dueAt <= now;
}

export interface AttemptScore {
  correct: number;
  total: number;
  /** Percent correct, rounded to one decimal like the saved `score_pct`. */
  scorePct: number;
}

/**
 * Scores one quiz run from per-question right/wrong. The result feeds
 * `study.attempt.save` directly (`correct`, `total`, `scorePct`), so the
 * saved row can never disagree with its own `results`. An empty run scores
 * zero; `commit.ts` still requires `total >= 1` for a saved attempt.
 */
export function scoreAttempt(results: readonly { questionId: string; correct: boolean }[]): AttemptScore {
  let correct = 0;
  for (const result of results) {
    if (result.correct) correct += 1;
  }
  const total = results.length;
  const scorePct = total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
  return { correct, total, scorePct };
}

/**
 * A derived row (card, question, quiz, outline) is stale when any grounding
 * chunk is gone or its current revision no longer equals the snapshot taken
 * at generation. Missing sources and drift both flag stale; nothing is
 * rewritten, so the original quote stays preserved on the row.
 */
export function isStudyStale(
  savedRevision: number,
  sourceChunkIds: readonly string[],
  revisionByChunk: ReadonlyMap<string, number>,
): boolean {
  for (const id of sourceChunkIds) {
    if (revisionByChunk.get(id) !== savedRevision) return true;
  }
  return false;
}

/** Calendar day of `now` in `zone`, as YYYY-MM-DD. Mirrors `commit.ts`. */
export function localDayInZone(now: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('time zone must be a recognized IANA name');
  return `${year}-${month}-${day}`;
}

/**
 * Whether two instants fall on the same local day in `zone`. Same-day
 * repeats (re-ratings, replays) share a credit row instead of adding one,
 * even across a DST fold where one wall-clock hour happens twice.
 */
export function isSameLocalDay(a: number, b: number, zone: string): boolean {
  return localDayInZone(a, zone) === localDayInZone(b, zone);
}
