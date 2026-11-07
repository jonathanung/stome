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
import {
  CLEANUP_FAILED_MESSAGE,
  STORAGE_DEGRADED_MESSAGE,
  createCaptureController,
  type CaptureStorage,
  type SaveResult,
} from '../src/features/capture/session.ts';
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

function memoryStorage(options?: { failGet?: boolean; failSet?: boolean; failClear?: boolean }): CaptureStorage & { failClear: boolean } {
  const map = new Map<string, string>();
  const storage = {
    failClear: options?.failClear ?? false,
    getItem(key: string) {
      if (options?.failGet) throw new Error('security');
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (options?.failSet) throw new Error('quota');
      if (storage.failClear && value.includes('"text":""')) throw new Error('quota');
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
  return storage;
}

async function lecture(db: Db, opId: string, name: string) {
  let generated = 0;
  const commit = createCommit(db, { now: () => 1_000, newId: () => `${opId}-id-${++generated}` });
  const room = await commit({
    opId,
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name },
  });
  assert.equal(room.ok, true);
  if (!room.ok) throw new Error('room');
  return { commit, roomId: room.value.roomId };
}

test('text typed while a save is pending stays after that save lands', async () => {
  const db = nodeDb();
  await migrateDb(db);
  const { commit, roomId } = await lecture(db, 'room', 'Lecture');
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  let ids = 0;
  const controller = createCaptureController({
    storage: memoryStorage(),
    newId: () => `op-${++ids}`,
    destination: async () => ({ roomId }),
    commit: async (operation) => {
      started();
      await gate;
      const result = await commit(operation);
      return result.ok ? { ok: true, duplicate: result.duplicate } : { ok: false, message: result.error.message };
    },
  });
  controller.edit('line A');
  const saving = controller.save();
  await startedPromise;
  assert.equal(controller.getState().busy, true);
  controller.edit('line B');
  assert.equal(controller.getState().draft.text, 'line B');
  assert.notEqual(controller.getState().draft.opId, 'op-1');
  release();
  const outcome = await saving;
  assert.equal(outcome.closePanel, false);
  assert.equal(controller.getState().draft.text, 'line B');
  assert.equal(controller.getState().busy, false);
  const chunks = await listChunks(db, roomId);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.body, 'line A');
  db.close();
});

test('a landed save with failed cleanup is recovered after reload, an edit, and a room change', async () => {
  const db = nodeDb();
  await migrateDb(db);
  const first = await lecture(db, 'room-a', 'Lecture');
  const second = await lecture(db, 'room-b', 'Lab');
  const storage = memoryStorage({ failClear: true });
  let ids = 0;
  let roomId = first.roomId;
  const commit = async (operation: Parameters<typeof first.commit>[0]): Promise<SaveResult> => {
    const result = await first.commit(operation);
    if (!result.ok) return { ok: false, message: result.error.message };
    return { ok: true, duplicate: result.duplicate };
  };
  const controller = createCaptureController({
    storage,
    newId: () => `op-${++ids}`,
    destination: async () => ({ roomId }),
    commit,
  });
  controller.edit('mitochondria');
  const landed = await controller.save();
  assert.equal(landed.closePanel, false);
  assert.equal(controller.getState().draft.text, 'mitochondria');
  assert.deepEqual(controller.getState().notice, { kind: 'saved', cleanupFailed: true });
  assert.equal(CLEANUP_FAILED_MESSAGE.includes('saved'), true);
  assert.equal((await listChunks(db, first.roomId)).length, 1);

  roomId = second.roomId;
  let restoredIds = 100;
  const restored = createCaptureController({
    storage,
    newId: () => `op-${++restoredIds}`,
    destination: async () => ({ roomId }),
    commit,
  });
  assert.equal(restored.getState().draft.text, 'mitochondria');
  assert.equal(restored.getState().unresolved?.roomId, first.roomId);
  restored.edit('chloroplast');
  restored.noteDestination(second.roomId);
  const recovered = await restored.save();
  assert.equal(recovered.closePanel, false);
  assert.equal(restored.getState().draft.text, 'chloroplast');
  assert.equal((await listChunks(db, first.roomId)).length, 1);
  assert.equal((await listChunks(db, first.roomId))[0]?.body, 'mitochondria');
  assert.equal((await listChunks(db, second.roomId)).length, 0);

  storage.failClear = false;
  const saved = await restored.save();
  assert.equal(saved.closePanel, true);
  assert.equal(restored.getState().draft.text, '');
  const moved = await listChunks(db, second.roomId);
  assert.equal(moved.length, 1);
  assert.equal(moved[0]?.body, 'chloroplast');
  assert.equal((await listChunks(db, first.roomId)).length, 1);
  db.close();
});

test('throwing storage reads and writes keep the line and warn instead of crashing', async () => {
  const blocked = createCaptureController({
    storage: memoryStorage({ failGet: true }),
    newId: () => 'op-1',
    destination: async () => ({ needsRoom: true }),
    commit: async () => ({ ok: false, message: 'unused' }),
  });
  assert.equal(blocked.getState().notice?.kind, 'degraded');
  assert.equal(STORAGE_DEGRADED_MESSAGE.includes('reload'), true);

  const db = nodeDb();
  await migrateDb(db);
  const { commit, roomId } = await lecture(db, 'room', 'Lecture');
  const storage = memoryStorage({ failSet: true });
  const controller = createCaptureController({
    storage,
    newId: () => 'op-9',
    destination: async () => ({ roomId }),
    commit: async (operation) => {
      const result = await commit(operation);
      return result.ok ? { ok: true, duplicate: result.duplicate } : { ok: false, message: result.error.message };
    },
  });
  controller.edit('kept while storage throws');
  assert.equal(controller.getState().draft.text, 'kept while storage throws');
  assert.equal(controller.getState().notice?.kind, 'degraded');
  const saved = await controller.save();
  assert.equal(saved.closePanel, false);
  assert.equal(controller.getState().draft.text, 'kept while storage throws');
  assert.deepEqual(controller.getState().notice, { kind: 'saved', cleanupFailed: true });
  const chunks = await listChunks(db, roomId);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.body, 'kept while storage throws');
  db.close();
});
