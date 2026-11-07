import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { listChunks } from '../src/data/queries.ts';
import {
  canSubmit,
  captureOperation,
  emptyDraft,
  finishDraft,
  parseDraft,
} from '../src/features/capture/draft.ts';
import { isCaptureShortcut } from '../src/features/capture/shortcut.ts';
import { chooseCaptureRoom, roomIdFromPath } from '../src/features/capture/target.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

const shortcut = {
  code: 'KeyN',
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
};

test('Alt+N counts only while this tab is focused and visible', () => {
  assert.equal(isCaptureShortcut(shortcut, true, true), true);
  assert.equal(isCaptureShortcut(shortcut, false, true), false);
  assert.equal(isCaptureShortcut(shortcut, true, false), false);
  assert.equal(isCaptureShortcut({ ...shortcut, repeat: true }, true, true), false);
  assert.equal(isCaptureShortcut({ ...shortcut, altKey: false }, true, true), false);
  assert.equal(isCaptureShortcut({ ...shortcut, ctrlKey: true }, true, true), false);
  assert.equal(isCaptureShortcut({ ...shortcut, code: 'KeyK' }, true, true), false);
});

test('capture uses the current room, then the last room, and never an inbox', () => {
  assert.equal(roomIdFromPath('/rooms/room-a'), 'room-a');
  assert.equal(roomIdFromPath('/rooms/room-a/review'), 'room-a');
  assert.equal(roomIdFromPath('/'), null);
  assert.deepEqual(
    chooseCaptureRoom({ pathname: '/rooms/room-a', lastRoomId: 'room-b', roomIds: ['room-a', 'room-b'] }),
    { roomId: 'room-a', source: 'current' },
  );
  assert.deepEqual(
    chooseCaptureRoom({ pathname: '/', lastRoomId: 'room-b', roomIds: ['room-a', 'room-b'] }),
    { roomId: 'room-b', source: 'last' },
  );
  assert.deepEqual(
    chooseCaptureRoom({ pathname: '/rooms/missing', lastRoomId: 'gone', roomIds: ['room-a'] }),
    { needsRoom: true },
  );
});

test('a failed save keeps the text and operation id, and the retry writes one chunk', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let fail = true;
  const wrapped: Db = {
    exec: (sql) => db.exec(sql),
    get: (sql, params) => db.get(sql, params),
    all: (sql, params) => db.all(sql, params),
    async run(sql, params) {
      if (fail && sql.includes('INSERT INTO chunks')) throw new Error('disk full');
      return db.run(sql, params);
    },
    transaction: (task) => db.transaction(task),
  };
  const commit = createCommit(wrapped, { now: () => 1_000, newId: () => 'generated' });
  const room = await commit({
    opId: 'room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'Lecture' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;

  let draft = emptyDraft(() => 'op-1');
  assert.equal(canSubmit(draft, false), false);
  draft = { text: 'mitochondria', opId: draft.opId };
  assert.equal(canSubmit(draft, true), false);
  const operation = captureOperation(draft, room.value.roomId);
  assert.equal(operation.source, 'human');
  assert.equal(operation.kind, 'chunk.create');
  assert.deepEqual(operation.payload.bodies, ['mitochondria']);

  const failed = await commit(operation);
  assert.equal(failed.ok, false);
  draft = finishDraft(draft, failed.ok, () => 'op-2');
  assert.deepEqual(draft, { text: 'mitochondria', opId: 'op-1' });
  assert.equal((await listChunks(db, room.value.roomId)).length, 0);

  fail = false;
  const saved = await commit(captureOperation(draft, room.value.roomId));
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.duplicate, false);
  draft = finishDraft(draft, true, () => 'op-2');
  assert.deepEqual(draft, { text: '', opId: 'op-2' });
  const chunks = await listChunks(db, room.value.roomId);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.body, 'mitochondria');

  const replay = await commit({ ...operation, payload: { ...operation.payload, bodies: ['a different line'] } });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.duplicate, true);
  assert.equal((await listChunks(db, room.value.roomId)).length, 1);
  assert.equal(chunks[0]?.body, 'mitochondria');
  const marks = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks');
  assert.equal(marks?.n, 0);
  const stored = parseDraft(JSON.stringify({ text: 'still here', opId: 'op-1' }));
  assert.deepEqual(stored, { text: 'still here', opId: 'op-1' });
  assert.equal(parseDraft('not json'), null);
  db.close();
});
