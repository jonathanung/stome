import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { Chunk } from '../src/data/models.ts';
import { listChunks, listRoomAnnotations } from '../src/data/queries.ts';
import {
  announceCaptureCommit,
  watchCaptureCommits,
} from '../src/features/capture/commitSignal.ts';
import { captureOperation } from '../src/features/capture/draft.ts';
import {
  createCaptureController,
  type CaptureStorage,
} from '../src/features/capture/session.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

function memoryStorage(): CaptureStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

async function room(commit: ReturnType<typeof createCommit>, opId: string, name: string): Promise<string> {
  const result = await commit({
    opId,
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name },
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('room');
  return result.value.roomId;
}

test('a capture commit refreshes the focused room and only that room', () => {
  let refreshes = 0;
  const stop = watchCaptureCommits('room-a', () => { refreshes += 1; });

  announceCaptureCommit('room-b');
  assert.equal(refreshes, 0, 'a capture into another room must not reload this one');

  announceCaptureCommit('room-a');
  assert.equal(refreshes, 1);

  stop();
  announceCaptureCommit('room-a');
  assert.equal(refreshes, 1, 'the room screen must unsubscribe on unmount');

  assert.equal(typeof watchCaptureCommits(null, () => { throw new Error('unreachable'); }), 'function');
});

test('saving from quick capture makes the room see exactly one chunk without a reload', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let generated = 0;
  const commit = createCommit(db, { now: () => 1_000, newId: () => `generated-${++generated}` });
  const roomId = await room(commit, 'room-a', 'Lecture');
  const otherRoomId = await room(commit, 'room-b', 'Other');

  const loads: Chunk[][] = [];
  let pending: Promise<void> = Promise.resolve();
  // Mirrors RoomScreen: the listener starts an async reload of the room it shows.
  const stop = watchCaptureCommits(roomId, () => {
    pending = listChunks(db, roomId).then((chunks) => { loads.push(chunks); });
  });

  const controller = createCaptureController({
    storage: memoryStorage(),
    newId: () => 'op-1',
    destination: async () => ({ roomId }),
    // Mirrors QuickCapture's live commit: announce the room after the write lands.
    commit: async (operation) => {
      const result = await commit(operation);
      if (!result.ok) return { ok: false, message: result.error.message };
      announceCaptureCommit(operation.payload.roomId);
      return { ok: true, duplicate: result.duplicate };
    },
  });

  controller.edit('the mitochondria is the powerhouse');
  const saved = await controller.save();
  await pending;

  assert.equal(saved.closePanel, true);
  assert.equal(loads.length, 1, 'the focused room reloads once after the capture lands');
  assert.equal(loads[0]?.length, 1, 'the new chunk is visible without a reload');
  assert.equal(loads[0]?.[0]?.body, 'the mitochondria is the powerhouse');

  // A page reload reads the same rows again; nothing is duplicated.
  const afterReload = await listChunks(db, roomId);
  assert.equal(afterReload.length, 1);
  assert.equal(afterReload[0]?.id, loads[0]?.[0]?.id);
  assert.equal((await listRoomAnnotations(db, roomId)).length, 0);
  assert.equal((await listChunks(db, otherRoomId)).length, 0, 'the note went only to the focused room');

  // A duplicate commit for the same capture is still a single row after a refresh.
  const replay = await commit(captureOperation({ text: 'the mitochondria is the powerhouse', opId: 'op-1' }, roomId));
  assert.equal(replay.ok, true);
  if (replay.ok) assert.equal(replay.duplicate, true);
  await (pending = listChunks(db, roomId).then((chunks) => { loads.push(chunks); }));
  assert.equal(loads.at(-1)?.length, 1);

  stop();
  db.close();
});
