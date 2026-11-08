import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { getChunk, listChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { notifyLocalChanges, subscribeLocalChanges } from '../src/data/local-change.ts';
import { commitDeferredDelete, restoreDeferredBody } from '../src/features/notes/deferred-delete.ts';
import { nodeDb } from './support/node-db.ts';

async function note(body: string) {
  const db = nodeDb();
  await migrateDb(db);
  let n = 0;
  const commit = createCommit(db, { newId: () => `id-${++n}`, now: () => 1 });
  const room = await commit({ opId: 'room', kind: 'room.create', payload: { name: 'bio' }, source: 'human', confirmed: false });
  assert.ok(room.ok);
  const created = await commit({
    opId: 'create', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: [body] },
  });
  assert.ok(created.ok);
  return { db, commit, roomId: room.value.roomId, chunkId: created.value.chunkIds[0] };
}

test('a deferred delete reads the revision on disk, so a stale list cannot leave the note behind', async () => {
  const { db, commit, roomId, chunkId } = await note('hello');
  const saved = await commit({
    opId: 'edit', kind: 'chunk.update', source: 'human', confirmed: false, expectedRevision: 1,
    payload: { chunkId, body: 'hello!' },
  });
  assert.ok(saved.ok);

  const stale = await commit({
    opId: 'stale', kind: 'chunk.delete', source: 'human', confirmed: false, expectedRevision: 1,
    payload: { chunkId },
  });
  assert.equal(stale.ok, false);

  const removed = await commitDeferredDelete(chunkId, (id) => getChunk(db, id), async (revision) => {
    const result = await commit({
      opId: 'delete', kind: 'chunk.delete', source: 'human', confirmed: false, expectedRevision: revision,
      payload: { chunkId },
    });
    return result.ok ? { ok: true } : { ok: false, message: result.error.message };
  });
  assert.deepEqual(removed, { ok: true });
  assert.deepEqual(await listChunks(db, roomId), []);
});

test('undo of an emptied note writes the previous text at the current revision', async () => {
  const { db, commit, chunkId } = await note('hello');
  const emptied = await commit({
    opId: 'empty', kind: 'chunk.update', source: 'human', confirmed: false, expectedRevision: 1,
    payload: { chunkId, body: '' },
  });
  assert.ok(emptied.ok);

  const restored = await restoreDeferredBody(chunkId, (id) => getChunk(db, id), async (revision) => {
    assert.equal(revision, 2);
    const result = await commit({
      opId: 'restore', kind: 'chunk.update', source: 'human', confirmed: false, expectedRevision: revision,
      payload: { chunkId, body: 'hello' },
    });
    return result.ok ? { ok: true } : { ok: false, message: result.error.message };
  });
  assert.deepEqual(restored, { ok: true });
  assert.equal((await getChunk(db, chunkId))?.body, 'hello');
});

test('a committed room delete tells the sidebar to reload on the same screen', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let n = 0;
  const commit = createCommit(db, { newId: () => 'room-1', now: () => 1 });
  const stop = subscribeLocalChanges(() => { n += 1; });
  const created = await commit({
    opId: 'create-room', kind: 'room.create', source: 'human', confirmed: false,
    payload: { name: 'Sidebar room' },
  });
  assert.ok(created.ok);
  const removed = await commit({
    opId: 'delete-room', kind: 'room.delete', source: 'human', confirmed: true,
    expectedRevision: created.value.revision, payload: { roomId: created.value.roomId },
  });
  assert.ok(removed.ok);
  assert.equal(n, 2);
  stop();
  notifyLocalChanges();
  assert.equal(n, 2);
});

test('a deferred delete of a note that is already gone succeeds', async () => {
  const result = await commitDeferredDelete('missing', async () => null, async () => {
    throw new Error('should not delete');
  });
  assert.deepEqual(result, { ok: true });
});

test('restoring a note that is already gone reports that it is missing', async () => {
  const result = await restoreDeferredBody('missing', async () => null, async () => ({ ok: true }));
  assert.deepEqual(result, { ok: false, message: 'This note no longer exists.' });
});
