import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { listChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

test('AI may replace one chunk after confirmation and may not delete it', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  const commit = createCommit(db, { newId: () => `id-${++id}`, now: () => 1_000 + id });
  const room = await commit({
    opId: 'room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const chunkId = created.value.chunkIds[0] ?? '';
  const unconfirmed = await commit({
    opId: 'ai-unconfirmed',
    kind: 'chunk.update',
    source: 'ai',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId, body: 'should not land' },
  });
  assert.equal(unconfirmed.ok, false);
  if (unconfirmed.ok) return;
  assert.equal(unconfirmed.error.code, 'unconfirmed');
  const removed = await commit({
    opId: 'ai-delete',
    kind: 'chunk.delete',
    source: 'ai',
    confirmed: true,
    expectedRevision: 1,
    payload: { chunkId },
  });
  assert.equal(removed.ok, false);
  if (removed.ok) return;
  assert.equal(removed.error.code, 'forbidden');
  const stale = await commit({
    opId: 'ai-stale',
    kind: 'chunk.update',
    source: 'ai',
    confirmed: true,
    expectedRevision: 0,
    payload: { chunkId, body: 'from an old proposal' },
  });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.error.code, 'stale_revision');
  const saved = await commit({
    opId: 'ai-edit',
    kind: 'chunk.update',
    source: 'ai',
    confirmed: true,
    expectedRevision: 1,
    payload: { chunkId, body: 'photosynthesis makes sugar\n\nclearer' },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.revision, 2);
  const [chunk] = await listChunks(db, room.value.roomId);
  assert.equal(chunk?.body, 'photosynthesis makes sugar\n\nclearer');
  assert.equal(chunk?.revision, 2);
  const applied = await db.get<{ source: string }>('SELECT source FROM applied_ops WHERE op_id = ?', ['ai-edit']);
  assert.equal(applied?.source, 'ai');
  const replay = await commit({
    opId: 'ai-edit',
    kind: 'chunk.update',
    source: 'ai',
    confirmed: true,
    expectedRevision: 1,
    payload: { chunkId, body: 'photosynthesis makes sugar\n\nclearer' },
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.duplicate, true);
  assert.equal((await listChunks(db, room.value.roomId))[0]?.revision, 2);
  db.close();
});
