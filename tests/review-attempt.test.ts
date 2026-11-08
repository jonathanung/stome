import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { getChunk, listDueChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { createMarkController, type MarkAttempt } from '../src/features/review/mark-attempt.ts';
import { reviewMarkOperation } from '../src/features/review/session.ts';
import { nodeDb } from './support/node-db.ts';

test('a lost response retries the same op across local midnight and does not add a credit', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let now = Date.parse('2026-11-07T23:50:00.000Z');
  const save = createCommit(db, { now: () => now, newId: () => 'unused' });
  const room = await save({
    opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await save({
    opId: 'chunk', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['alpha'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const chunkId = created.value.chunkIds[0];
  assert.ok(chunkId);

  const marks = createMarkController();
  let ids = 0;
  let zones = 0;
  const seen: MarkAttempt[] = [];
  const request = { chunkId, state: 'missed' as const, expectedRevision: 1 };
  const first = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => (zones++ === 0 ? 'UTC' : 'Pacific/Auckland'),
    request,
    commit: async (attempt) => {
      seen.push(attempt);
      return save(attempt);
    },
    report: () => {
      throw new Error('response lost');
    },
  });
  assert.equal(first.status, 'ambiguous');
  const stored = await db.get<{ local_day: string; state: string; due_at: number; marked_at: number; time_zone: string }>(
    'SELECT local_day, state, due_at, marked_at, time_zone FROM review_marks',
  );
  assert.ok(stored);
  assert.equal(stored.local_day, '2026-11-07');
  assert.equal(stored.state, 'missed');
  assert.equal(stored.time_zone, 'UTC');
  assert.equal(ids, 1);
  assert.equal(zones, 1);
  assert.equal(marks.retained(chunkId)?.opId, 'mark-1');
  assert.equal(marks.retained(chunkId)?.payload.timeZone, 'UTC');

  now = Date.parse('2026-11-08T00:10:00.000Z');
  const other = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => (zones++ === 0 ? 'UTC' : 'Pacific/Auckland'),
    request: { chunkId, state: 'got_it', expectedRevision: 1 },
    commit: async (attempt) => {
      seen.push(attempt);
      return save(attempt);
    },
    report: () => undefined,
  });
  assert.equal(other.status, 'blocked');
  assert.equal(seen.length, 1);

  const retry = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => (zones++ === 0 ? 'UTC' : 'Pacific/Auckland'),
    request,
    commit: async (attempt) => {
      seen.push(attempt);
      return save(attempt);
    },
    report: () => undefined,
  });
  assert.equal(retry.status, 'saved');
  if (retry.status !== 'saved') return;
  assert.equal(retry.result.duplicate, true);
  assert.equal(retry.result.value.localDay, stored.local_day);
  assert.equal(retry.result.value.dueAt, stored.due_at);
  assert.equal(retry.result.value.markedAt, stored.marked_at);
  assert.equal(ids, 1);
  assert.equal(zones, 1);
  assert.equal(seen[1]?.opId, 'mark-1');
  assert.equal(seen[1]?.payload.timeZone, 'UTC');
  assert.equal(marks.retained(chunkId), null);
  const rows = await db.all<{ local_day: string; state: string; due_at: number; time_zone: string }>(
    'SELECT local_day, state, due_at, time_zone FROM review_marks ORDER BY local_day',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.local_day, '2026-11-07');
  assert.equal(rows[0]?.state, 'missed');
  assert.equal(rows[0]?.due_at, stored.due_at);
  assert.equal(rows[0]?.time_zone, 'UTC');

  const again = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => (zones++ === 0 ? 'UTC' : 'Pacific/Auckland'),
    request: { chunkId, state: 'got_it', expectedRevision: 1 },
    commit: async (attempt) => save(attempt),
    report: () => undefined,
  });
  assert.equal(again.status, 'saved');
  if (again.status !== 'saved') return;
  assert.equal(again.result.duplicate, false);
  assert.equal(again.result.value.localDay, '2026-11-08');
  assert.equal(ids, 2);
  assert.equal(await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 2);
  db.close();
});

test('a second tap during a mark does not start a second operation', async () => {
  const marks = createMarkController();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = { chunkId: 'chunk', state: 'missed' as const, expectedRevision: 1 };
  const value = {
    chunkId: 'chunk',
    annotationId: null as string | null,
    state: 'missed' as const,
    localDay: '2026-11-07',
    markedAt: 1,
    dueAt: 2,
    timeZone: 'UTC',
    stage: 'stonehenge' as const,
  };
  const first = marks.submit({
    newId: () => 'one',
    timeZone: () => 'UTC',
    request,
    report: () => undefined,
    commit: async () => {
      calls += 1;
      await gate;
      return { ok: true as const, duplicate: false, value };
    },
  });
  const second = await marks.submit({
    newId: () => 'two',
    timeZone: () => 'Pacific/Auckland',
    request: { ...request, state: 'got_it' },
    report: () => undefined,
    commit: async () => {
      calls += 1;
      return { ok: true as const, duplicate: false, value };
    },
  });
  assert.equal(second.status, 'busy');
  assert.equal(calls, 1);
  release();
  const done = await first;
  assert.equal(done.status, 'saved');
  assert.equal(calls, 1);
});

test('back waits for a paused mark before Today reads the new due time', async () => {
  const db = nodeDb();
  await migrateDb(db);
  const start = Date.parse('2026-11-07T12:00:00.000Z');
  let now = start;
  let id = 0;
  const save = createCommit(db, { now: () => now, newId: () => `id-${++id}` });
  const room = await save({
    opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await save({
    opId: 'chunk', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['alpha'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const chunkId = created.value.chunkIds[0];
  assert.ok(chunkId);
  const missed = await save(reviewMarkOperation({
    opId: 'missed', chunkId, state: 'missed', expectedRevision: 1, timeZone: 'UTC',
  }));
  assert.equal(missed.ok, true);
  now = start + 11 * 60 * 1000;
  const due = await listDueChunks(db, now);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.mark.state, 'missed');

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const marks = createMarkController();
  const flight = marks.submit({
    newId: () => 'got-it',
    timeZone: () => 'UTC',
    request: { chunkId, state: 'got_it', expectedRevision: 1 },
    report: () => {
      throw new Error('painted after back');
    },
    commit: async (attempt) => {
      await gate;
      writes += 1;
      return save(attempt);
    },
  });
  let opened = false;
  const leaving = marks.requestLeave(async () => {
    opened = true;
    const next = await listDueChunks(db, now);
    assert.equal(next.length, 0);
    assert.equal((await listDueChunks(db, now + 1)).some((item) => item.mark.state === 'missed'), false);
  });
  assert.equal(opened, false);
  assert.equal(writes, 0);
  assert.equal((await listDueChunks(db, now))[0]?.mark.state, 'missed');
  release();
  await leaving;
  const outcome = await flight;
  assert.equal(opened, true);
  assert.equal(writes, 1);
  assert.equal(outcome.status, 'saved');
  if (outcome.status === 'saved') assert.equal(outcome.painted, false);
  assert.equal((await listDueChunks(db, now)).length, 0);
  db.close();
});

test('a lost mark replays after the note is edited and the card is opened again', async () => {
  const db = nodeDb();
  await migrateDb(db);
  const now = Date.parse('2026-11-07T18:00:00.000Z');
  const save = createCommit(db, { now: () => now, newId: () => 'unused' });
  const room = await save({
    opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await save({
    opId: 'chunk', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['alpha'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const chunkId = created.value.chunkIds[0];
  assert.ok(chunkId);

  const marks = createMarkController();
  let ids = 0;
  let zones = 0;
  const seen: MarkAttempt[] = [];
  const lost = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => (zones++ === 0 ? 'UTC' : 'Pacific/Auckland'),
    request: { chunkId, state: 'missed', expectedRevision: 1 },
    commit: async (attempt) => {
      seen.push(attempt);
      return save(attempt);
    },
    report: () => {
      throw new Error('response lost');
    },
  });
  assert.equal(lost.status, 'ambiguous');
  const stored = await db.get<{ due_at: number; local_day: string; state: string }>(
    'SELECT due_at, local_day, state FROM review_marks',
  );
  assert.ok(stored);
  const edited = await save({
    opId: 'edit', kind: 'chunk.update', source: 'human', confirmed: false, expectedRevision: 1,
    payload: { chunkId, body: 'alpha edited' },
  });
  assert.equal(edited.ok, true);
  const fresh = await getChunk(db, chunkId);
  assert.equal(fresh?.revision, 2);
  assert.equal(fresh?.body, 'alpha edited');

  const wrong = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => (zones++ === 0 ? 'UTC' : 'Pacific/Auckland'),
    request: { chunkId, state: 'got_it', expectedRevision: fresh?.revision ?? 2 },
    commit: async (attempt) => {
      seen.push(attempt);
      return save(attempt);
    },
    report: () => undefined,
  });
  assert.equal(wrong.status, 'blocked');
  if (wrong.status !== 'blocked') return;
  assert.equal(wrong.attempt.expectedRevision, 1);
  assert.equal(seen.length, 1);

  const held = marks.retained(chunkId);
  assert.equal(held?.opId, 'mark-1');
  const recovery = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => (zones++ === 0 ? 'UTC' : 'Pacific/Auckland'),
    request: { chunkId, state: 'missed', expectedRevision: fresh?.revision ?? 2 },
    commit: async (attempt) => {
      seen.push(attempt);
      return save(attempt);
    },
    report: () => undefined,
  });
  assert.equal(recovery.status, 'saved');
  if (recovery.status !== 'saved') return;
  assert.equal(recovery.result.duplicate, true);
  assert.equal(recovery.result.value.localDay, stored.local_day);
  assert.equal(recovery.result.value.dueAt, stored.due_at);
  assert.equal(recovery.result.value.state, 'missed');
  assert.equal(seen[1], held);
  assert.equal(seen[1]?.expectedRevision, 1);
  assert.equal(seen[1]?.payload.timeZone, 'UTC');
  assert.equal(ids, 1);
  assert.equal(zones, 1);
  assert.equal(marks.retained(chunkId), null);
  assert.equal((await getChunk(db, chunkId))?.revision, 2);
  assert.equal(await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 1);

  const again = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => 'UTC',
    request: { chunkId, state: 'got_it', expectedRevision: 2 },
    commit: async (attempt) => {
      seen.push(attempt);
      return save(attempt);
    },
    report: () => undefined,
  });
  assert.equal(again.status, 'saved');
  if (again.status !== 'saved') return;
  assert.equal(again.result.duplicate, false);
  assert.equal(again.result.value.state, 'got_it');
  assert.equal(seen[2]?.opId, 'mark-2');
  assert.equal(seen[2]?.expectedRevision, 2);
  assert.equal(ids, 2);
  assert.equal(await db.get<{ n: number; state: string }>('SELECT COUNT(*) AS n, MAX(state) AS state FROM review_marks').then((row) => row?.n), 1);
  assert.equal((await db.get<{ state: string }>('SELECT state FROM review_marks'))?.state, 'got_it');
  db.close();
});

test('a rejected held mark can be followed by a mark of the new revision', async () => {
  const marks = createMarkController();
  let ids = 0;
  const rejected = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => 'UTC',
    request: { chunkId: 'chunk', state: 'missed', expectedRevision: 1 },
    report: () => {
      throw new Error('should not paint a rejection');
    },
    commit: async () => ({ ok: false as const, error: { code: 'stale_revision' as const, message: 'stale' } }),
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(marks.retained('chunk'), null);
  let revision = 0;
  const next = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => 'UTC',
    request: { chunkId: 'chunk', state: 'got_it', expectedRevision: 2 },
    report: () => undefined,
    commit: async (attempt) => {
      revision = attempt.expectedRevision ?? 0;
      return {
        ok: true as const,
        duplicate: false,
        value: {
          chunkId: 'chunk',
          annotationId: null as string | null,
          state: 'got_it' as const,
          localDay: '2026-11-07',
          markedAt: 1,
          dueAt: 2,
          timeZone: 'UTC',
          stage: 'stonehenge' as const,
        },
      };
    },
  });
  assert.equal(next.status, 'saved');
  assert.equal(revision, 2);
  assert.equal(ids, 2);
});

test('blurring during a paused mark skips the late report and Today rereads when it finishes', async () => {
  const db = nodeDb();
  await migrateDb(db);
  const start = Date.parse('2026-11-07T12:00:00.000Z');
  let now = start;
  let id = 0;
  const save = createCommit(db, { now: () => now, newId: () => `id-${++id}` });
  const room = await save({
    opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await save({
    opId: 'chunk', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['alpha'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const chunkId = created.value.chunkIds[0];
  assert.ok(chunkId);
  const missed = await save(reviewMarkOperation({
    opId: 'missed', chunkId, state: 'missed', expectedRevision: 1, timeZone: 'UTC',
  }));
  assert.equal(missed.ok, true);
  now = start + 11 * 60 * 1000;

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  let paints = 0;
  let refreshes = 0;
  const marks = createMarkController();
  const unsubscribe = marks.subscribe(() => {
    refreshes += 1;
  });
  const flight = marks.submit({
    newId: () => 'got-it',
    timeZone: () => 'UTC',
    request: { chunkId, state: 'got_it', expectedRevision: 1 },
    report: () => {
      paints += 1;
    },
    commit: async (attempt) => {
      await gate;
      writes += 1;
      return save(attempt);
    },
  });
  marks.invalidate();
  assert.equal(writes, 0);
  assert.equal(refreshes, 0);
  assert.equal((await listDueChunks(db, now))[0]?.mark.state, 'missed');
  release();
  const outcome = await flight;
  assert.equal(writes, 1);
  assert.equal(paints, 0);
  assert.equal(refreshes, 1);
  assert.equal(outcome.status, 'saved');
  if (outcome.status === 'saved') assert.equal(outcome.painted, false);
  assert.equal((await listDueChunks(db, now)).length, 0);
  unsubscribe();
  db.close();
});
