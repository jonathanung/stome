import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import { listChunks, listRecentChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

async function setup() {
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  let clock = 0;
  let op = 0;
  const commit = createCommit(db, { newId: () => `id-${++id}`, now: () => (clock += 1000) });
  const run = async <K extends OpKind>(kind: K, payload: Payloads[K], expectedRevision?: number) => {
    const r = await commit({ opId: `op-${++op}`, kind, payload, expectedRevision, source: 'human', confirmed: false } as Operation<K>);
    assert.ok(r.ok, JSON.stringify(r));
    return r.value;
  };
  return { db, run };
}

test('recent chunks span rooms and are ordered by last edit, newest first', async () => {
  const { db, run } = await setup();
  const bio = (await run('room.create', { name: 'biology' })).roomId;
  const stat = (await run('room.create', { name: 'stat 330' })).roomId;
  const [a] = (await run('chunk.create', { roomId: bio, bodies: ['krebs cycle'] })).chunkIds;
  await run('chunk.create', { roomId: stat, bodies: ['type i error'] });
  await run('chunk.create', { roomId: bio, bodies: ['glycolysis'] });

  let recent = await listRecentChunks(db);
  assert.deepEqual(recent.map((c) => c.body), ['glycolysis', 'type i error', 'krebs cycle']);
  assert.deepEqual(recent.map((c) => c.roomName), ['biology', 'stat 330', 'biology']);

  // Editing the oldest chunk moves it to the top.
  await run('chunk.update', { chunkId: a, body: 'krebs cycle runs twice per glucose' }, 1);
  recent = await listRecentChunks(db);
  assert.equal(recent[0].body, 'krebs cycle runs twice per glucose');
  for (let i = 1; i < recent.length; i += 1) assert.ok(recent[i - 1].updatedAt >= recent[i].updatedAt);
});

test('reordering is not an edit, and the limit is respected', async () => {
  const { db, run } = await setup();
  const room = (await run('room.create', { name: 'r' })).roomId;
  await run('chunk.create', { roomId: room, bodies: ['one', 'two', 'three'] });
  const before = (await listRecentChunks(db)).map((c) => c.id);
  const last = (await listChunks(db, room))[2];
  await run('chunk.move', { chunkId: last.id, toIndex: 0 }, last.revision);
  assert.deepEqual((await listRecentChunks(db)).map((c) => c.id), before);
  assert.equal((await listRecentChunks(db, 2)).length, 2);
});
