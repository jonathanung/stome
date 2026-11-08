import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import { getAnnotation, getRoomWhiteboard } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { createBoardSaver, mergeBoardElements, type BoardWrite } from '../src/whiteboard/persist.ts';
import { nodeDb } from './support/node-db.ts';

const rect = (id: string, x = 0) => ({ id, type: 'rectangle', x, y: 0, width: 10, height: 10 });

async function setup() {
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  let op = 0;
  let clock = 1_000;
  const commit = createCommit(db, { newId: () => `id-${++id}`, now: () => (clock += 10) });
  const op$ = <K extends OpKind>(kind: K, payload: Payloads[K], extra: Partial<Operation<K>> = {}): Operation<K> =>
    ({ opId: `op-${++op}`, kind, payload, source: 'human', confirmed: false, ...extra }) as Operation<K>;
  return { db, commit, op: op$ };
}

async function room(s: Awaited<ReturnType<typeof setup>>, name: string) {
  const created = await s.commit(s.op('room.create', { name }));
  assert.ok(created.ok);
  return created.value.roomId;
}

test('a room keeps its whiteboard across a second save, and another room does not see it', async () => {
  const s = await setup();
  const roomA = await room(s, 'cells');
  const roomB = await room(s, 'bones');
  const first = await s.commit(s.op('whiteboard.save', { roomId: roomA, elements: [rect('a')] }));
  assert.ok(first.ok);
  assert.equal(first.value.revision, 1);
  const second = await s.commit(s.op('whiteboard.save', { roomId: roomA, elements: [rect('a'), rect('b')] }, { expectedRevision: 1 }));
  assert.ok(second.ok);
  assert.equal(second.value.revision, 2);
  assert.equal(second.value.boardId, first.value.boardId);

  const saved = await getRoomWhiteboard(s.db, roomA);
  assert.deepEqual(saved?.elements, [rect('a'), rect('b')]);
  assert.equal(saved?.revision, 2);
  assert.equal(await getRoomWhiteboard(s.db, roomB), null);

  const stale = await s.commit(s.op('whiteboard.save', { roomId: roomA, elements: [rect('c')] }, { expectedRevision: 1 }));
  assert.ok(!stale.ok);
  assert.equal(stale.error.code, 'stale_revision');
  assert.deepEqual((await getRoomWhiteboard(s.db, roomA))?.elements, [rect('a'), rect('b')]);
});

test('replaying a whiteboard save does not write a second revision', async () => {
  const s = await setup();
  const roomId = await room(s, 'cells');
  const op = s.op('whiteboard.save', { roomId, elements: [rect('a')] });
  const first = await s.commit(op);
  const again = await s.commit(op);
  assert.ok(first.ok && again.ok);
  assert.equal(again.duplicate, true);
  assert.equal(again.value.revision, 1);
  assert.equal((await getRoomWhiteboard(s.db, roomId))?.revision, 1);
});

test('deleting a room removes its board and a stroke annotation stays beside a save', async () => {
  const s = await setup();
  const roomId = await room(s, 'cells');
  const chunk = await s.commit(s.op('chunk.create', { roomId, bodies: ['mitochondria'] }));
  assert.ok(chunk.ok);
  const stroke = await s.commit(s.op('annotation.create', {
    chunkId: chunk.value.chunkIds[0],
    type: 'stroke',
    anchor: { points: [[0, 0], [4, 5]] },
  }));
  assert.ok(stroke.ok);
  const board = await s.commit(s.op('whiteboard.save', { roomId, elements: [rect('a')] }));
  assert.ok(board.ok);
  const still = await getAnnotation(s.db, stroke.value.annotationId);
  assert.equal(still?.type, 'stroke');

  const removed = await s.commit(s.op('room.delete', { roomId }, { expectedRevision: 1, confirmed: true }));
  assert.ok(removed.ok);
  assert.equal(await getRoomWhiteboard(s.db, roomId), null);
});

test('a load that arrives after a stroke keeps both the saved board and the new stroke', () => {
  const saved = [rect('saved', 1)];
  const local = [rect('fresh', 2)];
  assert.deepEqual(mergeBoardElements(saved, local), [rect('saved', 1), rect('fresh', 2)]);
  assert.deepEqual(mergeBoardElements(saved, [{ ...rect('saved', 9) }, rect('fresh', 2)]), [rect('saved', 9), rect('fresh', 2)]);
});

test('the next save uses the revision returned by the save already in flight', async () => {
  const calls: BoardWrite[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let revision = 0;
  const saver = createBoardSaver(async (save) => {
    calls.push(save);
    if (calls.length === 1) await gate;
    revision += 1;
    return { revision };
  });
  saver.load(null);
  saver.edit([rect('a')]);
  saver.edit([rect('a'), rect('b')]);
  release();
  await saver.flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.expectedRevision, undefined);
  assert.equal(calls[1]?.expectedRevision, 1);
  assert.equal(calls[1]?.elements.length, 2);
  assert.equal(saver.dirty, false);
});

test('a failed save stays queued and the next flush writes it', async () => {
  let fail = true;
  const calls: BoardWrite[] = [];
  const saver = createBoardSaver(async (save) => {
    calls.push(save);
    if (fail) throw new Error('disk');
    return { revision: 1 };
  });
  saver.load(null);
  saver.edit([rect('a')]);
  await saver.flush();
  assert.equal(saver.dirty, true);
  assert.ok(calls.length >= 1);
  const tried = calls.length;
  fail = false;
  await saver.flush();
  assert.equal(saver.dirty, false);
  assert.ok(calls.length > tried);
  assert.deepEqual(calls.at(-1)?.elements, [rect('a')]);
});
