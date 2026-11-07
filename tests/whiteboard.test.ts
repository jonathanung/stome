import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit, type Commit, type CommitDeps } from '../src/data/commit.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import { LIMITS } from '../src/data/operations.ts';
import { listAnnotations, listChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import {
  BOARD_SPACE,
  FUTURE_AI_STROKE,
  FUTURE_IMAGE_INSERT,
  STROKE_WIDTH,
  WHITEBOARD_CHUNK_BODY,
  WHITEBOARD_CONTRACT,
  WHITEBOARD_ROUTE,
  WHITEBOARD_SOURCE_LINK,
  acceptBoardPoints,
  appendPointerSample,
  emptyDraft,
  finishPointerDraft,
  humanStrokeOperation,
  isWhiteboardChunk,
  pencilPayload,
  whiteboardHref,
  type BoardPoint,
} from '../src/features/whiteboard/contract.ts';
import { boardRefresh } from '../src/features/whiteboard/refresh.ts';
import {
  clearBoard,
  deleteBoardStroke,
  loadBoard,
  saveHumanStroke,
  undoBoardStroke,
} from '../src/features/whiteboard/session.ts';
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
  const created = await s.commit(s.op('room.create', { name }));
  assert.ok(created.ok);
  return created.value.roomId;
}

const view = { width: 500, height: 350 };

test('the shared contract names the route, board space, anchor, and refresh hook', () => {
  assert.equal(WHITEBOARD_ROUTE, '/board/[roomId]');
  assert.equal(whiteboardHref('room-1'), '/board/room-1');
  assert.deepEqual(WHITEBOARD_CONTRACT.coordinate, {
    space: 'board',
    origin: 'top-left',
    unit: 'board unit, not a screen pixel, rounded to 0.01 from the pointer',
    width: 1000,
    height: 700,
    minX: 0,
    minY: 0,
    maxX: 1000,
    maxY: 700,
    humanSaveRejectsOutOfBounds: true,
    commitGateRejectsOutOfBounds: false,
  });
  assert.equal(WHITEBOARD_CONTRACT.stroke.annotationType, 'stroke');
  assert.equal(WHITEBOARD_CONTRACT.stroke.pointsLiveIn, 'anchor.points');
  assert.equal(WHITEBOARD_CONTRACT.stroke.pointMin, 1);
  assert.equal(WHITEBOARD_CONTRACT.stroke.pointMax, LIMITS.strokePoints);
  assert.equal(WHITEBOARD_CONTRACT.chunk.sourceLink, WHITEBOARD_SOURCE_LINK);
  assert.equal(WHITEBOARD_CONTRACT.refresh.notify, 'boardRefresh.notify(roomId): void');
  assert.equal(FUTURE_AI_STROKE.implemented, false);
  assert.equal(FUTURE_AI_STROKE.source, 'ai');
  assert.equal(FUTURE_IMAGE_INSERT.implemented, false);
  assert.equal(BOARD_SPACE.width, 1000);
  assert.equal(STROKE_WIDTH, 3);
});

test('a pointer gesture saves and reloads the same board points', async () => {
  const s = await setup();
  const roomId = await room(s);
  const samples = [
    { x: 60, y: 40 },
    { x: 80, y: 55 },
    { x: 120, y: 90 },
  ];
  let draft = emptyDraft();
  for (const sample of samples) draft = appendPointerSample(draft, sample.x, sample.y, view);
  const expected: BoardPoint[] = [[120, 80], [160, 110], [240, 180]];
  assert.deepEqual(finishPointerDraft(draft, 'up'), expected);

  const seen: string[] = [];
  const stop = boardRefresh.subscribe((id) => seen.push(id));
  try {
    const before = await loadBoard(s.db, roomId);
    assert.deepEqual(before?.strokes, []);
    assert.equal(before?.chunkId, null);
    assert.deepEqual(seen, []);

    const saved = await saveHumanStroke(s.db, s.commit, { roomId, points: expected, opId: 'stroke-1' });
    assert.ok(saved.ok);
    assert.equal(saved.duplicate, false);
    assert.deepEqual(seen, [roomId]);

    const loaded = await loadBoard(s.db, roomId);
    assert.equal(loaded?.roomName, 'biology');
    assert.deepEqual(loaded?.strokes.map((stroke) => stroke.points), [expected]);
    const again = await loadBoard(s.db, roomId);
    assert.deepEqual(again?.strokes[0]?.points, expected);

    const annotations = await listAnnotations(s.db, loaded!.chunkId!);
    assert.equal(annotations.length, 1);
    assert.equal(annotations[0]?.type, 'stroke');
    assert.deepEqual(annotations[0]?.anchor, { points: expected });
    assert.deepEqual(annotations[0]?.payload, pencilPayload());
    const chunks = await listChunks(s.db, roomId);
    assert.equal(chunks.filter(isWhiteboardChunk).length, 1);
    assert.equal(chunks[0]?.body, WHITEBOARD_CHUNK_BODY);
    assert.equal(chunks[0]?.sourceLink, WHITEBOARD_SOURCE_LINK);
  } finally {
    stop();
  }
});

test('pointer samples outside the view clamp, and raw out-of-bounds points are refused', async () => {
  const s = await setup();
  const roomId = await room(s);
  let draft = emptyDraft();
  draft = appendPointerSample(draft, -10, 20, view);
  draft = appendPointerSample(draft, 10, 400, view);
  const points = finishPointerDraft(draft, 'up');
  assert.deepEqual(points, [[0, 40], [20, 700]]);
  const saved = await saveHumanStroke(s.db, s.commit, { roomId, points: points!, opId: 'edge' });
  assert.ok(saved.ok);
  assert.deepEqual((await loadBoard(s.db, roomId))?.strokes[0]?.points, points);

  const refused = await saveHumanStroke(s.db, s.commit, { roomId, points: [[-1, 10], [4, 5]], opId: 'outside' });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.reason, 'out_of_bounds');
  assert.equal((await loadBoard(s.db, roomId))?.strokes.length, 1);
});

test('an empty board stays empty until a real stroke, and a cancel does not write', async () => {
  const s = await setup();
  const roomId = await room(s);
  const empty = await loadBoard(s.db, roomId);
  assert.deepEqual(empty?.strokes, []);
  assert.equal((await listChunks(s.db, roomId)).length, 0);

  const blank = await saveHumanStroke(s.db, s.commit, { roomId, points: [], opId: 'blank' });
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.equal(blank.reason, 'empty');
  const bad = await saveHumanStroke(s.db, s.commit, { roomId, points: [[1, Number.NaN]], opId: 'nan' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'non_finite');
  assert.equal((await listChunks(s.db, roomId)).length, 0);

  let draft = appendPointerSample(emptyDraft(), 25, 35, view);
  assert.equal(finishPointerDraft(draft, 'cancel'), null);
  assert.deepEqual(finishPointerDraft(draft, 'up'), [[50, 70]]);
  draft = appendPointerSample(draft, 25, 35, view);
  assert.equal(draft.points.length, 1);
});

test('the commit gate allows any finite point and rejects an empty, non-finite, or 5001-point stroke', async () => {
  const s = await setup();
  const roomId = await room(s);
  const seeded = await saveHumanStroke(s.db, s.commit, { roomId, points: [[1, 1]], opId: 'seed-gate' });
  assert.ok(seeded.ok);
  const chunkId = (await loadBoard(s.db, roomId))!.chunkId!;
  const rejected: { points: BoardPoint[] }[] = [
    { points: [] },
    { points: [[1, Number.NaN]] },
    { points: Array.from({ length: LIMITS.strokePoints + 1 }, (_, index) => [index % 1000, 0] as BoardPoint) },
  ];
  for (const anchor of rejected) {
    const result = await s.commit(s.op('annotation.create', { chunkId, type: 'stroke', anchor }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'invalid');
  }
  const outside = await s.commit(s.op('annotation.create', {
    chunkId,
    type: 'stroke',
    anchor: { points: [[-5, 10]] },
  }));
  assert.ok(outside.ok);
  const loaded = await loadBoard(s.db, roomId);
  assert.deepEqual(loaded?.strokes.map((stroke) => stroke.points), [[[1, 1]], [[-5, 10]]]);

  const full = Array.from({ length: LIMITS.strokePoints }, (_, index) => [index % BOARD_SPACE.width, index % BOARD_SPACE.height] as BoardPoint);
  const accepted = acceptBoardPoints(full);
  assert.equal(accepted.ok, true);
  const saved = await saveHumanStroke(s.db, s.commit, { roomId, points: full, opId: 'full' });
  assert.ok(saved.ok);
  assert.equal((await loadBoard(s.db, roomId))?.strokes.at(-1)?.points.length, LIMITS.strokePoints);
  const overflow = [...full, [3, 4] as BoardPoint];
  const tooLong = await saveHumanStroke(s.db, s.commit, { roomId, points: overflow, opId: 'overflow' });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.reason, 'too_long');
});

test('a gesture that passes 5000 points is not saved', () => {
  const boardView = { width: BOARD_SPACE.width, height: BOARD_SPACE.height };
  let draft = emptyDraft();
  for (let i = 0; i < LIMITS.strokePoints; i += 1) {
    draft = appendPointerSample(draft, i % boardView.width, (i % 2) * 10, boardView);
  }
  assert.equal(draft.points.length, LIMITS.strokePoints);
  assert.equal(draft.capped, false);
  const overflow = appendPointerSample(draft, 3, 11, boardView);
  assert.equal(overflow.capped, true);
  assert.equal(overflow.points.length, LIMITS.strokePoints);
  assert.equal(finishPointerDraft(overflow, 'up'), null);
  assert.equal(finishPointerDraft(draft, 'up')?.length, LIMITS.strokePoints);
});

test('strokes stay in their room, and clear or undo does not touch another room or a note', async () => {
  const s = await setup();
  const biology = await room(s, 'biology');
  const history = await room(s, 'history');
  const bioPoints: BoardPoint[] = [[10, 10], [20, 30]];
  const historyPoints: BoardPoint[] = [[8, 9], [12, 15], [16, 4]];
  const bio = await saveHumanStroke(s.db, s.commit, { roomId: biology, points: bioPoints, opId: 'bio' });
  assert.ok(bio.ok);
  const hist = await saveHumanStroke(s.db, s.commit, { roomId: history, points: historyPoints, opId: 'hist' });
  assert.ok(hist.ok);
  const extra = await saveHumanStroke(s.db, s.commit, { roomId: biology, points: [[4, 4], [6, 8]], opId: 'bio-2' });
  assert.ok(extra.ok);

  assert.deepEqual((await loadBoard(s.db, biology))?.strokes.map((stroke) => stroke.points), [bioPoints, [[4, 4], [6, 8]]]);
  assert.deepEqual((await loadBoard(s.db, history))?.strokes.map((stroke) => stroke.points), [historyPoints]);

  const crossed = await deleteBoardStroke(s.db, s.commit, 'cross', biology, hist.annotationId);
  assert.equal(crossed.ok, false);
  if (!crossed.ok) assert.equal(crossed.reason, 'not_found');
  assert.equal((await loadBoard(s.db, history))?.strokes.length, 1);

  const note = await s.commit(s.op('chunk.create', { roomId: biology, bodies: ['mitochondria'] }));
  assert.ok(note.ok);
  const highlight = await s.commit(s.op('annotation.create', {
    chunkId: note.value.chunkIds[0],
    type: 'highlight',
    anchor: { start: 0, end: 5 },
    payload: { text: 'keep' },
  }));
  assert.ok(highlight.ok);

  const undone = await undoBoardStroke(s.db, s.commit, 'undo-bio', biology);
  assert.ok(undone.ok);
  assert.deepEqual((await loadBoard(s.db, biology))?.strokes.map((stroke) => stroke.points), [bioPoints]);

  const cleared = await clearBoard(s.db, s.commit, () => 'clear-bio', biology);
  assert.ok(cleared.ok);
  assert.equal(cleared.deleted, 1);
  assert.deepEqual((await loadBoard(s.db, biology))?.strokes, []);
  assert.deepEqual((await loadBoard(s.db, history))?.strokes[0]?.points, historyPoints);
  const notes = await listAnnotations(s.db, note.value.chunkIds[0]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.type, 'highlight');
  assert.equal((await listChunks(s.db, biology)).filter((chunk) => !isWhiteboardChunk(chunk)).length, 1);
});

test('a failed stroke write stores nothing and the same operation can retry', async () => {
  const s = await setup();
  const roomId = await room(s);
  const seeded = await saveHumanStroke(s.db, s.commit, { roomId, points: [[1, 1]], opId: 'seed' });
  assert.ok(seeded.ok);
  const removed = await deleteBoardStroke(s.db, s.commit, 'seed-del', roomId, seeded.annotationId);
  assert.ok(removed.ok);
  assert.equal((await loadBoard(s.db, roomId))?.strokes.length, 0);

  const points: BoardPoint[] = [[12, 24], [48, 96]];
  const seen: string[] = [];
  const stop = boardRefresh.subscribe((id) => seen.push(id));
  try {
    const failing = createCommit(failOnWrite(s.db, 1), s.deps);
    const failed = await saveHumanStroke(s.db, failing, { roomId, points, opId: 'retry-me' });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.reason, 'failed');
    assert.equal((await loadBoard(s.db, roomId))?.strokes.length, 0);
    assert.deepEqual(seen, []);

    const saved = await saveHumanStroke(s.db, s.commit, { roomId, points, opId: 'retry-me' });
    assert.ok(saved.ok);
    assert.equal(saved.duplicate, false);
    assert.deepEqual((await loadBoard(s.db, roomId))?.strokes.map((stroke) => stroke.points), [points]);

    const duplicate = await saveHumanStroke(s.db, s.commit, { roomId, points, opId: 'retry-me' });
    assert.ok(duplicate.ok);
    assert.equal(duplicate.duplicate, true);
    assert.equal((await loadBoard(s.db, roomId))?.strokes.length, 1);
  } finally {
    stop();
  }
});

test('human strokes and deletes use the human gate, and an AI delete is forbidden', async () => {
  const s = await setup();
  const roomId = await room(s);
  const seen: string[] = [];
  const wrapped: Commit = async (op) => {
    seen.push(`${op.source}:${op.kind}:${op.confirmed}`);
    return s.commit(op);
  };
  const points: BoardPoint[] = [[2, 3], [4, 5]];
  const saved = await saveHumanStroke(s.db, wrapped, { roomId, points, opId: 'human-stroke' });
  assert.ok(saved.ok);
  assert.deepEqual(seen, ['human:chunk.create:false', 'human:annotation.create:false']);
  const operation = humanStrokeOperation({ opId: 'shape', chunkId: 'chunk', points });
  assert.ok(operation.ok);
  if (operation.ok) {
    assert.equal(operation.operation.source, 'human');
    assert.equal(operation.operation.confirmed, false);
    assert.equal(operation.operation.payload.type, 'stroke');
    assert.deepEqual(operation.operation.payload.payload, pencilPayload());
  }

  const aiDelete = await s.commit({
    opId: 'ai-delete',
    kind: 'annotation.delete',
    source: 'ai',
    confirmed: true,
    payload: { annotationId: saved.annotationId },
  });
  assert.equal(aiDelete.ok, false);
  if (!aiDelete.ok) assert.equal(aiDelete.error.code, 'forbidden');
  assert.deepEqual((await loadBoard(s.db, roomId))?.strokes[0]?.points, points);

  const cleared = await clearBoard(s.db, wrapped, () => 'clear-human', roomId);
  assert.ok(cleared.ok);
  assert.deepEqual(seen.at(-1), 'human:annotation.delete:false');
  assert.deepEqual((await loadBoard(s.db, roomId))?.strokes, []);
  const missing = await saveHumanStroke(s.db, s.commit, { roomId: 'missing-room', points, opId: 'missing' });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, 'not_found');
});
