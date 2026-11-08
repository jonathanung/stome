import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit, type CommitDeps } from '../src/data/commit.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import {
  getRoom,
  getSlideOutline,
  getStudyDeck,
  getStudyQuiz,
  listChunks,
  listSlideOutlines,
  listStudyAttempts,
  listStudyCards,
  listStudyDecks,
  listStudyQuestions,
  listStudyQuizzes,
} from '../src/data/queries.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

function testDeps(): CommitDeps {
  let id = 0;
  let clock = 1_000;
  return { newId: () => `id-${++id}`, now: () => (clock += 10) };
}

async function setup() {
  const db = nodeDb();
  await migrateDb(db);
  const deps = testDeps();
  let op = 0;
  const commit = createCommit(db, deps);
  const op$ = <K extends OpKind>(kind: K, payload: Payloads[K], extra: Partial<Operation<K>> = {}): Operation<K> =>
    ({ opId: `op-${++op}`, kind, payload, source: 'human', confirmed: false, ...extra }) as Operation<K>;
  return { db, deps, commit, op: op$ };
}

async function seeded(s: Awaited<ReturnType<typeof setup>>) {
  const room = await s.commit(s.op('room.create', { name: 'biology' }));
  assert.ok(room.ok);
  const roomId = room.value.roomId;
  const chunks = await s.commit(s.op('chunk.create', { roomId, bodies: ['cells make energy', 'mitosis splits cells'] }));
  assert.ok(chunks.ok);
  const [first, second] = chunks.value.chunkIds;
  return { roomId, first: first!, second: second! };
}

const count = async (db: Db, table: string) => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

const confirmed = { confirmed: true } as const;

/* ---------------------------------------------------- create + read */

test('a deck, cards, quiz, questions, attempt and outline round-trip with provenance', async () => {
  const s = await setup();
  const { roomId, first, second } = await seeded(s);
  const sources = { sourceChunkIds: [first, second], sourceRevision: 1 };

  const deck = await s.commit(s.op('study.deck.create', { roomId, title: 'Cell basics', ...sources }, { ...confirmed }));
  assert.ok(deck.ok);
  assert.match(deck.value.deckId, /^id-\d+$/);
  const deckId = deck.value.deckId;

  const cardOne = await s.commit(s.op('study.card.create', { deckId, roomId, front: 'Powerhouse?', back: 'Mitochondrion', ...sources }, { ...confirmed }));
  const cardTwo = await s.commit(s.op('study.card.create', { deckId, roomId, front: 'Mitosis result?', back: 'Two cells', position: 0, ...sources }, { ...confirmed }));
  assert.ok(cardOne.ok && cardTwo.ok);

  // An explicit position inserts; the default appends.
  assert.deepEqual((await listStudyCards(s.db, deckId)).map((c) => c.front), ['Mitosis result?', 'Powerhouse?']);

  const quiz = await s.commit(s.op('study.quiz.create', { roomId, title: 'Cell quiz', ...sources }, { ...confirmed }));
  assert.ok(quiz.ok);
  const quizId = quiz.value.quizId;

  const mcq = await s.commit(s.op('study.question.create', {
    quizId, roomId, kind: 'mcq', stem: 'Where is ATP made?', choices: ['Nucleus', 'Mitochondrion'], answer: 'Mitochondrion', explanation: 'Glycolysis context', ...sources,
  }, { ...confirmed }));
  const tf = await s.commit(s.op('study.question.create', {
    quizId, roomId, kind: 'true_false', stem: 'Mitosis makes two cells.', answer: 'true', ...sources,
  }, { ...confirmed }));
  const fill = await s.commit(s.op('study.question.create', {
    quizId, roomId, kind: 'fill', stem: 'The powerhouse is the ___.', answer: 'mitochondrion', ...sources,
  }, { ...confirmed }));
  assert.ok(mcq.ok && tf.ok && fill.ok);

  const attempt = await s.commit(s.op('study.attempt.save', {
    quizId, roomId, scorePct: 66.6, correct: 2, total: 3,
    results: [
      { questionId: mcq.value.questionId, correct: true },
      { questionId: tf.value.questionId, correct: true },
      { questionId: fill.value.questionId, correct: false },
    ],
    durationMs: 90_000,
  }, { ...confirmed }));
  assert.ok(attempt.ok);

  const outline = await s.commit(s.op('study.slide-outline.create', {
    roomId,
    title: 'Cells in five slides',
    slides: [
      { title: 'Energy', bullets: ['ATP', 'Mitochondria'], notes: 'Say it slowly', sourceChunkIds: [first], sourceRevision: 1 },
      { title: 'Division', bullets: ['Mitosis'], notes: '', sourceChunkIds: [second], sourceRevision: 1 },
    ],
    ...sources,
  }, { ...confirmed }));
  assert.ok(outline.ok);

  const [savedDeck] = await listStudyDecks(s.db, roomId);
  assert.deepEqual([savedDeck?.title, savedDeck?.sourceChunkIds, savedDeck?.sourceRevision], ['Cell basics', [first, second], 1]);
  assert.deepEqual(await getStudyDeck(s.db, deckId), savedDeck);

  const [savedQuiz] = await listStudyQuizzes(s.db, roomId);
  assert.equal(savedQuiz?.title, 'Cell quiz');
  assert.deepEqual(await getStudyQuiz(s.db, quizId), savedQuiz);

  assert.deepEqual(
    (await listStudyQuestions(s.db, quizId)).map((q) => [q.kind, q.stem, q.choices, q.answer, q.explanation]),
    [
      ['mcq', 'Where is ATP made?', ['Nucleus', 'Mitochondrion'], 'Mitochondrion', 'Glycolysis context'],
      ['true_false', 'Mitosis makes two cells.', [], 'true', ''],
      ['fill', 'The powerhouse is the ___.', [], 'mitochondrion', ''],
    ],
  );

  const [savedAttempt] = await listStudyAttempts(s.db, quizId);
  assert.deepEqual(
    [savedAttempt?.scorePct, savedAttempt?.correct, savedAttempt?.total, savedAttempt?.durationMs],
    [66.6, 2, 3, 90_000],
  );
  assert.equal(savedAttempt?.results.length, 3);

  const [savedOutline] = await listSlideOutlines(s.db, roomId);
  assert.equal(savedOutline?.slides.length, 2);
  assert.deepEqual(savedOutline?.slides[0], {
    title: 'Energy', bullets: ['ATP', 'Mitochondria'], notes: 'Say it slowly', sourceChunkIds: [first], sourceRevision: 1,
  });
  assert.deepEqual(await getSlideOutline(s.db, outline.value.outlineId), savedOutline);
});

/* ------------------------------------------ confirmation + permission */

test('study writes need confirmation; import is forbidden, AI attempts are forbidden', async () => {
  const s = await setup();
  const { roomId, first } = await seeded(s);
  const sources = { sourceChunkIds: [first], sourceRevision: 1 };

  const unconfirmed = await s.commit(s.op('study.deck.create', { roomId, title: 'Draft', ...sources }));
  assert.ok(!unconfirmed.ok);
  assert.equal(unconfirmed.error.code, 'unconfirmed');
  assert.equal(await count(s.db, 'study_decks'), 0);

  const imported = await s.commit(
    s.op('study.deck.create', { roomId, title: 'Import', ...sources }, { source: 'import', confirmed: true }),
  );
  assert.ok(!imported.ok);
  assert.equal(imported.error.code, 'forbidden');

  const aiQuiz = await s.commit(
    s.op('study.quiz.create', { roomId, title: 'AI quiz', ...sources }, { source: 'ai', confirmed: true }),
  );
  assert.ok(aiQuiz.ok);

  const aiUnconfirmed = await s.commit(
    s.op('study.quiz.create', { roomId, title: 'AI draft', ...sources }, { source: 'ai' }),
  );
  assert.ok(!aiUnconfirmed.ok);
  assert.equal(aiUnconfirmed.error.code, 'unconfirmed');

  if (aiQuiz.ok) {
    const aiAttempt = await s.commit(
      s.op('study.attempt.save', {
        quizId: aiQuiz.value.quizId, roomId, scorePct: 100, correct: 0, total: 1,
        results: [{ questionId: 'q', correct: true }], durationMs: 0,
      }, { source: 'ai', confirmed: true }),
    );
    assert.ok(!aiAttempt.ok);
    assert.equal(aiAttempt.error.code, 'forbidden');
  }
  assert.equal(await count(s.db, 'study_quizzes'), 1);
});

/* ------------------------------------------------- scope + references */

test('cross-room sources and missing parents are rejected without writes', async () => {
  const s = await setup();
  const left = await seeded(s);
  const other = await s.commit(s.op('room.create', { name: 'chemistry' }));
  assert.ok(other.ok);
  const otherChunks = await s.commit(s.op('chunk.create', { roomId: other.value.roomId, bodies: ['acids'] }));
  assert.ok(otherChunks.ok);
  const foreign = otherChunks.value.chunkIds[0]!;

  const deck = await s.commit(
    s.op('study.deck.create', { roomId: left.roomId, title: 'Mixed', sourceChunkIds: [left.first, foreign], sourceRevision: 1 }, { ...confirmed }),
  );
  assert.ok(!deck.ok);
  assert.equal(deck.error.code, 'invalid');

  const ghost = await s.commit(
    s.op('study.deck.create', { roomId: left.roomId, title: 'Ghost', sourceChunkIds: ['nope'], sourceRevision: 1 }, { ...confirmed }),
  );
  assert.ok(!ghost.ok);
  assert.equal(ghost.error.code, 'not_found');

  const orphan = await s.commit(
    s.op('study.card.create', { deckId: 'nope', roomId: left.roomId, front: 'f', back: 'b', sourceChunkIds: [left.first], sourceRevision: 1 }, { ...confirmed }),
  );
  assert.ok(!orphan.ok);
  assert.equal(orphan.error.code, 'not_found');

  const real = await s.commit(
    s.op('study.deck.create', { roomId: other.value.roomId, title: 'Chem deck', sourceChunkIds: [foreign], sourceRevision: 1 }, { ...confirmed }),
  );
  assert.ok(real.ok);
  const misplaced = await s.commit(
    s.op('study.card.create', { deckId: real.value.deckId, roomId: left.roomId, front: 'f', back: 'b', sourceChunkIds: [left.first], sourceRevision: 1 }, { ...confirmed }),
  );
  assert.ok(!misplaced.ok);
  assert.equal(misplaced.error.code, 'invalid');

  const quiz = await s.commit(
    s.op('study.quiz.create', { roomId: left.roomId, title: 'Q', sourceChunkIds: [left.first], sourceRevision: 1 }, { ...confirmed }),
  );
  assert.ok(quiz.ok);
  const strayAnswer = await s.commit(
    s.op('study.attempt.save', {
      quizId: quiz.value.quizId, roomId: left.roomId, scorePct: 0, correct: 0, total: 1,
      results: [{ questionId: 'nope', correct: false }], durationMs: 0,
    }, { ...confirmed }),
  );
  assert.ok(!strayAnswer.ok);
  assert.equal(strayAnswer.error.code, 'not_found');

  assert.equal(await count(s.db, 'study_decks'), 1);
  assert.equal(await count(s.db, 'study_cards'), 0);
  assert.equal(await count(s.db, 'study_attempts'), 0);
  // Library queries never leak another room's rows.
  assert.deepEqual(await listStudyDecks(s.db, left.roomId), []);
  assert.equal((await listStudyDecks(s.db, other.value.roomId)).length, 1);
});

/* --------------------------------------- idempotency + stale revision */

test('replaying an op id returns the first result without new rows', async () => {
  const s = await setup();
  const { roomId, first } = await seeded(s);
  const deckOp = s.op('study.deck.create', { roomId, title: 'Replay', sourceChunkIds: [first], sourceRevision: 1 }, { ...confirmed });
  const firstWrite = await s.commit(deckOp);
  assert.ok(firstWrite.ok && !firstWrite.duplicate);
  const replay = await s.commit(deckOp);
  assert.ok(replay.ok && replay.duplicate);
  assert.deepEqual(replay.value, firstWrite.value);
  assert.equal(await count(s.db, 'study_decks'), 1);
  assert.equal(await count(s.db, 'applied_ops'), 3); // room.create, chunk.create, deck.create

  const quiz = await s.commit(s.op('study.quiz.create', { roomId, title: 'Q', sourceChunkIds: [first], sourceRevision: 1 }, { ...confirmed }));
  assert.ok(quiz.ok);
  const question = await s.commit(s.op('study.question.create', {
    quizId: quiz.value.quizId, roomId, kind: 'fill', stem: 's', answer: 'a', sourceChunkIds: [first], sourceRevision: 1,
  }, { ...confirmed }));
  assert.ok(question.ok);
  const attemptOp = s.op('study.attempt.save', {
    quizId: quiz.value.quizId, roomId, scorePct: 100, correct: 1, total: 1,
    results: [{ questionId: question.value.questionId, correct: true }], durationMs: 5,
  }, { ...confirmed });
  assert.ok((await s.commit(attemptOp)).ok);
  const attemptReplay = await s.commit(attemptOp);
  assert.ok(attemptReplay.ok && attemptReplay.duplicate);
  assert.equal(await count(s.db, 'study_attempts'), 1);
});

test('a stale expectedRevision on chunk update still rejects after study ops land', async () => {
  const s = await setup();
  const { roomId, first } = await seeded(s);
  const [chunk] = await listChunks(s.db, roomId);
  const deck = await s.commit(s.op('study.deck.create', { roomId, title: 'D', sourceChunkIds: [first], sourceRevision: 1 }, { ...confirmed }));
  assert.ok(deck.ok);
  const edit = await s.commit(s.op('chunk.update', { chunkId: chunk!.id, body: 'edited' }, { expectedRevision: chunk!.revision }));
  assert.ok(edit.ok);
  const stale = await s.commit(s.op('chunk.update', { chunkId: chunk!.id, body: 'old tab' }, { expectedRevision: chunk!.revision }));
  assert.ok(!stale.ok);
  assert.equal(stale.error.code, 'stale_revision');
});

/* -------------------------------------------------------- provenance */

test('deleting a room cascades to every study table; deleting a chunk preserves history', async () => {
  const s = await setup();
  const { roomId, first, second } = await seeded(s);
  const sources = { sourceChunkIds: [first, second], sourceRevision: 1 };
  const deck = await s.commit(s.op('study.deck.create', { roomId, title: 'D', ...sources }, { ...confirmed }));
  assert.ok(deck.ok);
  await s.commit(s.op('study.card.create', { deckId: deck.value.deckId, roomId, front: 'f', back: 'b', ...sources }, { ...confirmed }));
  const quiz = await s.commit(s.op('study.quiz.create', { roomId, title: 'Q', ...sources }, { ...confirmed }));
  assert.ok(quiz.ok);
  const question = await s.commit(s.op('study.question.create', {
    quizId: quiz.value.quizId, roomId, kind: 'fill', stem: 's', answer: 'a', ...sources,
  }, { ...confirmed }));
  assert.ok(question.ok);
  await s.commit(s.op('study.attempt.save', {
    quizId: quiz.value.quizId, roomId, scorePct: 100, correct: 1, total: 1,
    results: [{ questionId: question.value.questionId, correct: true }], durationMs: 1,
  }, { ...confirmed }));
  await s.commit(s.op('study.slide-outline.create', {
    roomId, title: 'O', slides: [{ title: 'S', bullets: ['b'], notes: '', sourceChunkIds: [first], sourceRevision: 1 }], ...sources,
  }, { ...confirmed }));

  // A source edit never wipes derived rows; the revision snapshot stays put.
  const [chunk] = await listChunks(s.db, roomId);
  const removed = await s.commit(s.op('chunk.delete', { chunkId: chunk!.id }, { expectedRevision: chunk!.revision }));
  assert.ok(removed.ok);
  assert.equal(await count(s.db, 'study_decks'), 1);
  assert.equal(await count(s.db, 'study_cards'), 1);
  assert.equal(await count(s.db, 'study_attempts'), 1);

  const room = await getRoom(s.db, roomId);
  assert.ok(room);
  const deleted = await s.commit(s.op('room.delete', { roomId }, { expectedRevision: room.revision, confirmed: true }));
  assert.ok(deleted.ok);
  for (const table of ['study_decks', 'study_cards', 'study_quizzes', 'study_questions', 'study_attempts', 'slide_outlines']) {
    assert.equal(await count(s.db, table), 0, table);
  }
  assert.deepEqual(await listStudyDecks(s.db, roomId), []);
});

/* --------------------------------------------------------------- shape */

test('malformed study payloads are rejected before anything is written', async () => {
  const s = await setup();
  const { roomId, first } = await seeded(s);
  const sources = { sourceChunkIds: [first], sourceRevision: 1 };
  const deck = await s.commit(s.op('study.deck.create', { roomId, title: 'D', ...sources }, { ...confirmed }));
  assert.ok(deck.ok);
  const quiz = await s.commit(s.op('study.quiz.create', { roomId, title: 'Q', ...sources }, { ...confirmed }));
  assert.ok(quiz.ok);
  const as = <K extends OpKind>(kind: K, payload: unknown): Operation<K> =>
    ({ opId: `bad-${Math.random()}`, kind, payload, source: 'human', confirmed: true }) as Operation<K>;

  const bad: Operation[] = [
    as('study.deck.create', { roomId, title: '   ', ...sources }),
    as('study.deck.create', { roomId, title: 'D', sourceChunkIds: [], sourceRevision: 1 }),
    as('study.deck.create', { roomId, title: 'D', sourceChunkIds: [first], sourceRevision: 0 }),
    as('study.card.create', { deckId: deck.value.deckId, roomId, front: '', back: 'b', ...sources }),
    as('study.question.create', { quizId: quiz.value.quizId, roomId, kind: 'essay', stem: 's', answer: 'a', ...sources }),
    as('study.question.create', { quizId: quiz.value.quizId, roomId, kind: 'mcq', stem: 's', choices: ['only'], answer: 'only', ...sources }),
    as('study.question.create', { quizId: quiz.value.quizId, roomId, kind: 'mcq', stem: 's', choices: ['a', 'b'], answer: 'c', ...sources }),
    as('study.question.create', { quizId: quiz.value.quizId, roomId, kind: 'true_false', stem: 's', answer: 'maybe', ...sources }),
    as('study.question.create', { quizId: quiz.value.quizId, roomId, kind: 'fill', stem: 's', answer: 'a', choices: ['x'], ...sources }),
    as('study.attempt.save', { quizId: quiz.value.quizId, roomId, scorePct: 101, correct: 1, total: 1, results: [{ questionId: 'q', correct: true }], durationMs: 0 }),
    as('study.attempt.save', { quizId: quiz.value.quizId, roomId, scorePct: 50, correct: 2, total: 1, results: [{ questionId: 'q', correct: true }], durationMs: 0 }),
    as('study.attempt.save', { quizId: quiz.value.quizId, roomId, scorePct: 0, correct: 0, total: 1, results: [], durationMs: 0 }),
    as('study.slide-outline.create', { roomId, title: 'O', slides: [], ...sources }),
    as('study.slide-outline.create', {
      roomId, title: 'O', slides: [{ title: 'S', bullets: [], notes: '', ...sources }], ...sources,
    }),
  ];
  for (const op of bad) {
    const result = await s.commit(op);
    assert.ok(!result.ok, JSON.stringify(op.payload));
    assert.equal(result.error.code, 'invalid', JSON.stringify(op.payload));
  }
  assert.equal(await count(s.db, 'study_decks'), 1);
  assert.equal(await count(s.db, 'study_cards'), 0);
  assert.equal(await count(s.db, 'study_questions'), 0);
  assert.equal(await count(s.db, 'study_attempts'), 0);
  assert.equal(await count(s.db, 'slide_outlines'), 0);
});
