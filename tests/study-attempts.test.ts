/**
 * STUDY.6 (#136): quiz attempts save score history and cost no extra
 * credit on replay or same-day repeats.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit, type Commit } from '../src/data/commit.ts';
import type { Operation } from '../src/data/operations.ts';
import { getRoom, getStudyAttempt, listStudyAttempts } from '../src/data/queries.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { scoreAttempt } from '../src/features/study/scheduling.ts';
import { failOnWrite, nodeDb } from './support/node-db.ts';

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

async function seedRoom(s: Harness, bodies = ['cells make energy', 'mitosis splits cells']) {
  const room = await s.commit({
    opId: 'room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.ok(room.ok);
  if (!room.ok) throw new Error('room.create failed');
  const chunks = await s.commit({
    opId: 'chunks',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies },
  });
  assert.ok(chunks.ok);
  if (!chunks.ok) throw new Error('chunk.create failed');
  return { roomId: room.value.roomId, chunkIds: chunks.value.chunkIds };
}

async function seedDeck(s: Harness, roomId: string, chunkId: string, opId: string) {
  const deck = await s.commit({
    opId: `deck-${opId}`,
    kind: 'study.deck.create',
    source: 'human',
    confirmed: true,
    payload: { roomId, title: 'Cell basics', sourceChunkIds: [chunkId], sourceRevision: 1 },
  });
  assert.ok(deck.ok);
  if (!deck.ok) throw new Error('study.deck.create failed');
  const card = await s.commit({
    opId: `card-${opId}`,
    kind: 'study.card.create',
    source: 'human',
    confirmed: true,
    payload: {
      deckId: deck.value.deckId,
      roomId,
      front: 'Powerhouse?',
      back: 'Mitochondrion',
      sourceChunkIds: [chunkId],
      sourceRevision: 1,
    },
  });
  assert.ok(card.ok);
  if (!card.ok) throw new Error('study.card.create failed');
  return { deckId: deck.value.deckId, cardId: card.value.cardId };
}

async function seedQuiz(s: Harness, roomId: string, chunkId: string, opId: string) {
  const quiz = await s.commit({
    opId: `quiz-${opId}`,
    kind: 'study.quiz.create',
    source: 'human',
    confirmed: true,
    payload: { roomId, title: 'Cell quiz', sourceChunkIds: [chunkId], sourceRevision: 1 },
  });
  assert.ok(quiz.ok);
  if (!quiz.ok) throw new Error('study.quiz.create failed');
  const quizId = quiz.value.quizId;
  const questionIds: string[] = [];
  const stems: [string, string[], string][] = [
    ['Where is ATP made?', ['Nucleus', 'Mitochondrion'], 'Mitochondrion'],
    ['Which organelle divides the cell?', ['Ribosome', 'Mitochondrion'], 'Mitochondrion'],
  ];
  for (let i = 0; i < stems.length; i += 1) {
    const [stem, choices, answer] = stems[i]!;
    const saved = await s.commit({
      opId: `question-${opId}-${i}`,
      kind: 'study.question.create',
      source: 'human',
      confirmed: true,
      payload: {
        quizId,
        roomId,
        kind: 'mcq',
        stem,
        choices,
        answer,
        sourceChunkIds: [chunkId],
        sourceRevision: 1,
      },
    });
    assert.ok(saved.ok);
    if (!saved.ok) throw new Error('study.question.create failed');
    questionIds.push(saved.value.questionId);
  }
  return { quizId, questionIds };
}

/* ---------------------------------------------------------------- scoring */

test('scoring derives correct/total/scorePct from per-question results', () => {
  assert.deepEqual(scoreAttempt([
    { questionId: 'a', correct: true },
    { questionId: 'b', correct: true },
    { questionId: 'c', correct: true },
    { questionId: 'd', correct: true },
    { questionId: 'e', correct: false },
  ]), { correct: 4, total: 5, scorePct: 80 });
  assert.deepEqual(scoreAttempt([
    { questionId: 'a', correct: true },
    { questionId: 'b', correct: true },
    { questionId: 'c', correct: false },
  ]), { correct: 2, total: 3, scorePct: 66.7 });
  assert.deepEqual(scoreAttempt([
    { questionId: 'a', correct: false },
    { questionId: 'b', correct: false },
  ]), { correct: 0, total: 2, scorePct: 0 });
  assert.deepEqual(scoreAttempt([]), { correct: 0, total: 0, scorePct: 0 });
});

/* ------------------------------------------------------- attempts history */

test('completing a quiz saves one attempt with score, results, and duration', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { roomId, chunkIds } = await seedRoom(s);
  const { quizId, questionIds } = await seedQuiz(s, roomId, chunkIds[0]!, 'q1');
  const scored = scoreAttempt([
    { questionId: questionIds[0]!, correct: true },
    { questionId: questionIds[1]!, correct: false },
  ]);

  const saved = await s.commit({
    opId: 'attempt-1',
    kind: 'study.attempt.save',
    source: 'human',
    confirmed: true,
    payload: {
      quizId,
      roomId,
      ...scored,
      results: [
        { questionId: questionIds[0]!, correct: true },
        { questionId: questionIds[1]!, correct: false },
      ],
      durationMs: 90_000,
    },
  });
  assert.ok(saved.ok);
  if (!saved.ok) return;

  const attempt = await getStudyAttempt(s.db, saved.value.attemptId);
  assert.deepEqual(
    [attempt?.scorePct, attempt?.correct, attempt?.total, attempt?.durationMs],
    [50, 1, 2, 90_000],
  );
  assert.deepEqual(attempt?.results, [
    { questionId: questionIds[0], correct: true },
    { questionId: questionIds[1], correct: false },
  ]);
});

test('reload shows history in order and replaying an opId adds no row', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { roomId, chunkIds } = await seedRoom(s);
  const { quizId, questionIds } = await seedQuiz(s, roomId, chunkIds[0]!, 'q1');
  const results = [
    { questionId: questionIds[0]!, correct: true },
    { questionId: questionIds[1]!, correct: true },
  ];

  for (let i = 0; i < 3; i += 1) {
    s.at(Date.parse('2026-11-07T18:00:00Z') + i * 60_000);
    const saved = await s.commit({
      opId: `attempt-${i}`,
      kind: 'study.attempt.save',
      source: 'human',
      confirmed: true,
      payload: { quizId, roomId, ...scoreAttempt(results), results, durationMs: 1_000 * (i + 1) },
    });
    assert.ok(saved.ok);
  }

  const before = await listStudyAttempts(s.db, quizId);
  assert.deepEqual(before.map((a) => a.durationMs), [1_000, 2_000, 3_000]);

  const replayOp = {
    opId: 'attempt-1',
    kind: 'study.attempt.save',
    source: 'human',
    confirmed: true,
    payload: { quizId, roomId, ...scoreAttempt(results), results, durationMs: 9_999 },
  } as Operation<'study.attempt.save'>;
  const replay = await s.commit(replayOp);
  assert.ok(replay.ok);
  if (!replay.ok) return;
  assert.equal(replay.duplicate, true);

  const after = await listStudyAttempts(s.db, quizId);
  assert.equal(after.length, 3);
  assert.deepEqual(after.map((a) => a.durationMs), [1_000, 2_000, 3_000]);
});

/* -------------------------------------------------------------- permissions */

test('attempts need the allowed source: AI and import are forbidden, humans confirm', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { roomId, chunkIds } = await seedRoom(s);
  const { quizId, questionIds } = await seedQuiz(s, roomId, chunkIds[0]!, 'q1');
  const results = [
    { questionId: questionIds[0]!, correct: true },
    { questionId: questionIds[1]!, correct: false },
  ];
  const payload = { quizId, roomId, ...scoreAttempt(results), results, durationMs: 5_000 };

  const ai = await s.commit({ opId: 'ai-attempt', kind: 'study.attempt.save', source: 'ai', confirmed: true, payload });
  assert.ok(!ai.ok);
  if (ai.ok) return;
  assert.equal(ai.error.code, 'forbidden');

  const imp = await s.commit({ opId: 'imp-attempt', kind: 'study.attempt.save', source: 'import', confirmed: true, payload });
  assert.ok(!imp.ok);
  if (imp.ok) return;
  assert.equal(imp.error.code, 'forbidden');

  const unconfirmed = await s.commit({ opId: 'human-attempt', kind: 'study.attempt.save', source: 'human', confirmed: false, payload });
  assert.ok(!unconfirmed.ok);
  if (unconfirmed.ok) return;
  assert.equal(unconfirmed.error.code, 'unconfirmed');

  assert.equal((await listStudyAttempts(s.db, quizId)).length, 0);
});

test('a review.mark on a study card id is rejected: only chunks are markable', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { roomId, chunkIds } = await seedRoom(s);
  const { cardId } = await seedDeck(s, roomId, chunkIds[0]!, 'd1');

  const marked = await s.commit({
    opId: 'mark-card',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: cardId, state: 'got_it', timeZone: 'UTC' },
  });
  assert.ok(!marked.ok);
  if (marked.ok) return;
  assert.equal(marked.error.code, 'not_found');
});

/* ------------------------------------------------- same-day credit + crash */

test('a same-day re-rating replaces its row and adds no extra credit', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { chunkIds } = await seedRoom(s, ['one', 'two', 'three']);

  const first = await s.commit({
    opId: 'mark-a',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: chunkIds[0], state: 'missed', timeZone: 'UTC' },
  });
  assert.ok(first.ok);

  s.at(Date.parse('2026-11-07T18:05:00Z'));
  const second = await s.commit({
    opId: 'mark-a-again',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: chunkIds[0], state: 'got_it', timeZone: 'UTC' },
  });
  assert.ok(second.ok);

  const rows = await s.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks WHERE chunk_id = ?', [chunkIds[0]]);
  assert.equal(rows[0]?.n, 1);
  const credits = await s.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks');
  assert.equal(credits[0]?.n, 1);
});

test('a failed brick promotion rolls back the mark and the stage', async () => {
  const s = open(Date.parse('2026-11-07T18:00:00Z'));
  await migrateDb(s.db);
  const { roomId, chunkIds } = await seedRoom(s, ['one', 'two', 'three']);
  const mark = (chunkId: string, opId: string) => ({
    opId,
    kind: 'review.mark' as const,
    source: 'human' as const,
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId, state: 'got_it' as const, timeZone: 'UTC' },
  });
  assert.ok((await s.commit(mark(chunkIds[0]!, 'mark-0'))).ok);
  assert.ok((await s.commit(mark(chunkIds[1]!, 'mark-1'))).ok);
  assert.equal((await getRoom(s.db, roomId))?.stage, 'stonehenge');

  // The third mark would promote to brick: INSERT mark (write 1), then the
  // stage UPDATE (write 2). Crashing on write 2 must undo the mark too.
  const failing = createCommit(failOnWrite(s.db, 2), { now: () => Date.parse('2026-11-07T18:00:00Z'), newId: () => 'id-crash' });
  const crashed = await failing(mark(chunkIds[2]!, 'mark-2'));
  assert.ok(!crashed.ok);

  assert.equal((await s.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks')).at(0)?.n, 2);
  assert.equal((await getRoom(s.db, roomId))?.stage, 'stonehenge');

  // The opId was never consumed, so a retry commits and promotes.
  const retry = await s.commit(mark(chunkIds[2]!, 'mark-2'));
  assert.ok(retry.ok);
  if (!retry.ok) return;
  assert.equal(retry.value.stage, 'brick');
  assert.equal((await getRoom(s.db, roomId))?.stage, 'brick');
});
