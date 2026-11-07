import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { LIMITS } from '../src/data/operations.ts';
import { getRoom, listChunks, listDueChunks, listRooms } from '../src/data/queries.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import {
  cancelRoomMapping,
  chooseExistingRoom,
  chooseNewRoom,
  destinationForMapping,
  matchingRooms,
  roomNameFromSubject,
  unsetRoomMapping,
} from '../src/import/room-map.ts';
import { nodeDb } from './support/node-db.ts';

const HASH = 'a'.repeat(64);

function open() {
  const db = nodeDb();
  let id = 0;
  const commit = createCommit(db, { now: () => 1_700_000_000_000, newId: () => `id-${++id}` });
  return { db, commit };
}

async function setup() {
  const s = open();
  await migrateDb(s.db);
  return s;
}

async function tableCount(db: Db, table: string) {
  return (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0;
}

async function credits(db: Db, roomId: string) {
  return (await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM review_marks JOIN chunks ON chunks.id = review_marks.chunk_id WHERE chunks.room_id = ?`,
    [roomId],
  ))?.n ?? 0;
}

async function createRoom(s: Awaited<ReturnType<typeof setup>>, opId: string, name: string) {
  const room = await s.commit({
    opId, kind: 'room.create', source: 'human', confirmed: false, payload: { name },
  });
  assert.equal(room.ok, true);
  if (!room.ok) throw new Error('room');
  return room.value.roomId;
}

async function addChunks(s: Awaited<ReturnType<typeof setup>>, opId: string, roomId: string, bodies: string[]) {
  const created = await s.commit({
    opId, kind: 'chunk.create', source: 'human', confirmed: false, payload: { roomId, bodies },
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error('chunks');
  return created.value.chunkIds;
}

function mark(chunkId: string, opId: string) {
  return {
    opId,
    kind: 'review.mark' as const,
    source: 'human' as const,
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId, state: 'got_it' as const, timeZone: 'UTC' },
  };
}

function note(
  opId: string,
  destination: { roomId: string } | { name: string },
  sourceId = 'markdown:notes/Cells.md',
  fingerprint = HASH,
) {
  return {
    opId,
    kind: 'import.note' as const,
    source: 'import' as const,
    confirmed: true,
    payload: {
      sourceId,
      fingerprint,
      destination,
      bodies: ['# Cells\ntext'],
      subjects: ['cells', 'science'],
    },
  };
}

test('a reviewed subject is not a room until the user chooses one', () => {
  const rooms = [{ id: 'room-biology', name: 'Biology' }, { id: 'room-history', name: 'History' }];
  const unset = unsetRoomMapping();
  assert.equal(destinationForMapping(unset), null);
  assert.equal(destinationForMapping(cancelRoomMapping()), null);
  assert.deepEqual(matchingRooms(rooms, 'biology, science').map((room) => room.id), ['room-biology']);
  assert.equal(destinationForMapping(unset), null);
  assert.equal(roomNameFromSubject('  cell   study , science'), 'cell study');
  assert.equal(roomNameFromSubject(''), '');
  assert.equal(roomNameFromSubject('x'.repeat(LIMITS.roomName + 5)).length, LIMITS.roomName);

  const existing = chooseExistingRoom('room-biology');
  assert.deepEqual(destinationForMapping(existing), { roomId: 'room-biology' });
  assert.equal(destinationForMapping(cancelRoomMapping()), null);
  assert.equal(destinationForMapping(chooseExistingRoom('  ')), null);

  assert.equal(destinationForMapping(chooseNewRoom('   ')), null);
  assert.equal(destinationForMapping(chooseNewRoom('x'.repeat(LIMITS.roomName + 1))), null);
  assert.deepEqual(destinationForMapping(chooseNewRoom('  Lab   notes  ')), { name: 'Lab notes' });
  assert.equal(matchingRooms(rooms, 'physics').length, 0);
});

test('cancel and an unconfirmed import write nothing', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  assert.equal(destinationForMapping(cancelRoomMapping()), null);
  const cancelled = await s.commit({ ...note('op-cancel', { name: 'cells' }), confirmed: false });
  assert.equal(cancelled.ok, false);
  if (cancelled.ok) return;
  assert.equal(cancelled.error.code, 'unconfirmed');
  for (const table of ['rooms', 'chunks', 'chunk_subjects', 'import_sources', 'applied_ops', 'review_marks']) {
    assert.equal(await tableCount(s.db, table), 0);
  }
});

test('an existing room receives the note and no other room is created', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const biology = await createRoom(s, 'biology', 'Biology');
  const history = await createRoom(s, 'history', 'History');
  const historyChunks = await addChunks(s, 'history-notes', history, ['history note']);
  const destination = destinationForMapping(chooseExistingRoom(biology));
  assert.deepEqual(destination, { roomId: biology });
  const saved = await s.commit(note('import-biology', destination!));
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.roomId, biology);
  assert.equal(saved.value.skipped, false);
  assert.deepEqual((await listChunks(s.db, biology)).map((chunk) => chunk.subjects), [['cells', 'science']]);
  assert.deepEqual((await listChunks(s.db, history)).map((chunk) => chunk.id), historyChunks);
  assert.deepEqual((await listRooms(s.db)).map((room) => room.name).sort(), ['Biology', 'History']);
  assert.equal((await getRoom(s.db, biology))?.stage, 'stonehenge');
  assert.equal(await credits(s.db, biology), 0);
});

test('a requested new room is created only by the confirmed import', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const destination = destinationForMapping(chooseNewRoom(roomNameFromSubject('cells, science')));
  assert.deepEqual(destination, { name: 'cells' });
  assert.equal(await tableCount(s.db, 'rooms'), 0);
  const saved = await s.commit(note('import-new', destination!));
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const rooms = await listRooms(s.db);
  assert.deepEqual(rooms.map((room) => room.name), ['cells']);
  assert.equal(rooms[0]?.stage, 'stonehenge');
  assert.equal(await credits(s.db, saved.value.roomId), 0);
  assert.equal((await listDueChunks(s.db, 1_700_000_000_000 + 86_400_000)).length, 0);
});

test('a missing room can be retried and a successful import is idempotent', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const failed = await s.commit(note('op-retry', { roomId: 'missing-room' }));
  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.error.code, 'not_found');
  assert.equal(await tableCount(s.db, 'rooms'), 0);
  assert.equal(await tableCount(s.db, 'applied_ops'), 0);
  const retried = await s.commit(note('op-retry', { name: 'cells' }));
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.duplicate, false);
  const again = await s.commit(note('op-retry', { name: 'cells' }));
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.duplicate, true);
  assert.equal(await tableCount(s.db, 'rooms'), 1);
  assert.equal(await tableCount(s.db, 'chunks'), 1);
  const renamed = note('op-same-source', { name: 'another room' });
  const skipped = await s.commit(renamed);
  assert.equal(skipped.ok, true);
  if (!skipped.ok) return;
  assert.equal(skipped.value.skipped, true);
  assert.equal(skipped.value.roomId, retried.value.roomId);
  assert.deepEqual((await listRooms(s.db)).map((room) => room.name), ['cells']);
  assert.equal((await getRoom(s.db, retried.value.roomId))?.stage, 'stonehenge');
});

test('import leaves other rooms, credits and stages untouched', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const history = await createRoom(s, 'history', 'History');
  const biology = await createRoom(s, 'biology', 'Biology');
  const brick = await createRoom(s, 'brick-room', 'Brick');
  const historyChunks = await addChunks(s, 'history-chunks', history, ['history']);
  const biologyChunks = await addChunks(s, 'biology-chunks', biology, ['one', 'two']);
  const brickChunks = await addChunks(s, 'brick-chunks', brick, ['a', 'b', 'c']);
  assert.equal((await s.commit(mark(historyChunks[0]!, 'mark-history'))).ok, true);
  assert.equal((await s.commit(mark(biologyChunks[0]!, 'mark-biology-1'))).ok, true);
  assert.equal((await s.commit(mark(biologyChunks[1]!, 'mark-biology-2'))).ok, true);
  for (let i = 0; i < brickChunks.length; i += 1) {
    assert.equal((await s.commit(mark(brickChunks[i]!, `mark-brick-${i}`))).ok, true);
  }
  assert.equal((await getRoom(s.db, biology))?.stage, 'stonehenge');
  assert.equal((await getRoom(s.db, brick))?.stage, 'brick');

  const imported = await s.commit(note('import-biology', { roomId: biology }, 'markdown:notes/Cells.md', 'b'.repeat(64)));
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  const denied = await s.commit({
    opId: 'import-mark',
    kind: 'review.mark',
    source: 'import',
    confirmed: true,
    expectedRevision: 1,
    payload: { chunkId: imported.value.chunkIds[0]!, state: 'got_it', timeZone: 'UTC' },
  });
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.error.code, 'forbidden');

  assert.equal((await getRoom(s.db, biology))?.stage, 'stonehenge');
  assert.equal(await credits(s.db, biology), 2);
  assert.equal((await listChunks(s.db, biology)).length, 3);
  assert.equal((await getRoom(s.db, history))?.stage, 'stonehenge');
  assert.equal(await credits(s.db, history), 1);
  assert.deepEqual((await listChunks(s.db, history)).map((chunk) => chunk.id), historyChunks);
  assert.equal((await getRoom(s.db, brick))?.stage, 'brick');
  assert.equal(await credits(s.db, brick), 3);
  assert.equal((await listChunks(s.db, brick)).length, 3);
  assert.deepEqual((await listRooms(s.db)).map((room) => room.name).sort(), ['Biology', 'Brick', 'History']);

  const due = await listDueChunks(s.db, 1_700_000_000_000 + 4 * 86_400_000);
  assert.deepEqual(due.map((item) => item.chunk.id).sort(), [...historyChunks, ...biologyChunks, ...brickChunks].sort());
  assert.equal(due.some((item) => item.chunk.id === imported.value.chunkIds[0]), false);
});
