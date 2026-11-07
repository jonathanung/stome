import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { getChunk, getRoom, latestReviewMark } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import {
  chunksReadyToReview,
  mockReviewQuestion,
  orderReviewQueue,
  reviewHref,
  reviewMarkOperation,
} from '../src/features/review/session.ts';
import { nodeDb } from './support/node-db.ts';

test('the review route is the room id plus an optional chunk', () => {
  assert.equal(reviewHref('room-1'), '/rooms/room-1/review');
  assert.equal(reviewHref('room-1', 'chunk 2'), '/rooms/room-1/review?chunk=chunk%202');
});

test('the same chunk always gets the same mock question and an error continues', () => {
  const chunk = { id: 'c1', roomId: 'room-1', body: '  photosynthesis makes sugar  ' };
  const first = mockReviewQuestion(chunk);
  const again = mockReviewQuestion({ ...chunk, body: 'photosynthesis makes sugar' });
  assert.equal(first.ok, true);
  assert.equal(again.ok, true);
  if (!first.ok || !again.ok) return;
  assert.equal(first.question, again.question);
  assert.equal(first.question, 'Mock answer (c1; messages=0): What should you remember from this note?');
  const other = mockReviewQuestion({ id: 'c2', roomId: 'room-1', body: 'mitochondria' });
  assert.equal(other.ok, true);
  if (!other.ok) return;
  assert.notEqual(other.question, first.question);
  assert.equal(other.question, 'Mock answer (c2; messages=0): What should you remember from this note?');

  const failed = mockReviewQuestion(chunk, 'error');
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.message, 'The mock provider failed before answering');
  const continued = mockReviewQuestion({ id: 'c2', roomId: 'room-1', body: 'mitochondria' });
  assert.equal(continued.ok, true);
  if (!continued.ok) return;
  assert.equal(continued.question, other.question);

  const empty = mockReviewQuestion({ id: 'c3', roomId: 'room-1', body: '   ' });
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.match(empty.message, /empty note/);
  const afterEmpty = mockReviewQuestion(chunk);
  assert.equal(afterEmpty.ok, true);
  if (!afterEmpty.ok) return;
  assert.equal(afterEmpty.question, first.question);
});

test('a session shows unreviewed and due notes in room order', () => {
  const chunks = [
    { id: 'b', position: 1, body: 'beta', revision: 1 },
    { id: 'a', position: 0, body: 'alpha', revision: 1 },
    { id: 'c', position: 2, body: 'gamma', revision: 4 },
  ];
  const marks = new Map([['b', { dueAt: 5_000 }]]);
  const ready = chunksReadyToReview(chunks, marks, 1_000);
  assert.deepEqual(ready.map((chunk) => chunk.id), ['a', 'c']);
  assert.deepEqual(chunks.map((chunk) => chunk.id), ['b', 'a', 'c']);
  const due = chunksReadyToReview(chunks, marks, 5_000);
  assert.deepEqual(due.map((chunk) => chunk.id), ['a', 'b', 'c']);
  assert.deepEqual(orderReviewQueue(due, 'c', chunks).map((chunk) => chunk.id), ['c', 'a', 'b']);
  const held = chunksReadyToReview(chunks, marks, 1_000);
  assert.deepEqual(orderReviewQueue(held, 'b', chunks).map((chunk) => chunk.id), ['b', 'a', 'c']);
  assert.deepEqual(orderReviewQueue(held, 'missing', chunks).map((chunk) => chunk.id), ['a', 'c']);
});

test('a human mark uses the seen revision and a mismatch does not write or credit', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  const now = Date.parse('2026-11-07T15:00:00Z');
  const commit = createCommit(db, { now: () => now, newId: () => `id-${++id}` });
  const room = await commit({
    opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunks', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['alpha', 'beta', 'gamma'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const [alpha, beta] = created.value.chunkIds;
  assert.ok(alpha && beta);
  const edited = await commit({
    opId: 'edit', kind: 'chunk.update', source: 'human', confirmed: false, expectedRevision: 1,
    payload: { chunkId: alpha, body: 'alpha changed' },
  });
  assert.equal(edited.ok, true);
  const stale = await commit(reviewMarkOperation({
    opId: 'stale', chunkId: alpha, state: 'got_it', expectedRevision: 1, timeZone: 'UTC',
  }));
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.error.code, 'stale_revision');
  assert.equal(await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 0);
  assert.equal((await getRoom(db, room.value.roomId))?.stage, 'stonehenge');
  assert.equal((await getChunk(db, alpha))?.body, 'alpha changed');
  assert.equal((await getChunk(db, alpha))?.revision, 2);

  const first = await commit(reviewMarkOperation({
    opId: 'mark-alpha', chunkId: alpha, state: 'missed', expectedRevision: 2, timeZone: 'UTC',
  }));
  const second = await commit(reviewMarkOperation({
    opId: 'mark-beta', chunkId: beta, state: 'unclear', expectedRevision: 1, timeZone: 'UTC',
  }));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.value.stage, 'stonehenge');
  assert.equal(second.value.stage, 'stonehenge');
  const gamma = created.value.chunkIds[2];
  assert.ok(gamma);
  const third = await commit(reviewMarkOperation({
    opId: 'mark-gamma', chunkId: gamma, state: 'got_it', expectedRevision: 1, timeZone: 'UTC',
  }));
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.equal(third.value.state, 'got_it');
  assert.equal(third.value.stage, 'brick');
  assert.equal(third.value.dueAt, now + 3 * 24 * 60 * 60 * 1000);
  assert.equal((await getRoom(db, room.value.roomId))?.stage, 'brick');
  assert.equal(await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 3);
  assert.equal((await latestReviewMark(db, alpha))?.state, 'missed');
  const again = await commit(reviewMarkOperation({
    opId: 'mark-alpha-again', chunkId: alpha, state: 'got_it', expectedRevision: 2, timeZone: 'UTC',
  }));
  assert.equal(again.ok, true);
  assert.equal(await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 3);
  db.close();
});
