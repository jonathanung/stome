import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit, type CommitDeps } from '../src/data/commit.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import { getRoom, listAnnotations, listChunks, listRooms } from '../src/data/queries.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { failOnWrite, nodeDb } from './support/node-db.ts';

function testDeps(): CommitDeps {
  let id = 0;
  let clock = 1_000;
  return { newId: () => `id-${++id}`, now: () => (clock += 10) };
}

async function setup() {
  const db = nodeDb();
  await migrateDb(db);
  const deps = testDeps();
  let op = 0;
  const commit = createCommit(db, deps);
  const op$ = <K extends OpKind>(kind: K, payload: Payloads[K], extra: Partial<Operation<K>> = {}): Operation<K> =>
    ({ opId: `op-${++op}`, kind, payload, source: 'human', confirmed: false, ...extra }) as Operation<K>;
  return { db, deps, commit, op: op$ };
}

async function room(s: Awaited<ReturnType<typeof setup>>, name = 'biology') {
  const r = await s.commit(s.op('room.create', { name }));
  assert.ok(r.ok);
  return r.value.roomId;
}

const count = async (db: Db, table: string) => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

/* ----------------------------------------------------------- acceptance */

test('repeating an op ID changes nothing and returns the first result', async () => {
  const s = await setup();
  const op = s.op('room.create', { name: 'stat 330' });
  const first = await s.commit(op);
  const again = await s.commit(op);
  assert.ok(first.ok && again.ok);
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.value, first.value);
  assert.equal(await count(s.db, 'rooms'), 1);
  assert.equal(await count(s.db, 'applied_ops'), 1);
});

test('reusing an op ID for a different kind is a conflict', async () => {
  const s = await setup();
  const roomId = await room(s);
  const r = await s.commit({ ...s.op('chunk.create', { roomId, bodies: ['x'] }), opId: 'op-1' });
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'conflict');
  assert.equal(await count(s.db, 'chunks'), 0);
});

test('a stale revision is rejected and nothing is written', async () => {
  const s = await setup();
  const roomId = await room(s);
  const created = await s.commit(s.op('chunk.create', { roomId, bodies: ['v1'] }));
  assert.ok(created.ok);
  const [chunkId] = created.value.chunkIds;

  const edit = await s.commit(s.op('chunk.update', { chunkId, body: 'v2' }, { expectedRevision: 1 }));
  assert.ok(edit.ok);
  assert.equal(edit.value.revision, 2);

  const stale = await s.commit(s.op('chunk.update', { chunkId, body: 'v3 from an old tab' }, { expectedRevision: 1 }));
  assert.ok(!stale.ok);
  assert.equal(stale.error.code, 'stale_revision');
  const [chunk] = await listChunks(s.db, roomId);
  assert.equal(chunk.body, 'v2');
  assert.equal(chunk.revision, 2);
  assert.equal(await count(s.db, 'applied_ops'), 3);
});

test('an unconfirmed AI change is rejected; a confirmed one goes through', async () => {
  const s = await setup();
  const roomId = await room(s);
  const created = await s.commit(s.op('chunk.create', { roomId, bodies: ['glycolysis makes 2 atp'] }));
  assert.ok(created.ok);
  const chunkId = created.value.chunkIds[0];
  const payload: Payloads['annotation.create'] = { chunkId, type: 'ai_answer', anchor: { start: 0, end: 10 }, payload: { answer: 'net 2' } };

  const unconfirmed = await s.commit(s.op('annotation.create', payload, { source: 'ai', confirmed: false }));
  assert.ok(!unconfirmed.ok);
  assert.equal(unconfirmed.error.code, 'unconfirmed');
  assert.equal(await count(s.db, 'annotations'), 0);

  const confirmed = await s.commit(s.op('annotation.create', payload, { source: 'ai', confirmed: true }));
  assert.ok(confirmed.ok);
  const [annotation] = await listAnnotations(s.db, chunkId);
  assert.deepEqual(annotation.payload, { answer: 'net 2' });
});

test('a failure partway through rolls back the whole write', async () => {
  const s = await setup();
  const roomId = await room(s);
  // Third write inside the op: chunk 1, chunk 2, then chunk 3 fails.
  const commit = createCommit(failOnWrite(s.db, 3), s.deps);
  const r = await commit(s.op('chunk.create', { roomId, bodies: ['one', 'two', 'three'] }));
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'failed');
  assert.equal(await count(s.db, 'chunks'), 0);
  assert.equal(await count(s.db, 'applied_ops'), 1); // only the room.create
});

/* ------------------------------------------------------------ the rules */

test('AI and import sources only get the ops they are allowed', async () => {
  const s = await setup();
  const roomId = await room(s);
  const ai = await s.commit(s.op('room.rename', { roomId, name: 'x' }, { source: 'ai', confirmed: true, expectedRevision: 1 }));
  assert.ok(!ai.ok);
  assert.equal(ai.error.code, 'forbidden');
  const imp = await s.commit(s.op('room.delete', { roomId }, { source: 'import', confirmed: true, expectedRevision: 1 }));
  assert.ok(!imp.ok);
  assert.equal(imp.error.code, 'forbidden');
  const imported = await s.commit(s.op('chunk.create', { roomId, bodies: ['from obsidian'], sourceLink: 'vault/a.md' }, { source: 'import' }));
  assert.ok(imported.ok);
});

test('deleting a room needs confirmation and cascades', async () => {
  const s = await setup();
  const roomId = await room(s);
  await s.commit(s.op('chunk.create', { roomId, bodies: ['a', 'b'], subjects: ['cells'] }));
  const unconfirmed = await s.commit(s.op('room.delete', { roomId }, { expectedRevision: 1 }));
  assert.ok(!unconfirmed.ok);
  assert.equal(unconfirmed.error.code, 'unconfirmed');
  assert.equal(await count(s.db, 'chunks'), 2);

  const deleted = await s.commit(s.op('room.delete', { roomId }, { expectedRevision: 1, confirmed: true }));
  assert.ok(deleted.ok);
  assert.equal(await count(s.db, 'rooms'), 0);
  assert.equal(await count(s.db, 'chunks'), 0);
  assert.equal(await count(s.db, 'chunk_subjects'), 0);
});

test('ops on existing rows must carry expectedRevision', async () => {
  const s = await setup();
  const roomId = await room(s);
  const r = await s.commit(s.op('room.rename', { roomId, name: 'new' }));
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'invalid');
});

test('missing references are not_found', async () => {
  const s = await setup();
  const a = await s.commit(s.op('chunk.create', { roomId: 'nope', bodies: ['x'] }));
  const b = await s.commit(s.op('chunk.update', { chunkId: 'nope', body: 'x' }, { expectedRevision: 1 }));
  const c = await s.commit(s.op('annotation.create', { chunkId: 'nope', type: 'highlight', anchor: { start: 0, end: 1 } }));
  for (const r of [a, b, c]) {
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'not_found');
  }
});

test('shape is checked before anything is written', async () => {
  const s = await setup();
  const roomId = await room(s);
  const bad = [
    s.op('room.create', { name: '   ' }),
    s.op('chunk.create', { roomId, bodies: [] }),
    s.op('chunk.create', { roomId, bodies: ['ok', '  '] }),
    s.op('chunk.create', { roomId, bodies: ['x'], subjects: ['a'.repeat(41)] }),
    { ...s.op('room.create', { name: 'x' }), opId: '' },
    { ...s.op('room.create', { name: 'x' }), source: 'plugin' } as unknown as Operation,
    s.op('annotation.create', { chunkId: 'c', type: 'sticker' as 'highlight', anchor: { start: 0, end: 1 } }),
  ];
  for (const op of bad) {
    const r = await s.commit(op);
    assert.ok(!r.ok, JSON.stringify(op));
    assert.equal(r.error.code, 'invalid', JSON.stringify(op));
  }
  assert.equal(await count(s.db, 'rooms'), 1);
  assert.equal(await count(s.db, 'chunks'), 0);
});

test('annotation anchors must point inside the chunk', async () => {
  const s = await setup();
  const roomId = await room(s);
  const created = await s.commit(s.op('chunk.create', { roomId, bodies: ['hello'] }));
  assert.ok(created.ok);
  const chunkId = created.value.chunkIds[0];
  const tries = [
    { type: 'highlight', anchor: { start: 0, end: 6 } },
    { type: 'highlight', anchor: { start: 3, end: 3 } },
    { type: 'stroke', anchor: { points: [] } },
    { type: 'stroke', anchor: { points: [[1, Number.NaN]] } },
  ] as const;
  for (const t of tries) {
    const r = await s.commit(s.op('annotation.create', { chunkId, ...t } as Payloads['annotation.create']));
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'invalid');
  }
  const ok = await s.commit(s.op('annotation.create', { chunkId, type: 'stroke', anchor: { points: [[0, 0], [4, 5]] } }));
  assert.ok(ok.ok);
});

test('subjects are trimmed, de-duplicated case-insensitively and kept in order', async () => {
  const s = await setup();
  const roomId = await room(s);
  const r = await s.commit(s.op('chunk.create', { roomId, bodies: ['x'], subjects: [' Cells ', 'energy', 'cells', '', 'ATP  synthase'] }));
  assert.ok(r.ok);
  const [chunk] = await listChunks(s.db, roomId);
  assert.deepEqual(chunk.subjects, ['Cells', 'energy', 'ATP synthase']);
});

test('chunks keep a dense order through insert, move and delete', async () => {
  const s = await setup();
  const roomId = await room(s);
  await s.commit(s.op('chunk.create', { roomId, bodies: ['a', 'b', 'c'] }));
  await s.commit(s.op('chunk.create', { roomId, bodies: ['x', 'y'], index: 1 }));
  const bodies = async () => (await listChunks(s.db, roomId)).map((c) => `${c.position}${c.body}`).join(' ');
  assert.equal(await bodies(), '0a 1x 2y 3b 4c');

  const chunks = await listChunks(s.db, roomId);
  const c = chunks.find((ch) => ch.body === 'c')!;
  const moved = await s.commit(s.op('chunk.move', { chunkId: c.id, toIndex: 0 }, { expectedRevision: c.revision }));
  assert.ok(moved.ok);
  assert.equal(await bodies(), '0c 1a 2x 3y 4b');

  const x = chunks.find((ch) => ch.body === 'x')!;
  const deleted = await s.commit(s.op('chunk.delete', { chunkId: x.id }, { expectedRevision: x.revision }));
  assert.ok(deleted.ok);
  assert.equal(await bodies(), '0c 1a 2y 3b');
});

test('rename bumps the room revision', async () => {
  const s = await setup();
  const roomId = await room(s);
  const r = await s.commit(s.op('room.rename', { roomId, name: '  cmpt   310 ' }, { expectedRevision: 1 }));
  assert.ok(r.ok);
  const saved = await getRoom(s.db, roomId);
  assert.equal(saved?.name, 'cmpt 310');
  assert.equal(saved?.revision, 2);
  assert.equal((await listRooms(s.db)).length, 1);
});

test('a stale chunk revision rejects an AI annotation and leaves the chunk unchanged', async () => {
  const s = await setup();
  const roomId = await room(s);
  const created = await s.commit(s.op('chunk.create', { roomId, bodies: ['glycolysis makes 2 atp'] }));
  assert.ok(created.ok);
  const chunkId = created.value.chunkIds[0];
  const payload: Payloads['annotation.create'] = {
    chunkId,
    type: 'ai_answer',
    anchor: { start: 0, end: 10 },
    payload: { body: 'net 2' },
  };
  const stale = await s.commit(
    s.op('annotation.create', payload, { source: 'ai', confirmed: true, expectedRevision: 0 }),
  );
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, 'stale_revision');
  assert.equal(await count(s.db, 'annotations'), 0);
  assert.equal(await count(s.db, 'applied_ops'), 2);
  const [chunk] = await listChunks(s.db, roomId);
  assert.equal(chunk.body, 'glycolysis makes 2 atp');
  assert.equal(chunk.revision, 1);
});

test('a matching chunk revision pins an AI answer without changing the chunk', async () => {
  const s = await setup();
  const roomId = await room(s);
  const created = await s.commit(s.op('chunk.create', { roomId, bodies: ['glycolysis makes 2 atp'] }));
  assert.ok(created.ok);
  const chunkId = created.value.chunkIds[0];
  const op = s.op(
    'annotation.create',
    { chunkId, type: 'ai_answer', anchor: { start: 0, end: 10 }, payload: { body: 'net 2' } },
    { source: 'ai', confirmed: true, expectedRevision: 1 },
  );
  const saved = await s.commit(op);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.duplicate, false);
  const replay = await s.commit(op);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.value, saved.value);
  assert.equal(await count(s.db, 'annotations'), 1);
  assert.equal(await count(s.db, 'applied_ops'), 3);
  const [chunk] = await listChunks(s.db, roomId);
  assert.equal(chunk.body, 'glycolysis makes 2 atp');
  assert.equal(chunk.revision, 1);
  const [annotation] = await listAnnotations(s.db, chunkId);
  assert.equal(annotation.type, 'ai_answer');
  assert.deepEqual(annotation.anchor, { start: 0, end: 10 });
  assert.deepEqual(annotation.payload, { body: 'net 2' });
});

test('concurrent commits are serialized, never interleaved', async () => {
  const s = await setup();
  const roomId = await room(s);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => s.commit(s.op('chunk.create', { roomId, bodies: [`chunk ${i}`] }))),
  );
  assert.ok(results.every((r) => r.ok));
  const positions = (await listChunks(s.db, roomId)).map((c) => c.position);
  assert.deepEqual(positions, Array.from({ length: 20 }, (_, i) => i));
});
