import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { ReviewState } from '../src/db/schema.ts';
import { getRoom, listChunks } from '../src/data/queries.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

const DAY = 24 * 60 * 60 * 1000;

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

async function roomWith(bodies: string[], now: number) {
  const s = open(now);
  await migrateDb(s.db);
  const room = await s.commit({
    opId: 'room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  if (!room.ok) throw new Error(room.error.message);
  const created = await s.commit({
    opId: 'chunks',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies },
  });
  if (!created.ok) throw new Error(created.error.message);
  return { ...s, roomId: room.value.roomId, chunkIds: created.value.chunkIds };
}

function mark(chunkId: string, opId: string, state: ReviewState, timeZone: string) {
  return {
    opId,
    kind: 'review.mark' as const,
    source: 'human' as const,
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId, state, timeZone },
  };
}

async function stageOf(db: Db, roomId: string) {
  const room = await getRoom(db, roomId);
  if (!room) throw new Error('room missing');
  return room;
}

test('the third human chunk-day promotes to brick and a replay does not', async () => {
  const now = Date.parse('2026-11-07T18:00:00Z');
  const s = await roomWith(['one', 'two', 'three'], now);
  const states = ['missed', 'unclear', 'got_it'] as const;
  for (let i = 0; i < 2; i += 1) {
    const saved = await s.commit(mark(s.chunkIds[i] ?? '', `mark-${i}`, states[i] ?? 'got_it', 'UTC'));
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.value.stage, 'stonehenge');
  }
  assert.equal((await stageOf(s.db, s.roomId)).stage, 'stonehenge');
  const third = mark(s.chunkIds[2] ?? '', 'mark-2', 'got_it', 'UTC');
  const promoted = await s.commit(third);
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  assert.equal(promoted.value.stage, 'brick');
  const room = await stageOf(s.db, s.roomId);
  assert.equal(room.stage, 'brick');
  assert.equal(room.revision, 1);
  const replay = await s.commit(third);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.duplicate, true);
  assert.equal(replay.value.stage, 'brick');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 3);
  s.at(now + DAY);
  const fourth = await s.commit(mark(s.chunkIds[0] ?? '', 'mark-3', 'missed', 'UTC'));
  assert.equal(fourth.ok, true);
  if (!fourth.ok) return;
  assert.equal(fourth.value.localDay, '2026-11-08');
  assert.equal((await stageOf(s.db, s.roomId)).stage, 'brick');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 4);
  s.db.close();
});

test('the same local day updates the mark without a second credit', async () => {
  const now = Date.parse('2026-11-07T18:00:00Z');
  const s = await roomWith(['one', 'two', 'three'], now);
  const first = await s.commit(mark(s.chunkIds[0] ?? '', 'day-missed', 'missed', 'UTC'));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  s.at(now + 60_000);
  const again = await s.commit(mark(s.chunkIds[0] ?? '', 'day-got', 'got_it', 'UTC'));
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.value.localDay, '2026-11-07');
  assert.equal(again.value.dueAt, now + 60_000 + 3 * DAY);
  assert.equal(again.value.stage, 'stonehenge');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 1);
  const secondChunk = await s.commit(mark(s.chunkIds[1] ?? '', 'other-chunk', 'unclear', 'UTC'));
  assert.equal(secondChunk.ok, true);
  if (!secondChunk.ok) return;
  assert.equal(secondChunk.value.stage, 'stonehenge');
  s.at(now + DAY);
  const nextDay = await s.commit(mark(s.chunkIds[0] ?? '', 'next-day', 'missed', 'UTC'));
  assert.equal(nextDay.ok, true);
  if (!nextDay.ok) return;
  assert.equal(nextDay.value.localDay, '2026-11-08');
  assert.equal(nextDay.value.stage, 'brick');
  assert.equal((await stageOf(s.db, s.roomId)).stage, 'brick');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 3);
  s.db.close();
});

test('the calendar day follows the time zone saved with the mark', async () => {
  const now = Date.parse('2026-11-07T06:30:00Z');
  const s = await roomWith(['one', 'two', 'three'], now);
  const bay = await s.commit(mark(s.chunkIds[0] ?? '', 'bay', 'got_it', 'America/Cambridge_Bay'));
  assert.equal(bay.ok, true);
  if (!bay.ok) return;
  assert.equal(bay.value.localDay, '2026-11-06');
  const utc = await s.commit(mark(s.chunkIds[0] ?? '', 'utc', 'missed', 'UTC'));
  assert.equal(utc.ok, true);
  if (!utc.ok) return;
  assert.equal(utc.value.localDay, '2026-11-07');
  assert.equal(utc.value.stage, 'stonehenge');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 2);
  s.at(Date.parse('2026-11-08T07:30:00Z'));
  const nextBayDay = await s.commit(mark(s.chunkIds[0] ?? '', 'bay-next', 'unclear', 'America/Cambridge_Bay'));
  assert.equal(nextBayDay.ok, true);
  if (!nextBayDay.ok) return;
  assert.equal(nextBayDay.value.localDay, '2026-11-08');
  assert.equal(nextBayDay.value.stage, 'brick');
  s.db.close();
});

test('a failed promotion rolls the qualifying mark back with it', async () => {
  const now = Date.parse('2026-11-07T18:00:00Z');
  const s = await roomWith(['one', 'two', 'three'], now);
  assert.equal((await s.commit(mark(s.chunkIds[0] ?? '', 'a', 'got_it', 'UTC'))).ok, true);
  assert.equal((await s.commit(mark(s.chunkIds[1] ?? '', 'b', 'got_it', 'UTC'))).ok, true);
  const failing: Db = {
    ...s.db,
    async run(sql, params) {
      if (sql.includes("stage = 'brick'")) throw new Error('injected stage failure');
      return s.db.run(sql, params);
    },
  };
  const blocked = await createCommit(failing, { now: () => now, newId: () => 'fail-id' })(mark(s.chunkIds[2] ?? '', 'c', 'got_it', 'UTC'));
  assert.equal(blocked.ok, false);
  assert.equal((await stageOf(s.db, s.roomId)).stage, 'stonehenge');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 2);
  assert.equal(await s.db.get('SELECT op_id FROM applied_ops WHERE op_id = ?', ['c']), null);
  const promoted = await s.commit(mark(s.chunkIds[2] ?? '', 'c', 'got_it', 'UTC'));
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  assert.equal(promoted.value.stage, 'brick');
  s.db.close();
});

test('edits, pins, imports, and reads do not credit or promote', async () => {
  const now = Date.parse('2026-11-07T18:00:00Z');
  const s = await roomWith(['photosynthesis makes sugar'], now);
  const chunkId = s.chunkIds[0] ?? '';
  const edited = await s.commit({
    opId: 'edit',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId, body: 'edited sugar' },
  });
  assert.equal(edited.ok, true);
  const pinned = await s.commit({
    opId: 'pin',
    kind: 'annotation.create',
    source: 'ai',
    confirmed: true,
    expectedRevision: 2,
    payload: { chunkId, type: 'ai_answer', anchor: { start: 0, end: 4 }, payload: { answer: 'sugar' } },
  });
  assert.equal(pinned.ok, true);
  const aiMark = await s.commit({
    ...mark(chunkId, 'ai-mark', 'got_it', 'UTC'),
    source: 'ai',
    confirmed: true,
    expectedRevision: 2,
  });
  const importMark = await s.commit({
    ...mark(chunkId, 'import-mark', 'got_it', 'UTC'),
    source: 'import',
    confirmed: true,
    expectedRevision: 2,
  });
  assert.equal(aiMark.ok, false);
  assert.equal(importMark.ok, false);
  if (aiMark.ok || importMark.ok) return;
  assert.equal(aiMark.error.code, 'forbidden');
  assert.equal(importMark.error.code, 'forbidden');
  const imported = await s.commit({
    opId: 'import-note',
    kind: 'import.note',
    source: 'import',
    confirmed: true,
    payload: {
      sourceId: 'markdown:vault/Biology/Cells.md',
      fingerprint: 'ab'.repeat(32),
      destination: { roomId: s.roomId },
      bodies: ['imported cells'],
      subjects: ['biology'],
    },
  });
  assert.equal(imported.ok, true);
  await listChunks(s.db, s.roomId);
  const room = await stageOf(s.db, s.roomId);
  assert.equal(room.stage, 'stonehenge');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 0);
  const removed = await s.commit({
    opId: 'delete-credit',
    kind: 'chunk.delete',
    source: 'human',
    confirmed: false,
    expectedRevision: 2,
    payload: { chunkId },
  });
  assert.equal(removed.ok, true);
  assert.equal((await stageOf(s.db, s.roomId)).stage, 'stonehenge');
  s.db.close();
});

test('brick stays brick after a credited chunk is deleted', async () => {
  const now = Date.parse('2026-11-07T18:00:00Z');
  const s = await roomWith(['one', 'two', 'three'], now);
  for (let i = 0; i < 3; i += 1) {
    const saved = await s.commit(mark(s.chunkIds[i] ?? '', `keep-${i}`, 'got_it', 'UTC'));
    assert.equal(saved.ok, true);
  }
  assert.equal((await stageOf(s.db, s.roomId)).stage, 'brick');
  const removed = await s.commit({
    opId: 'drop-one',
    kind: 'chunk.delete',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkIds[0] ?? '' },
  });
  assert.equal(removed.ok, true);
  assert.equal((await stageOf(s.db, s.roomId)).stage, 'brick');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 2);
  s.db.close();
});

test('credits in one room do not promote another', async () => {
  const now = Date.parse('2026-11-07T18:00:00Z');
  const s = await roomWith(['one', 'two', 'three'], now);
  const other = await s.commit({
    opId: 'other-room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'chemistry' },
  });
  assert.equal(other.ok, true);
  if (!other.ok) return;
  const otherChunks = await s.commit({
    opId: 'other-chunks',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: other.value.roomId, bodies: ['acid'] },
  });
  assert.equal(otherChunks.ok, true);
  if (!otherChunks.ok) return;
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await s.commit(mark(s.chunkIds[i] ?? '', `bio-${i}`, 'got_it', 'UTC'))).ok, true);
  }
  const chemistry = await s.commit(mark(otherChunks.value.chunkIds[0] ?? '', 'chem', 'missed', 'UTC'));
  assert.equal(chemistry.ok, true);
  if (!chemistry.ok) return;
  assert.equal(chemistry.value.stage, 'stonehenge');
  assert.equal((await stageOf(s.db, s.roomId)).stage, 'brick');
  assert.equal((await stageOf(s.db, other.value.roomId)).stage, 'stonehenge');
  s.db.close();
});
