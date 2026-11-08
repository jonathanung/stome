import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { Operation } from '../src/data/operations.ts';
import { getRoom, listChunks, listRooms } from '../src/data/queries.ts';
import { saveReadyImports, savedDraftPatch, shareCreatedRoom } from '../src/import/batch.ts';
import { chooseExistingRoom, chooseNewRoom, destinationForMapping, type RoomMapping } from '../src/import/room-map.ts';
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

test('notes that name one new room are stored in that single room', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const created = new Map<string, string>();
  const saveNamed = async (opId: string, sourceId: string, fingerprint: string) => {
    const mapping = shareCreatedRoom(chooseNewRoom('Biology Lab'), created);
    const destination = destinationForMapping(mapping);
    assert.ok(destination);
    const op = note(opId);
    op.payload.sourceId = sourceId;
    op.payload.fingerprint = fingerprint;
    op.payload.destination = destination;
    const saved = await s.commit(op);
    assert.ok(saved.ok);
    if ('name' in destination) created.set(destination.name.toLowerCase(), saved.value.roomId);
    return saved.value.roomId;
  };
  const first = await saveNamed('op-1', 'markdown:vault/Biology/Cells.md', 'a'.repeat(64));
  const second = await saveNamed('op-2', 'markdown:vault/Biology/Mitosis.md', 'b'.repeat(64));
  assert.equal(second, first);
  const rooms = await listRooms(s.db);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]?.name, 'Biology Lab');
  assert.equal((await listChunks(s.db, first)).length, 4);
});

test('a partial save then a retry keeps one batch room and explicit destinations', async (t) => {
  const s = await setup();
  t.after(() => s.db.close());
  const unrelated = await s.commit({ opId: 'unrelated', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'Biology Lab' } });
  const other = await s.commit({ opId: 'other', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'Other' } });
  assert.ok(unrelated.ok && other.ok);
  const drafts: { id: string; sourceId: string; fingerprint: string; mapping: RoomMapping; done?: boolean; createdRoomName?: string; result?: string }[] = [
    { id: 'a', sourceId: 'markdown:a.md', fingerprint: 'a'.repeat(64), mapping: chooseNewRoom('Biology Lab') },
    { id: 'b', sourceId: 'markdown:b.md', fingerprint: 'b'.repeat(64), mapping: chooseNewRoom('Biology Lab') },
    { id: 'c', sourceId: 'markdown:c.md', fingerprint: 'c'.repeat(64), mapping: chooseNewRoom('Biology Lab') },
    { id: 'd', sourceId: 'markdown:d.md', fingerprint: 'd'.repeat(64), mapping: chooseExistingRoom(other.value.roomId) },
  ];
  const persist = async (draft: (typeof drafts)[number], mapping: RoomMapping, options?: { refreshFails?: boolean }) => {
    const destination = destinationForMapping(mapping);
    assert.ok(destination);
    const op = note(draft.id);
    op.payload.sourceId = draft.sourceId;
    op.payload.fingerprint = draft.fingerprint;
    op.payload.destination = destination;
    const saved = await s.commit(op);
    assert.ok(saved.ok);
    Object.assign(draft, savedDraftPatch(mapping, saved.value.roomId, 'Saved 2 chunks.'));
    if (options?.refreshFails) {
      draft.result = 'Could not refresh rooms.';
      return null;
    }
    return saved.value.roomId;
  };

  await saveReadyImports(drafts, async (draft, mapping) => draft.id === 'b' ? null : persist(draft, mapping));
  assert.equal(drafts[0]?.done, true);
  assert.equal(drafts[1]?.done, undefined);
  assert.equal(drafts[3]?.done, undefined);

  await saveReadyImports(drafts, async (draft, mapping) => {
    assert.equal(mapping.status, 'existing');
    if (mapping.status === 'existing') assert.notEqual(mapping.roomId, unrelated.value.roomId);
    return draft.id === 'b' ? persist(draft, mapping, { refreshFails: true }) : persist(draft, mapping);
  });
  assert.equal(drafts[1]?.done, true);
  assert.deepEqual(drafts[1]?.mapping, drafts[0]?.mapping);
  assert.equal(drafts[1]?.result, 'Could not refresh rooms.');
  assert.equal(drafts[2]?.done, undefined);

  await saveReadyImports(drafts, async (draft, mapping) => {
    if (draft.id === 'd') assert.deepEqual(mapping, chooseExistingRoom(other.value.roomId));
    if (draft.id === 'c') assert.deepEqual(mapping, drafts[0]?.mapping);
    return persist(draft, mapping);
  });

  const biology = (await listRooms(s.db)).filter((room) => room.name === 'Biology Lab');
  assert.equal(biology.length, 2);
  const batchRoom = drafts[0]?.mapping.status === 'existing' ? drafts[0].mapping.roomId : '';
  assert.equal((await listChunks(s.db, unrelated.value.roomId)).length, 0);
  assert.equal((await listChunks(s.db, batchRoom)).length, 6);
  assert.equal((await listChunks(s.db, other.value.roomId)).length, 2);
  assert.equal(new Set([drafts[0], drafts[1], drafts[2]].map((draft) => draft?.mapping.status === 'existing' ? draft.mapping.roomId : '')).size, 1);
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
