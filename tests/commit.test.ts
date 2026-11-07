import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createCommit, type CommitDeps } from '../src/data/commit.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import { getRoom, listAnnotations, listChunks, listRoomAnnotations, listRooms } from '../src/data/queries.ts';
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


test('a local room and its ordered notes survive reopen, then confirmed deletion persists', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'stome-rooms-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'rooms.db');
  const first = nodeDb(path);
  await migrateDb(first);
  const deps = testDeps();
  const commit = createCommit(first, deps);
  const create = await commit({ opId: 'create-room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'Biology' } });
  assert.ok(create.ok);
  const roomId = create.value.roomId;
  const chunks = await commit({ opId: 'create-chunks', kind: 'chunk.create', source: 'human', confirmed: false, payload: { roomId, bodies: ['Cells', 'Mitosis'], subjects: ['biology'], sourceLink: 'vault/biology.md' } });
  assert.ok(chunks.ok);
  const annotated = await commit({ opId: 'annotate', kind: 'annotation.create', source: 'human', confirmed: false, payload: { chunkId: chunks.value.chunkIds[0], type: 'highlight', anchor: { start: 0, end: 5 }, payload: { note: 'review' } } });
  assert.ok(annotated.ok);
  const renamed = await commit({ opId: 'rename-room', kind: 'room.rename', source: 'human', confirmed: false, expectedRevision: 1, payload: { roomId, name: 'Cell biology' } });
  assert.ok(renamed.ok);
  first.close();

  const reopened = nodeDb(path);
  await migrateDb(reopened);
  const savedRoom = await getRoom(reopened, roomId);
  assert.equal(savedRoom?.name, 'Cell biology');
  assert.equal(savedRoom.stage, 'stonehenge');
  assert.equal(savedRoom.revision, 2);
  const savedChunks = await listChunks(reopened, roomId);
  assert.deepEqual(savedChunks.map((chunk) => [chunk.position, chunk.body, chunk.subjects, chunk.sourceLink]), [
    [0, 'Cells', ['biology'], 'vault/biology.md'],
    [1, 'Mitosis', ['biology'], 'vault/biology.md'],
  ]);
  assert.deepEqual((await listAnnotations(reopened, savedChunks[0].id))[0]?.payload, { note: 'review' });
  const deleted = await createCommit(reopened, deps)({ opId: 'delete-room', kind: 'room.delete', source: 'human', confirmed: true, expectedRevision: savedRoom.revision, payload: { roomId } });
  assert.ok(deleted.ok);
  reopened.close();

  const afterDelete = nodeDb(path);
  await migrateDb(afterDelete);
  assert.equal(await getRoom(afterDelete, roomId), null);
  assert.deepEqual(await listChunks(afterDelete, roomId), []);
  assert.equal(await count(afterDelete, 'annotations'), 0);
  afterDelete.close();
});


test('room annotation query returns only annotations for that room in chunk order', async () => {
  const s = await setup();
  const firstRoom = await room(s, 'first');
  const secondRoom = await room(s, 'second');
  const firstChunks = await s.commit(s.op('chunk.create', { roomId: firstRoom, bodies: ['one', 'two'] }));
  const otherChunk = await s.commit(s.op('chunk.create', { roomId: secondRoom, bodies: ['other'] }));
  assert.ok(firstChunks.ok && otherChunk.ok);
  for (const [chunkId, note] of [
    [firstChunks.value.chunkIds[1], 'second'],
    [otherChunk.value.chunkIds[0], 'other'],
    [firstChunks.value.chunkIds[0], 'first'],
  ]) {
    const saved = await s.commit(s.op('annotation.create', {
      chunkId, type: 'highlight', anchor: { start: 0, end: 1 }, payload: { note },
    }));
    assert.ok(saved.ok);
  }
  assert.deepEqual((await listRoomAnnotations(s.db, firstRoom)).map((item) => item.payload.note), ['first', 'second']);
  assert.deepEqual((await listRoomAnnotations(s.db, secondRoom)).map((item) => item.payload.note), ['other']);
});
