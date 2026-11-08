import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit, type CommitDeps } from '../src/data/commit.ts';
import type { Db } from '../src/db/driver.ts';
import type { ReviewState } from '../src/db/schema.ts';
import {
  getAnnotation,
  latestAnswerMark,
  latestReviewMark,
  listDueAnswers,
  listDueChunks,
  listRoomDueAnswers,
} from '../src/data/queries.ts';
import { isDueAnswer } from '../src/data/models.ts';
import { planDueItems } from '../src/data/today.ts';
import {
  answersReadyToReview,
  mockAnswerQuestion,
  reviewAnswerMarkOperation,
  reviewQueueForRoom,
} from '../src/features/review/session.ts';
import { migrateDb } from '../src/db/migrate.ts';
import {
  TOOL_NAME,
  assessConfirmedAnnotation,
  HarnessError,
  type AnnotationProposal,
  type ChunkView,
} from '../src/harness/contract.ts';
import { nodeDb } from './support/node-db.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DUE_AFTER: Record<ReviewState, number> = {
  missed: 10 * MINUTE,
  unclear: DAY,
  got_it: 3 * DAY,
};

type App = { db: Db & { close(): void }; commit: ReturnType<typeof createCommit>; setNow(now: number): void };

function openApp(now: number): App {
  const db = nodeDb();
  let clock = now;
  let id = 0;
  const deps: CommitDeps = { now: () => clock, newId: () => `id-${++id}` };
  return { db, commit: createCommit(db, deps), setNow: (next: number) => { clock = next; } };
}

async function roomWithChunk(now: number, body = 'photosynthesis makes sugar') {
  const app = openApp(now);
  await migrateDb(app.db);
  const room = await app.commit({
    opId: 'room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  if (!room.ok) throw new Error(room.error.message);
  assert.equal(room.ok, true);
  const created = await app.commit({
    opId: 'chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: [body] },
  });
  if (!created.ok) throw new Error(created.error.message);
  assert.equal(created.ok, true);
  const chunkId = created.value.chunkIds[0];
  if (!chunkId) throw new Error('the chunk was not created');
  return { ...app, roomId: room.value.roomId, chunkId };
}

async function pinAnswer(
  app: Pick<App, 'db' | 'commit'>,
  input: { opId: string; chunkId: string; start: number; end: number; answer?: string; revision?: number },
) {
  const body = (await app.db.get<{ body: string }>('SELECT content AS body FROM chunks WHERE id = ?', [input.chunkId]))?.body;
  if (body === undefined) throw new Error('chunk missing for pin');
  const quote = body.slice(input.start, input.end);
  const saved = await app.commit({
    opId: input.opId,
    kind: 'annotation.create',
    source: 'ai',
    confirmed: true,
    expectedRevision: input.revision ?? 1,
    payload: {
      chunkId: input.chunkId,
      type: 'ai_answer',
      anchor: { start: input.start, end: input.end },
      payload: { answer: input.answer ?? 'sugar from light', proposalId: 'proposal-1', quote, chunkRevision: input.revision ?? 1 },
    },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error('the answer was not pinned');
  return saved.value.annotationId;
}

const answerMarks = async (db: Db) => (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM answer_marks'))?.n;
const chunkMarks = async (db: Db) => (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks'))?.n;
const annotations = async (db: Db) => (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM annotations'))?.n;

test('a pinned answer is due at once and each mark sets its fixed due time', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  for (const state of ['missed', 'unclear', 'got_it'] as const) {
    const app = roomWithChunk(now);
    const s = await app;
    const annotationId = await pinAnswer(s, { opId: `pin-${state}`, chunkId: s.chunkId, start: 0, end: 14 });
    const due = await listDueAnswers(s.db, now);
    assert.equal(due.length, 1);
    assert.equal((await listRoomDueAnswers(s.db, s.roomId, now)).length, 1);
    assert.equal(due[0]?.annotation.id, annotationId);
    assert.equal(due[0]?.mark, null);
    assert.equal(isDueAnswer(due[0]!), true);
    assert.equal(await chunkMarks(s.db), 0);
    assert.deepEqual(await listDueChunks(s.db, now), []);

    const marked = await s.commit(reviewAnswerMarkOperation({
      opId: `mark-${state}`,
      chunkId: s.chunkId,
      annotationId,
      state,
      expectedRevision: 1,
      timeZone: 'UTC',
    }));
    assert.equal(marked.ok, true);
    if (!marked.ok) return;
    assert.equal(marked.value.annotationId, annotationId);
    assert.equal(marked.value.chunkId, s.chunkId);
    assert.equal(marked.value.dueAt, now + DUE_AFTER[state]);
    const stored = await latestAnswerMark(s.db, annotationId);
    assert.equal(stored?.state, state);
    assert.equal(stored?.dueAt, now + DUE_AFTER[state]);
    assert.equal(stored?.chunkId, s.chunkId);
    const pin = await getAnnotation(s.db, annotationId);
    assert.equal(pin?.type, 'ai_answer');

    const early = await listDueAnswers(s.db, now + DUE_AFTER[state] - 1);
    assert.deepEqual(early, []);
    const late = await listDueAnswers(s.db, now + DUE_AFTER[state]);
    assert.equal(late.length, 1);
    assert.equal(late[0]?.mark?.state, state);
    s.db.close();
  }
});

test('marking the answer hides its chunk until the answer is marked ahead', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const s = await roomWithChunk(now);
  const chunkMark = await s.commit({
    opId: 'mark-chunk',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, state: 'missed', timeZone: 'UTC' },
  });
  assert.equal(chunkMark.ok, true);
  if (!chunkMark.ok) return;
  assert.equal(chunkMark.value.annotationId, null);
  const annotationId = await pinAnswer(s, { opId: 'pin', chunkId: s.chunkId, start: 0, end: 14 });

  const chunksDue = await listDueChunks(s.db, now + 10 * MINUTE);
  const answersDue = await listDueAnswers(s.db, now + 10 * MINUTE);
  assert.equal(chunksDue.length, 1);
  assert.equal(answersDue.length, 1);
  const planned = planDueItems([...chunksDue, ...answersDue]);
  assert.equal(planned.length, 1);
  assert.equal(isDueAnswer(planned[0]!), true);

  s.setNow(now + 10 * MINUTE);
  const marked = await s.commit(reviewAnswerMarkOperation({
    opId: 'mark-answer',
    chunkId: s.chunkId,
    annotationId,
    state: 'got_it',
    expectedRevision: 1,
    timeZone: 'UTC',
  }));
  assert.equal(marked.ok, true);
  const afterChunks = await listDueChunks(s.db, now + 10 * MINUTE + 1);
  const afterAnswers = await listDueAnswers(s.db, now + 10 * MINUTE + 1);
  assert.equal(afterAnswers.length, 0);
  const replanned = planDueItems([...afterChunks, ...afterAnswers]);
  assert.equal(replanned.length, 1);
  assert.equal(isDueAnswer(replanned[0]!), false);
  s.db.close();
});

test('a stale passage, revision, or bad anchor rejects the answer mark and writes nothing', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const s = await roomWithChunk(now, 'photosynthesis makes sugar');
  const annotationId = await pinAnswer(s, { opId: 'pin', chunkId: s.chunkId, start: 0, end: 14 });
  const mark = (opId: string, expectedRevision: number) => s.commit(reviewAnswerMarkOperation({
    opId,
    chunkId: s.chunkId,
    annotationId,
    state: 'got_it',
    expectedRevision,
    timeZone: 'UTC',
  }));

  const staleRevision = await mark('stale-revision', 0);
  assert.equal(staleRevision.ok, false);
  if (staleRevision.ok) return;
  assert.equal(staleRevision.error.code, 'stale_revision');

  const edited = await s.commit({
    opId: 'edit',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, body: `${'X'.repeat(14)}${'photosynthesis makes sugar'.slice(14)}` },
  });
  assert.equal(edited.ok, true);
  const stalePassage = await mark('stale-passage', 2);
  assert.equal(stalePassage.ok, false);
  if (stalePassage.ok) return;
  assert.equal(stalePassage.error.code, 'stale_revision');
  assert.match(stalePassage.error.message, /passage|revision/i);

  const shortened = await s.commit({
    opId: 'shorten',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: 2,
    payload: { chunkId: s.chunkId, body: 'hi' },
  });
  assert.equal(shortened.ok, true);
  const badAnchor = await mark('bad-anchor', 3);
  assert.equal(badAnchor.ok, false);
  if (badAnchor.ok) return;
  assert.equal(badAnchor.error.code, 'invalid');
  assert.match(badAnchor.error.message, /anchor|range/i);

  assert.equal(await answerMarks(s.db), 0);
  assert.equal(await s.db.get('SELECT op_id FROM applied_ops WHERE op_id = ?', ['stale-passage']), null);
  assert.equal(await latestAnswerMark(s.db, annotationId), null);
  s.db.close();
});

test('only a pinned ai_answer on the marked chunk can be marked', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const s = await roomWithChunk(now);
  const highlight = await s.commit({
    opId: 'highlight',
    kind: 'annotation.create',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, type: 'highlight', anchor: { start: 0, end: 4 }, payload: { text: 'note' } },
  });
  assert.equal(highlight.ok, true);
  if (!highlight.ok) return;
  const marked = await s.commit(reviewAnswerMarkOperation({
    opId: 'mark-highlight',
    chunkId: s.chunkId,
    annotationId: highlight.value.annotationId,
    state: 'got_it',
    expectedRevision: 1,
    timeZone: 'UTC',
  }));
  assert.equal(marked.ok, false);
  if (marked.ok) return;
  assert.equal(marked.error.code, 'invalid');

  const missing = await s.commit(reviewAnswerMarkOperation({
    opId: 'mark-missing',
    chunkId: s.chunkId,
    annotationId: 'no-such-answer',
    state: 'got_it',
    expectedRevision: 1,
    timeZone: 'UTC',
  }));
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error.code, 'not_found');

  const other = await s.commit({
    opId: 'chunk-2',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: s.roomId, bodies: ['mitochondria makes energy'] },
  });
  assert.equal(other.ok, true);
  if (!other.ok) return;
  const otherId = other.value.chunkIds[0] ?? '';
  const annotationId = await pinAnswer(s, { opId: 'pin', chunkId: s.chunkId, start: 0, end: 14 });
  const crossed = await s.commit(reviewAnswerMarkOperation({
    opId: 'mark-crossed',
    chunkId: otherId,
    annotationId,
    state: 'got_it',
    expectedRevision: 1,
    timeZone: 'UTC',
  }));
  assert.equal(crossed.ok, false);
  if (crossed.ok) return;
  assert.equal(crossed.error.code, 'invalid');

  const forbidden = await s.commit({
    ...reviewAnswerMarkOperation({
      opId: 'mark-ai',
      chunkId: s.chunkId,
      annotationId,
      state: 'got_it',
      expectedRevision: 1,
      timeZone: 'UTC',
    }),
    source: 'ai',
    confirmed: true,
  });
  assert.equal(forbidden.ok, false);
  if (forbidden.ok) return;
  assert.equal(forbidden.error.code, 'forbidden');
  assert.equal(await answerMarks(s.db), 0);
  s.db.close();
});

test('a same-day answer re-mark replaces its row and answers credit brick', async () => {
  const now = Date.parse('2026-11-07T18:00:00Z');
  const app = openApp(now);
  await migrateDb(app.db);
  const room = await app.commit({
    opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await app.commit({
    opId: 'chunks', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['one two three four', 'five six seven eight', 'nine ten eleven twelve'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const [first, second, third] = created.value.chunkIds;
  if (!first || !second || !third) throw new Error('chunks missing');
  const chunkMark = (opId: string, chunkId: string) => app.commit({
    opId, kind: 'review.mark' as const, source: 'human' as const, confirmed: false,
    expectedRevision: 1, payload: { chunkId, state: 'got_it' as const, timeZone: 'UTC' },
  });
  assert.equal((await chunkMark('mark-1', first)).ok, true);
  assert.equal((await chunkMark('mark-2', second)).ok, true);
  const annotationId = await pinAnswer(app, {
    opId: 'pin', chunkId: third, start: 0, end: 4,
  });
  const answer = await app.commit(reviewAnswerMarkOperation({
    opId: 'mark-answer', chunkId: third, annotationId, state: 'got_it', expectedRevision: 1, timeZone: 'UTC',
  }));
  assert.equal(answer.ok, true);
  if (!answer.ok) return;
  assert.equal(answer.value.stage, 'brick');

  app.setNow(now + 60_000);
  const again = await app.commit(reviewAnswerMarkOperation({
    opId: 'mark-answer-again', chunkId: third, annotationId, state: 'missed', expectedRevision: 1, timeZone: 'UTC',
  }));
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.value.localDay, '2026-11-07');
  assert.equal(await answerMarks(app.db), 1);
  assert.equal((await latestAnswerMark(app.db, annotationId))?.state, 'missed');
  app.db.close();
});

test('answer session helpers rank pins and ask a stable question', () => {
  const ready = answersReadyToReview(
    [
      { id: 'highlight-1', type: 'highlight' },
      { id: 'pin-new', type: 'ai_answer' },
      { id: 'pin-due', type: 'ai_answer' },
      { id: 'pin-later', type: 'ai_answer' },
    ],
    new Map([['pin-due', { dueAt: 5_000 }], ['pin-later', { dueAt: 50_000 }]]),
    10_000,
  );
  assert.deepEqual(ready.map((pin) => pin.id), ['pin-new', 'pin-due']);

  const first = mockAnswerQuestion({ id: 'pin-new', answer: '  sugar from light  ' });
  const repeat = mockAnswerQuestion({ id: 'pin-new', answer: 'sugar from light' });
  assert.equal(first.ok, true);
  assert.equal(repeat.ok, true);
  if (!first.ok || !repeat.ok) return;
  assert.equal(first.question, repeat.question);
  assert.match(first.question, /saved answer/);
  const empty = mockAnswerQuestion({ id: 'pin-empty', answer: '   ' });
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.match(empty.message, /empty answer/);

  const queue = reviewQueueForRoom({
    chunks: [
      { id: 'b', position: 1, body: 'beta', revision: 1 },
      { id: 'a', position: 0, body: 'alpha', revision: 1 },
    ],
    answers: [{
      id: 'pin-a', annotationId: 'pin-a', chunkId: 'a', position: 0,
      answer: 'alpha answer', quote: 'alph', chunkBody: 'alpha', chunkRevision: 1,
      anchor: { start: 0, end: 4 }, grounding: { quote: 'alph' },
    }],
    latestByChunk: new Map([['a', { dueAt: 1_000 }]]),
    latestByAnnotation: new Map(),
    now: 5_000,
  });
  assert.deepEqual(queue.map((card) => (card.kind === 'answer' ? card.answer.id : card.chunk.id)), ['pin-a', 'b']);

  const planned = planDueItems([
    { chunk: { id: 'c1', roomId: 'r', position: 0, body: 'c1', subjects: [], sourceLink: null, revision: 1, createdAt: 0, updatedAt: 0 }, mark: { chunkId: 'c1', state: 'got_it', localDay: '2026-11-07', markedAt: 1, dueAt: 5, timeZone: 'UTC' } },
    {
      chunk: { id: 'c2', roomId: 'r', position: 1, body: 'c2', subjects: [], sourceLink: null, revision: 1, createdAt: 0, updatedAt: 0 },
      annotation: { id: 'pin-c2', chunkId: 'c2', type: 'ai_answer', anchor: { start: 0, end: 1 }, payload: {}, createdAt: 2, updatedAt: 2 },
      mark: null,
    },
  ]);
  assert.equal(planned.length, 2);
  assert.equal(isDueAnswer(planned[0]!), true);
});

function answerProposal(roomId: string, chunkId: string): { proposal: AnnotationProposal; chunk: ChunkView } {
  return {
    proposal: {
      id: 'proposal-1',
      tool: TOOL_NAME,
      roomId,
      chunkId,
      noteId: 0,
      type: 'ai_answer',
      body: 'sugar from light',
      anchorStart: 0,
      anchorEnd: 14,
      chunkRevision: 1,
    },
    chunk: {
      id: chunkId,
      roomId,
      noteId: 0,
      label: 'photosynthesis makes sugar',
      text: 'photosynthesis makes sugar',
      revision: 1,
    },
  };
}

test('declining a proposal writes no annotation and no mark', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const s = await roomWithChunk(now);
  const { proposal, chunk } = answerProposal(s.roomId, s.chunkId);

  assert.throws(
    () => assessConfirmedAnnotation({
      confirmed: false,
      operationId: 'op-pin-1',
      proposal,
      sessionRoomId: s.roomId,
      sessionState: 'completed',
      selectedChunkIds: [s.chunkId],
      confirmedOperationId: null,
      chunk,
    }),
    (error: unknown) => error instanceof HarnessError && error.code === 'confirmation_required',
  );
  const unconfirmed = await s.commit({
    opId: 'pin-declined',
    kind: 'annotation.create',
    source: 'ai',
    confirmed: false,
    expectedRevision: 1,
    payload: {
      chunkId: s.chunkId,
      type: 'ai_answer',
      anchor: { start: 0, end: 14 },
      payload: { answer: 'sugar from light' },
    },
  });
  assert.equal(unconfirmed.ok, false);
  if (unconfirmed.ok) return;
  assert.equal(unconfirmed.error.code, 'unconfirmed');
  assert.equal(await annotations(s.db), 0);
  assert.equal(await answerMarks(s.db), 0);
  assert.equal(await chunkMarks(s.db), 0);
  assert.equal(await latestReviewMark(s.db, s.chunkId), null);
  s.db.close();
});

test('confirming a proposal pins the answer and it is due for review', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const s = await roomWithChunk(now);
  const { proposal, chunk } = answerProposal(s.roomId, s.chunkId);

  const request = assessConfirmedAnnotation({
    confirmed: true,
    operationId: 'op-pin-1',
    proposal,
    sessionRoomId: s.roomId,
    sessionState: 'completed',
    selectedChunkIds: [s.chunkId],
    confirmedOperationId: null,
    chunk,
  });
  const quote = chunk.text.slice(request.payload.anchorStart, request.payload.anchorEnd);
  const saved = await s.commit({
    opId: request.opId,
    kind: 'annotation.create',
    source: 'ai',
    confirmed: true,
    expectedRevision: request.expectedRevision,
    payload: {
      chunkId: request.payload.chunkId,
      type: 'ai_answer',
      anchor: { start: request.payload.anchorStart, end: request.payload.anchorEnd },
      payload: {
        answer: request.payload.body,
        proposalId: request.payload.proposalId,
        quote,
        chunkRevision: request.expectedRevision,
      },
    },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const due = await listDueAnswers(s.db, now);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.annotation.id, saved.value.annotationId);
  assert.equal(due[0]?.mark, null);
  s.db.close();
});
