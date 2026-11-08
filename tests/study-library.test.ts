import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { Chunk } from '../src/data/models.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import {
  getChunk,
  getSlideOutline,
  getStudyDeck,
  getStudyQuiz,
  listSlideOutlines,
  listStudyCards,
  listStudyDecks,
  listStudyQuestions,
  listStudyQuizzes,
} from '../src/data/queries.ts';
import {
  distinctSubjects,
  draftItemCount,
  previewStudyDraft,
  revisionMap,
  saveStudyDraft,
  snapshotRevision,
  type SaveContext,
  type StudyDraft,
} from '../src/features/study/library.ts';
import { isStudyStale } from '../src/features/study/scheduling.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

function chunk(id: string, roomId: string, body: string, revision = 1, subjects: string[] = []): Chunk {
  return {
    id, roomId, position: 0, body, subjects, sourceLink: null, revision,
    createdAt: 1_000, updatedAt: 1_000,
  };
}

const roomA = 'room-a';
const roomB = 'room-b';
const bodyA = 'Mitochondria make energy. They burn glucose with oxygen.';
const bodyB = 'Mitosis splits one cell into two identical cells.';

/* ---------------------------------------------------------------- preview */

test('the same chunks always preview byte-identical drafts', () => {
  const chunks = [chunk('c1', roomA, bodyA), chunk('c2', roomA, bodyB, 2, ['bio'])];
  for (const kind of ['deck', 'quiz', 'outline'] as const) {
    const first = previewStudyDraft(kind, 'Cells', chunks);
    const second = previewStudyDraft(kind, 'Cells', chunks);
    assert.ok(first.ok && second.ok);
    assert.equal(JSON.stringify(first.draft), JSON.stringify(second.draft));
  }
});

test('empty selection is rejected with a readable message', () => {
  const result = previewStudyDraft('deck', 'Cells', []);
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'empty_selection');
});

test('cross-room input is rejected without partial output', () => {
  const result = previewStudyDraft('deck', 'Cells', [
    chunk('c1', roomA, bodyA),
    chunk('c2', roomB, bodyB),
  ]);
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'mixed_rooms');
});

test('a malformed chunk fails closed', () => {
  const bad = { ...chunk('c1', roomA, bodyA), revision: 0 };
  const result = previewStudyDraft('quiz', 'Cells', [bad]);
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'bad_chunk');
});

test('more than 200 chunks are rejected', () => {
  const many = Array.from({ length: 201 }, (_, i) => chunk(`c${i}`, roomA, `chunk ${i}`));
  const result = previewStudyDraft('deck', 'Cells', many);
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'too_large');
});

test('every preview item carries its source chunk id and the selection snapshot', () => {
  const chunks = [chunk('c1', roomA, bodyA), chunk('c2', roomA, bodyB, 3)];
  const deck = previewStudyDraft('deck', 'Cells', chunks);
  assert.ok(deck.ok && deck.draft.kind === 'deck');
  // Same stamping as the STUDY.2 generator: every item carries the maximum,
  // so the shared STUDY.6 rule reads both provenances identically.
  assert.deepEqual(deck.draft.cards.map((c) => [c.sourceChunkIds, c.sourceRevision]), [
    [['c1'], 3],
    [['c2'], 3],
  ]);
  const quiz = previewStudyDraft('quiz', 'Cells', chunks);
  assert.ok(quiz.ok && quiz.draft.kind === 'quiz');
  for (const question of quiz.draft.questions) {
    assert.equal(question.sourceChunkIds.length, 1);
    assert.ok(question.sourceRevision >= 1);
    if (question.kind === 'mcq') assert.ok(question.choices.includes(question.answer));
  }
  const outline = previewStudyDraft('outline', 'Cells', chunks);
  assert.ok(outline.ok && outline.draft.kind === 'outline');
  assert.ok(outline.draft.slides.every((s) => s.sourceChunkIds.length === 1));
});

test('snapshotRevision takes the newest source revision', () => {
  assert.equal(snapshotRevision([chunk('c1', roomA, bodyA, 2), chunk('c2', roomA, bodyB, 5)]), 5);
});

test('distinctSubjects keeps first-seen order', () => {
  assert.deepEqual(
    distinctSubjects([{ subjects: ['bio', 'chem'] }, { subjects: ['bio', 'cells'] }]),
    ['bio', 'chem', 'cells'],
  );
});

/* ------------------------------------------------------------------ stale */

test('a saved row is fresh until a source chunk revision moves', () => {
  const revisions = revisionMap([chunk('c1', roomA, bodyA, 1), chunk('c2', roomA, bodyB, 1)]);
  assert.equal(isStudyStale(1, ['c1', 'c2'], revisions), false);
  revisions.set('c1', 2);
  assert.equal(isStudyStale(1, ['c1', 'c2'], revisions), true);
  assert.equal(isStudyStale(1, ['missing'], revisions), true);
  // Shared STUDY.6 rule: the snapshot is the maximum, so a source saved
  // below it already reads stale. The library badge matches the due queue.
  assert.equal(isStudyStale(2, ['c1', 'c2'], new Map([['c1', 2], ['c2', 1]])), true);
});

/* -------------------------------------------------------------------- save */

function setupDb() {
  const db = nodeDb();
  return { db };
}

async function seededRoom(db: ReturnType<typeof nodeDb>) {
  await migrateDb(db);
  let id = 0;
  let clock = 1_000;
  const commit = createCommit(db, { newId: () => `id-${++id}`, now: () => (clock += 10) });
  let op = 0;
  const op$ = <K extends OpKind>(kind: K, payload: Payloads[K], extra: Partial<Operation<K>> = {}): Operation<K> =>
    ({ opId: `op-${++op}`, kind, payload, source: 'human', confirmed: false, ...extra }) as Operation<K>;
  const room = await commit(op$('room.create', { name: 'biology' }));
  assert.ok(room.ok);
  const roomId = room.value.roomId;
  const made = await commit(op$('chunk.create', { roomId, bodies: [bodyA, bodyB] }));
  assert.ok(made.ok);
  const [first, second] = made.value.chunkIds;
  return { commit, roomId, first: first!, second: second! };
}

function ctxFor(commit: SaveContext['commit'], roomId: string, base: string): SaveContext {
  let id = 0;
  return { roomId, commit, newId: () => `gen-${base}-${++id}`, opIdBase: `save-${base}` };
}

test('a reviewed deck draft saves deck plus cards and reads back with provenance', async () => {
  const { db } = setupDb();
  const { commit, roomId, first, second } = await seededRoom(db);
  const chunks = [(await getChunk(db, first)) as Chunk, (await getChunk(db, second)) as Chunk];
  const previewed = previewStudyDraft('deck', 'Cell basics', chunks);
  assert.ok(previewed.ok);
  const saved = await saveStudyDraft(previewed.draft, ctxFor(commit, roomId, 'one'));
  assert.deepEqual(saved, { ok: true, duplicate: false });

  const decks = await listStudyDecks(db, roomId);
  assert.equal(decks.length, 1);
  assert.deepEqual([decks[0]?.title, decks[0]?.sourceChunkIds], ['Cell basics', [first, second]]);
  const cards = await listStudyCards(db, decks[0]!.id);
  assert.equal(cards.length, 2);
  assert.deepEqual(await getStudyDeck(db, decks[0]!.id), decks[0]);
});

test('retrying a save with the same op ids duplicates nothing', async () => {
  const { db } = setupDb();
  const { commit, roomId, first } = await seededRoom(db);
  const one = (await getChunk(db, first)) as Chunk;
  const previewed = previewStudyDraft('quiz', 'Cell quiz', [one]);
  assert.ok(previewed.ok);
  const ctx = ctxFor(commit, roomId, 'retry');
  const firstSave = await saveStudyDraft(previewed.draft, ctx);
  assert.deepEqual(firstSave, { ok: true, duplicate: false });
  // A fresh id factory (like the screen's randomUUID per save) must still
  // resume onto the replayed quiz row instead of a new parent id.
  const retryCtx = ctxFor(commit, roomId, 'retry');
  const secondSave = await saveStudyDraft(previewed.draft, retryCtx);
  assert.deepEqual(secondSave, { ok: true, duplicate: true });

  assert.equal((await listStudyQuizzes(db, roomId)).length, 1);
  const quizzes = await listStudyQuizzes(db, roomId);
  assert.equal((await listStudyQuestions(db, quizzes[0]!.id)).length, 1);
});

test('a failed commit reports the error and keeps the draft for retry', async () => {
  const { db } = setupDb();
  const { commit, roomId, first } = await seededRoom(db);
  const one = (await getChunk(db, first)) as Chunk;
  const previewed = previewStudyDraft('deck', 'Gone', [one]);
  assert.ok(previewed.ok);
  const draft: StudyDraft = previewed.draft;
  const before = JSON.stringify(draft);

  // Saving into a room that no longer exists fails without writing rows.
  const failed = await saveStudyDraft(draft, ctxFor(commit, 'no-such-room', 'fail'));
  assert.ok(!failed.ok);
  assert.match(failed.error, /room does not exist|not_found|does not exist/i);
  assert.equal(JSON.stringify(draft), before);
  assert.deepEqual(await listStudyDecks(db, roomId), []);

  // Retry with the real room and the untouched draft succeeds.
  const retried = await saveStudyDraft(draft, ctxFor(commit, roomId, 'fail'));
  assert.deepEqual(retried, { ok: true, duplicate: false });
  assert.equal((await listStudyDecks(db, roomId)).length, 1);
});

test('an outline draft saves slides atomically in one op', async () => {
  const { db } = setupDb();
  const { commit, roomId, first, second } = await seededRoom(db);
  const chunks = [(await getChunk(db, first)) as Chunk, (await getChunk(db, second)) as Chunk];
  const previewed = previewStudyDraft('outline', 'Cells in slides', chunks);
  assert.ok(previewed.ok);
  const saved = await saveStudyDraft(previewed.draft, ctxFor(commit, roomId, 'outline'));
  assert.deepEqual(saved, { ok: true, duplicate: false });
  const outlines = await listSlideOutlines(db, roomId);
  assert.equal(outlines.length, 1);
  assert.equal(outlines[0]?.slides.length, 2);
  assert.deepEqual(await getSlideOutline(db, outlines[0]!.id), outlines[0]);
});

test('lists never leak foreign-room items', async () => {
  const { db } = setupDb();
  const a = await seededRoom(db);
  const { commit } = a;
  let op = 100;
  const op$ = <K extends OpKind>(kind: K, payload: Payloads[K]): Operation<K> =>
    ({ opId: `op-${++op}`, kind, payload, source: 'human', confirmed: true }) as Operation<K>;
  const roomB = await commit(op$('room.create', { name: 'physics' }));
  assert.ok(roomB.ok);
  const otherId = roomB.value.roomId;
  const deck = await commit(op$('study.deck.create', {
    roomId: otherId, title: 'Forces', sourceChunkIds: [a.first], sourceRevision: 1,
  }));
  assert.ok(!deck.ok, 'a deck grounded in another room must be rejected');
  assert.deepEqual(await listStudyDecks(db, otherId), []);
  assert.deepEqual(await getStudyQuiz(db, 'nope'), null);
});

test('removing an unsaved item between failure and retry still lands each item once', async () => {
  const { db } = setupDb();
  const { commit, roomId, first, second } = await seededRoom(db);
  const chunks = [(await getChunk(db, first)) as Chunk, (await getChunk(db, second)) as Chunk];
  const previewed = previewStudyDraft('deck', 'Shrinking', chunks);
  assert.ok(previewed.ok && previewed.draft.kind === 'deck');
  // The second card is broken; the first save stops at it.
  previewed.draft.cards[1] = { ...previewed.draft.cards[1]!, back: '' };
  const ctx = ctxFor(commit, roomId, 'shrink');
  const failed = await saveStudyDraft(previewed.draft, ctx);
  assert.ok(!failed.ok);

  // The user drops the already-saved first card and fixes the second, then retries.
  const resumed: StudyDraft = {
    kind: 'deck',
    title: previewed.draft.title,
    cards: [{ ...previewed.draft.cards[1]!, back: 'fixed' }],
  };
  const retried = await saveStudyDraft(resumed, ctx);
  assert.deepEqual(retried, { ok: true, duplicate: false });
  const decks = await listStudyDecks(db, roomId);
  assert.equal(decks.length, 1);
  // Key-based op ids: the fixed card lands once; nothing is duplicated.
  assert.equal((await listStudyCards(db, decks[0]!.id)).length, 2);
});

test('draftItemCount counts every reviewable item', () => {
  const deck: StudyDraft = {
    kind: 'deck', title: 't',
    cards: [{ key: 'k', front: 'f', back: 'b', sourceChunkIds: ['c'], sourceRevision: 1 }],
  };
  assert.equal(draftItemCount(deck), 1);
  assert.equal(draftItemCount({ kind: 'quiz', title: 't', questions: [] }), 0);
});
