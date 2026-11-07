import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { Operation } from '../src/data/operations.ts';
import { getRoom, listChunks, listRooms } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { failOnWrite, nodeDb } from './support/node-db.ts';

const note = (opId = 'op-1'): Operation<'import.note'> => ({
  opId, kind: 'import.note', source: 'import', confirmed: true,
  payload: { sourceId: 'markdown:vault/Biology/Cells.md', fingerprint: 'a'.repeat(64), destination: { name: 'biology' }, bodies: ['# Cells\ntext', '## Revision\nquestions'], subjects: ['biology'] },
});

async function setup() {
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  const deps = { now: () => 1234, newId: () => `id-${++id}` };
  return { db, deps, commit: createCommit(db, deps) };
}

test('one confirmed note atomically creates its room, chunks, subjects and provenance', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const result = await s.commit(note());
  assert.ok(result.ok);
  assert.equal(result.value.skipped, false);
  const chunks = await listChunks(s.db, result.value.roomId);
  assert.deepEqual(chunks.map((c) => c.body), note().payload.bodies);
  assert.deepEqual(chunks.map((c) => c.position), [0, 1]);
  assert.ok(chunks.every((c) => c.sourceLink === note().payload.sourceId && c.subjects[0] === 'biology'));
  assert.equal((await getRoom(s.db, result.value.roomId))?.stage, 'stonehenge');
  assert.equal((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM import_sources'))?.n, 1);
});

test('retry, concurrent re-import and edited/deleted chunks never duplicate or overwrite', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const [first, second] = await Promise.all([s.commit(note()), s.commit(note('op-2'))]);
  assert.ok(first.ok && second.ok);
  assert.equal(second.value.skipped, true);
  assert.equal((await s.commit(note())).ok, true);
  const id = first.value.chunkIds[0];
  await s.commit({ opId: 'edit', kind: 'chunk.update', source: 'human', confirmed: false, expectedRevision: 1, payload: { chunkId: id, body: 'my edits' } });
  const changed = note('changed');
  changed.payload.fingerprint = 'b'.repeat(64);
  changed.payload.bodies = ['changed source'];
  const conflict = await s.commit(changed);
  assert.ok(!conflict.ok && conflict.error.code === 'conflict');
  assert.equal((await listChunks(s.db, first.value.roomId))[0].body, 'my edits');
  const same = await s.commit(note('same'));
  assert.ok(same.ok && same.value.skipped);
  await s.commit({ opId: 'delete', kind: 'chunk.delete', source: 'human', confirmed: false, expectedRevision: 2, payload: { chunkId: id } });
  assert.ok((await s.commit(note('after-delete'))).ok);
  assert.equal((await listChunks(s.db, first.value.roomId)).length, 1);
  assert.equal((await listRooms(s.db)).length, 1);
});

test('confirmation, authorization, hash, size and destination are enforced at the boundary', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const cases = [
    { ...note(), confirmed: false },
    { ...note(), source: 'ai' as const },
    { ...note(), payload: { ...note().payload, fingerprint: 'bad' } },
    { ...note(), payload: { ...note().payload, bodies: ['x'.repeat(50_001)] } },
    { ...note(), payload: { ...note().payload, destination: { roomId: 'missing' } } },
  ];
  for (const op of cases) assert.equal((await s.commit(op)).ok, false);
  assert.equal((await listRooms(s.db)).length, 0);
});

test('failure after chunk writes rolls back new room, provenance, chunks and op record', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const failing = createCommit(failOnWrite(s.db, 6), s.deps); // room + two chunks + two subjects, then provenance
  assert.equal((await failing(note())).ok, false);
  for (const table of ['rooms', 'chunks', 'chunk_subjects', 'import_sources', 'applied_ops']) {
    assert.equal((await s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n, 0);
  }
  assert.ok((await s.commit(note())).ok);
});

test('imports append to existing rooms and deleting a room releases source identity', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const room = await s.commit({ opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'existing' } });
  assert.ok(room.ok);
  const op = note();
  op.payload.destination = { roomId: room.value.roomId };
  assert.ok((await s.commit(op)).ok);
  const another = note('second');
  another.payload.sourceId = 'markdown:vault/Other.md';
  another.payload.destination = { roomId: room.value.roomId };
  assert.ok((await s.commit(another)).ok);
  assert.deepEqual((await listChunks(s.db, room.value.roomId)).map((c) => c.position), [0, 1, 2, 3]);
  assert.ok((await s.commit({ opId: 'remove-room', kind: 'room.delete', source: 'human', confirmed: true, expectedRevision: 1, payload: { roomId: room.value.roomId } })).ok);
  assert.equal((await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM import_sources'))?.n, 0);
  assert.ok((await s.commit(note('again'))).ok);
});
