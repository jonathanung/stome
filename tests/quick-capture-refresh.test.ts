import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { Chunk } from '../src/data/models.ts';
import { listChunks, listRoomAnnotations } from '../src/data/queries.ts';
import {
  commitCapture,
  watchRoomCaptureRefresh,
} from '../src/features/capture/commitSignal.ts';
import { captureOperation } from '../src/features/capture/draft.ts';
import {
  createCaptureController,
  type CaptureStorage,
} from '../src/features/capture/session.ts';
import { createRoomLoadCoordinator } from '../src/features/room/roomLoadCoordinator.ts';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('the capture panel and room screen use the production wiring', () => {
  // React Native screens cannot be rendered in the node test runner, so this
  // guard fails if either side stops calling the functions exercised above.
  const read = (file: string) => readFileSync(path.join(import.meta.dirname, '..', file), 'utf8');
  assert.match(read('src/features/capture/QuickCapture.tsx'), /commit:\s*\(operation\)\s*=>\s*commitCapture\(/);
  assert.match(read('src/screens/RoomScreen.tsx'), /watchRoomCaptureRefresh\(id \?\? null, refresh\)/);
});

test('a capture during the initial load waits for it and then refreshes', () => {
  const loads = createRoomLoadCoordinator();
  const initial = loads.startInitial();

  // The capture lands before the first read; the refresh must not invalidate it.
  assert.deepEqual(loads.startRefresh(), { run: false });
  assert.equal(loads.isLatest(initial), true, 'the initial load is still the newest read');
  assert.equal(loads.initialSucceeded(), true, 'the deferred refresh runs after the room renders');

  // Once loaded, a refresh runs as its own read and supersedes the initial one.
  const refresh = loads.startRefresh();
  assert.equal(refresh.run, true);
  if (!refresh.run) return;
  assert.equal(loads.isLatest(refresh.token), true);
  assert.equal(loads.isLatest(initial), false, 'the older initial load must not apply after the refresh');
});

test('a slow older room load cannot overwrite the quick capture refresh', async () => {
  const loads = createRoomLoadCoordinator();
  loads.startInitial();
  assert.equal(loads.initialSucceeded(), false);
  const applied: string[][] = [];
  const run = async (source: Promise<string[]>) => {
    const plan = loads.startRefresh();
    if (!plan.run) return;
    const value = await source;
    if (loads.isLatest(plan.token)) applied.push(value);
  };

  const older = deferred<string[]>();
  const newer = deferred<string[]>();
  const olderRun = run(older.promise);
  const newerRun = run(newer.promise);

  // The capture refresh finishes first; the older room read finishes last.
  newer.resolve(['the captured note']);
  await newerRun;
  older.resolve([]);
  await olderRun;
  assert.deepEqual(applied, [['the captured note']], 'the stale older load must be dropped');
});

test('a failed initial load clears the deferred refresh, and blur drops in-flight reads', () => {
  const loads = createRoomLoadCoordinator();
  loads.startInitial();
  assert.deepEqual(loads.startRefresh(), { run: false });
  loads.initialFailed();
  assert.equal(loads.initialSucceeded(), false, 'a failed first load must not trigger the deferred refresh');

  const refresh = loads.startRefresh();
  assert.equal(refresh.run, true);
  if (!refresh.run) return;
  loads.invalidate();
  assert.equal(loads.isLatest(refresh.token), false, 'blur must drop a read still in flight');
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
  // The production room-side wiring: reload when a capture announces this room.
  const stop = watchRoomCaptureRefresh(
    roomId,
    () => {
      pending = listChunks(db, roomId).then((chunks) => { loads.push(chunks); });
      return pending;
    },
  );

  const controller = createCaptureController({
    storage: memoryStorage(),
    newId: () => 'op-1',
    destination: async () => ({ roomId }),
    // The production capture-side wiring: QuickCapture commits through this wrapper.
    commit: (operation) => commitCapture(operation, async (capture) => {
      const result = await commit(capture);
      return result.ok
        ? { ok: true, duplicate: result.duplicate }
        : { ok: false, message: result.error.message };
    }),
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

test('a capture into another room does not reload, and unmount unsubscribes', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let generated = 0;
  const commit = createCommit(db, { now: () => 1_000, newId: () => `generated-${++generated}` });
  const roomId = await room(commit, 'room-a', 'Lecture');
  const otherRoomId = await room(commit, 'room-b', 'Other');

  let refreshes = 0;
  const stop = watchRoomCaptureRefresh(roomId, async () => { refreshes += 1; });
  const save = (text: string, opId: string, target: string) => commitCapture(
    captureOperation({ text, opId }, target),
    async (capture) => {
      const result = await commit(capture);
      return result.ok
        ? { ok: true, duplicate: result.duplicate }
        : { ok: false, message: result.error.message };
    },
  );

  await save('elsewhere', 'op-other', otherRoomId);
  assert.equal(refreshes, 0, 'a capture into another room must not reload this one');

  await save('here', 'op-here', roomId);
  assert.equal(refreshes, 1);

  stop();
  await save('after unmount', 'op-after', roomId);
  assert.equal(refreshes, 1, 'the room screen must unsubscribe on blur or unmount');
  db.close();
});

test('a stale failed load cannot report an error after a newer success', () => {
  const loads = createRoomLoadCoordinator();
  loads.startInitial();
  loads.initialSucceeded();

  const older = loads.startRefresh();
  const newer = loads.startRefresh();
  assert.equal(older.run, true);
  assert.equal(newer.run, true);
  if (!older.run || !newer.run) return;

  assert.equal(loads.isLatest(newer.token), true);
  assert.equal(loads.isLatest(older.token), false, 'the stale failure must not show an error on a healthy room');
});

test('a rejected room refresh never becomes an unhandled rejection', async () => {
  const stop = watchRoomCaptureRefresh('room-a', async () => { throw new Error('database locked'); });
  await commitCapture(
    captureOperation({ text: 'saved', opId: 'op-a' }, 'room-a'),
    async () => ({ ok: true, duplicate: false }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  stop();
});
