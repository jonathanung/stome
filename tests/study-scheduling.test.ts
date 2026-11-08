/**
 * STUDY.6 (#136): due scheduling reuses the REV.1 intervals, staleness is
 * read-time on source revision drift, and deletions never rewrite history.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit, type Commit } from '../src/data/commit.ts';
import {
  getStudyDeck,
  getStudyQuiz,
  isStudySourcesStale,
  listDueStudyCards,
  listDueStudyQuestions,
  listSlideOutlines,
  listStudyAttempts,
  listStudyAttemptsWithStaleness,
  listStudyCards,
  listStudyDecks,
  listStudyQuestions,
  listStudyQuizzes,
} from '../src/data/queries.ts';
import type { Db } from '../src/db/driver.ts';
import type { ReviewState } from '../src/db/schema.ts';
import { migrateDb } from '../src/db/migrate.ts';
import {
  dueAtForReviewState,
  isDue,
  isSameLocalDay,
  isStudyStale,
  localDayInZone,
  scoreAttempt,
  STUDY_DUE_MS,
} from '../src/features/study/scheduling.ts';
import { nodeDb } from './support/node-db.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function open(now: number) {
  const db = nodeDb();
  let clock = now;
  let id = 0;
  const commit = createCommit(db, { now: () => clock, newId: () => `id-${++id}` });
  return {
    db,
    commit,
    at(next: number) {
      clock = next;
    },
  };
}

type Harness = { db: Db; commit: Commit; at(next: number): void };

async function seedStudy(s: Harness, tag: string) {
  const room = await s.commit({
    opId: `room-${tag}`,
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: `biology ${tag}` },
  });
  assert.ok(room.ok);
  if (!room.ok) throw new Error('room.create failed');
  const roomId = room.value.roomId;
  const chunks = await s.commit({
    opId: `chunks-${tag}`,
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId, bodies: ['cells make energy', 'mitosis splits cells'] },
  });
  assert.ok(chunks.ok);
  if (!chunks.ok) throw new Error('chunk.create failed');
  const [first, second] = chunks.value.chunkIds;

  const deck = await s.commit({
    opId: `deck-${tag}`,
    kind: 'study.deck.create',
    source: 'human',
    confirmed: true,
    payload: { roomId, title: 'Cell basics', sourceChunkIds: [first!, second!], sourceRevision: 1 },
  });
  assert.ok(deck.ok);
  if (!deck.ok) throw new Error('study.deck.create failed');
  const deckId = deck.value.deckId;

  const cardIds: string[] = [];
  const cardSources = [[first!], [second!], [first!, second!]];
  for (let i = 0; i < cardSources.length; i += 1) {
    const card = await s.commit({
      opId: `card-${tag}-${i}`,
      kind: 'study.card.create',
      source: 'human',
      confirmed: true,
      payload: {
        deckId,
        roomId,
        front: `Front ${i}`,
        back: `Back ${i}`,
        sourceChunkIds: cardSources[i]!,
        sourceRevision: 1,
      },
    });
    assert.ok(card.ok);
    if (!card.ok) throw new Error('study.card.create failed');
    cardIds.push(card.value.cardId);
  }

  const quiz = await s.commit({
    opId: `quiz-${tag}`,
    kind: 'study.quiz.create',
    source: 'human',
    confirmed: true,
    payload: { roomId, title: 'Cell quiz', sourceChunkIds: [first!, second!], sourceRevision: 1 },
  });
  assert.ok(quiz.ok);
  if (!quiz.ok) throw new Error('study.quiz.create failed');
  const quizId = quiz.value.quizId;

  const questionIds: string[] = [];
  const questionSources = [[first!], [second!], [first!, second!]];
  for (let i = 0; i < questionSources.length; i += 1) {
    const question = await s.commit({
      opId: `question-${tag}-${i}`,
      kind: 'study.question.create',
      source: 'human',
      confirmed: true,
      payload: {
        quizId,
        roomId,
        kind: 'true_false',
        stem: `Statement ${i} is true.`,
        answer: 'true',
        sourceChunkIds: questionSources[i]!,
        sourceRevision: 1,
      },
    });
    assert.ok(question.ok);
    if (!question.ok) throw new Error('study.question.create failed');
    questionIds.push(question.value.questionId);
  }
  return { roomId, chunkIds: [first!, second!], deckId, cardIds, quizId, questionIds };
}

async function markChunk(s: Harness, chunkId: string, opId: string, state: ReviewState) {
  const saved = await s.commit({
    opId,
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId, state, timeZone: 'UTC' },
  });
  assert.ok(saved.ok);
  if (!saved.ok) throw new Error('review.mark failed');
  return saved;
}

/* ------------------------------------------------------------- pure rules */

test('due intervals reuse the REV.1 rule: missed 10m, unclear 24h, got_it 72h', () => {
  assert.deepEqual(STUDY_DUE_MS, { missed: 10 * MINUTE_MS, unclear: DAY_MS, got_it: 3 * DAY_MS });
  const markedAt = 1_000_000;
  assert.equal(dueAtForReviewState('missed', markedAt), markedAt + 10 * MINUTE_MS);
  assert.equal(dueAtForReviewState('unclear', markedAt), markedAt + DAY_MS);
  assert.equal(dueAtForReviewState('got_it', markedAt), markedAt + 3 * DAY_MS);
});

test('due lands exactly on the boundary: due_at <= now is due', () => {
  assert.equal(isDue(100, 100), true);
  assert.equal(isDue(99, 100), true);
  assert.equal(isDue(101, 100), false);
});

test('scoring rounds to one decimal', () => {
  assert.equal(scoreAttempt([{ questionId: 'a', correct: true }]).scorePct, 100);
  assert.equal(scoreAttempt([
    { questionId: 'a', correct: true },
    { questionId: 'b', correct: false },
    { questionId: 'c', correct: false },
    { questionId: 'd', correct: false },
    { questionId: 'e', correct: false },
    { questionId: 'f', correct: false },
  ]).scorePct, 16.7);
});

test('staleness trips on revision drift or a missing source', () => {
  const revisions = new Map([['a', 1], ['b', 2]]);
  assert.equal(isStudyStale(1, ['a'], revisions), false);
  assert.equal(isStudyStale(1, ['a', 'b'], revisions), true);
  assert.equal(isStudyStale(9, ['a'], revisions), true);
  assert.equal(isStudyStale(1, ['ghost'], revisions), true);
  assert.equal(isStudyStale(2, ['b'], revisions), false);
  assert.equal(isStudyStale(1, ['b'], revisions), true);
});

test('local days split at midnight, including across DST transitions', () => {
  // Ordinary midnight in New York (EDT, UTC-4).
  assert.equal(localDayInZone(Date.parse('2026-06-01T03:59:59Z'), 'America/New_York'), '2026-05-31');
  assert.equal(localDayInZone(Date.parse('2026-06-01T04:00:00Z'), 'America/New_York'), '2026-06-01');
  // Spring forward (2026-03-08): midnight still splits the day.
  assert.equal(localDayInZone(Date.parse('2026-03-08T04:59:59Z'), 'America/New_York'), '2026-03-07');
  assert.equal(localDayInZone(Date.parse('2026-03-08T05:00:00Z'), 'America/New_York'), '2026-03-08');
  // Fall back (2026-11-01): the repeated 01:30 hour stays one local day.
  assert.equal(localDayInZone(Date.parse('2026-11-01T05:30:00Z'), 'America/New_York'), '2026-11-01');
  assert.equal(localDayInZone(Date.parse('2026-11-01T06:30:00Z'), 'America/New_York'), '2026-11-01');
  assert.equal(
    isSameLocalDay(Date.parse('2026-11-01T05:30:00Z'), Date.parse('2026-11-01T06:30:00Z'), 'America/New_York'),
    true,
  );
  // The same instant can be a different day in another zone.
  assert.equal(
    isSameLocalDay(Date.parse('2026-06-01T00:30:00Z'), Date.parse('2026-05-31T23:30:00Z'), 'UTC'),
    false,
  );
  assert.equal(
    isSameLocalDay(Date.parse('2026-06-01T00:30:00Z'), Date.parse('2026-06-01T00:45:00Z'), 'UTC'),
    true,
  );
});

/* ------------------------------------------------------------ due queries */

test('new cards and questions are due before any rating, fresh first', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { deckId, quizId } = await seedStudy(s, 'fresh');
  const now = Date.parse('2026-11-07T18:00:00Z');

  const cards = await listDueStudyCards(s.db, deckId, now);
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => c.mark === null));
  assert.deepEqual(cards.map((c) => c.card.front), ['Front 0', 'Front 1', 'Front 2']);

  const questions = await listDueStudyQuestions(s.db, quizId, now);
  assert.equal(questions.length, 3);
  assert.ok(questions.every((q) => q.mark === null));
  assert.deepEqual(questions.map((q) => q.question.stem), [
    'Statement 0 is true.',
    'Statement 1 is true.',
    'Statement 2 is true.',
  ]);
});

test('each rating saves due time with its REV.1 interval', async () => {
  const cases = [
    { state: 'missed' as const, delay: 10 * MINUTE_MS },
    { state: 'unclear' as const, delay: DAY_MS },
    { state: 'got_it' as const, delay: 3 * DAY_MS },
  ];
  for (const [index, { state, delay }] of cases.entries()) {
    const markedAt = Date.parse('2026-11-07T18:00:00Z');
    const s = open(markedAt);
    await migrateDb(s.db);
    const { deckId, chunkIds } = await seedStudy(s, `due-${index}`);
    await markChunk(s, chunkIds[0]!, `mark-${index}`, state);

    const dueAt = markedAt + delay;
    assert.equal((await listDueStudyCards(s.db, deckId, dueAt - 1)).length, 2);
    const due = await listDueStudyCards(s.db, deckId, dueAt);
    assert.equal(due.length, 3);
    const rated = due.find((c) => c.card.front === 'Front 0');
    assert.equal(rated?.mark?.state, state);
    assert.equal(rated?.mark?.dueAt, dueAt);
  }
});

test('future marks exclude; superseded marks are ignored', async () => {
  const start = Date.parse('2026-11-07T18:00:00Z');
  const s = open(start);
  await migrateDb(s.db);
  const { deckId, quizId, chunkIds } = await seedStudy(s, 'sup');

  await markChunk(s, chunkIds[0]!, 'mark-missed', 'missed');
  s.at(start + DAY_MS);
  await markChunk(s, chunkIds[0]!, 'mark-gotit', 'got_it');

  // The older missed mark would be due at start + 10m, but it is superseded:
  // the next-day got_it mark keeps the card out until start + 24h + 72h.
  assert.equal((await listDueStudyCards(s.db, deckId, start + 11 * MINUTE_MS)).length, 2);
  assert.equal((await listDueStudyQuestions(s.db, quizId, start + 11 * MINUTE_MS)).length, 2);

  const dueAt = start + DAY_MS + 3 * DAY_MS;
  const cards = await listDueStudyCards(s.db, deckId, dueAt);
  assert.equal(cards.length, 3);
  assert.equal(cards.find((c) => c.card.front === 'Front 0')?.mark?.state, 'got_it');
});

test('a card is due when any source needs review; all-future sources exclude', async () => {
  const start = Date.parse('2026-11-07T18:00:00Z');
  const s = open(start);
  await migrateDb(s.db);
  const { deckId, chunkIds } = await seedStudy(s, 'multi');

  // Card 2 is grounded on both chunks. Rating one chunk still leaves it due
  // through the other, unrated source.
  await markChunk(s, chunkIds[0]!, 'mark-a', 'got_it');
  const partial = await listDueStudyCards(s.db, deckId, start + MINUTE_MS);
  assert.deepEqual(partial.map((c) => c.card.front), ['Front 1', 'Front 2']);

  // Once every source is rated into the future, nothing is due.
  s.at(start + MINUTE_MS);
  await markChunk(s, chunkIds[1]!, 'mark-b', 'got_it');
  assert.equal((await listDueStudyCards(s.db, deckId, start + 2 * MINUTE_MS)).length, 0);
});

/* ------------------------------------------------- staleness and deletion */

test('editing a source chunk flags derived rows stale with quotes preserved', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { roomId, chunkIds, deckId, quizId, questionIds } = await seedStudy(s, 'stale');

  const attempt = await s.commit({
    opId: 'attempt-1',
    kind: 'study.attempt.save',
    source: 'human',
    confirmed: true,
    payload: {
      quizId,
      roomId,
      ...scoreAttempt([
        { questionId: questionIds[0]!, correct: true },
        { questionId: questionIds[1]!, correct: true },
        { questionId: questionIds[2]!, correct: false },
      ]),
      results: [
        { questionId: questionIds[0]!, correct: true },
        { questionId: questionIds[1]!, correct: true },
        { questionId: questionIds[2]!, correct: false },
      ],
      durationMs: 60_000,
    },
  });
  assert.ok(attempt.ok);

  const before = await listStudyAttemptsWithStaleness(s.db, quizId);
  assert.equal(before.length, 1);
  assert.equal(before[0]?.stale, false);

  const edited = await s.commit({
    opId: 'chunk-edit',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: chunkIds[0], body: 'cells make energy, revised' },
  });
  assert.ok(edited.ok);

  // Stale rows leave the due queue but keep their content and scores.
  assert.equal(await isStudySourcesStale(s.db, [chunkIds[0]!, chunkIds[1]!], 1), true);
  assert.equal((await listDueStudyCards(s.db, deckId, Date.parse('2026-11-07T18:00:00Z'))).length, 1);
  assert.equal((await listDueStudyQuestions(s.db, quizId, Date.parse('2026-11-07T18:00:00Z'))).length, 1);

  const cards = await listStudyCards(s.db, deckId);
  assert.equal(cards.find((c) => c.front === 'Front 0')?.back, 'Back 0');

  const flagged = await listStudyAttemptsWithStaleness(s.db, quizId);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]?.stale, true);
  assert.deepEqual([flagged[0]?.attempt.scorePct, flagged[0]?.attempt.correct, flagged[0]?.attempt.total], [66.7, 2, 3]);
});

test('deleting a chunk flags dependents stale; deleting a room cascades', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { roomId, chunkIds, deckId, quizId, questionIds } = await seedStudy(s, 'del');

  const results = questionIds.map((questionId) => ({ questionId, correct: true }));
  const attempt = await s.commit({
    opId: 'attempt-1',
    kind: 'study.attempt.save',
    source: 'human',
    confirmed: true,
    payload: { quizId, roomId, ...scoreAttempt(results), results, durationMs: 1_000 },
  });
  assert.ok(attempt.ok);

  const deleted = await s.commit({
    opId: 'chunk-del',
    kind: 'chunk.delete',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: chunkIds[0]! },
  });
  assert.ok(deleted.ok);

  // The rows survive with their quotes, but read stale and leave the queue.
  assert.equal(await isStudySourcesStale(s.db, [chunkIds[0]!], 1), true);
  assert.equal((await listDueStudyCards(s.db, deckId, Date.parse('2026-11-07T18:00:00Z'))).length, 1);
  assert.equal((await listStudyCards(s.db, deckId)).length, 3);

  const removed = await s.commit({
    opId: 'room-del-op',
    kind: 'room.delete',
    source: 'human',
    confirmed: true,
    expectedRevision: 1,
    payload: { roomId },
  });
  assert.ok(removed.ok);

  assert.equal(await getStudyDeck(s.db, deckId), null);
  assert.equal(await getStudyQuiz(s.db, quizId), null);
  assert.deepEqual(await listStudyDecks(s.db, roomId), []);
  assert.deepEqual(await listStudyQuizzes(s.db, roomId), []);
  assert.deepEqual(await listStudyCards(s.db, deckId), []);
  assert.deepEqual(await listStudyQuestions(s.db, quizId), []);
  assert.deepEqual(await listStudyAttempts(s.db, quizId), []);
  assert.deepEqual(await listSlideOutlines(s.db, roomId), []);
});
