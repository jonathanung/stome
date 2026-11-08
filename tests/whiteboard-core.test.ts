import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pointerOnCanvas, screenToBoard, zoomTransform } from '../src/whiteboard/geometry.ts';
import { appendBoardHistory } from '../src/whiteboard/history.ts';

test('whiteboard history stays on the newest stroke after the cap drops the oldest', () => {
  let history = [0];
  let index = 0;
  for (let i = 1; i <= 50; i += 1) {
    const next = appendBoardHistory(history, index, i, 50);
    history = next.history;
    index = next.index;
  }
  assert.equal(history.length, 50);
  assert.equal(index, 49);
  assert.equal(history[0], 1);
  assert.equal(history[49], 50);
});

test('a stroke after undo replaces the undone future', () => {
  const applied = appendBoardHistory([0, 1, 2], 0, 9, 50);
  assert.deepEqual(applied.history, [0, 9]);
  assert.equal(applied.index, 1);
});

test('zoom keeps the pointer on the same board point', () => {
  const before = { offsetX: 10, offsetY: 20, scale: 1 };
  const after = zoomTransform(before, 100, 80, 2);
  const [x0, y0] = screenToBoard(100, 80, before);
  const [x1, y1] = screenToBoard(100, 80, after);
  assert.ok(Math.abs(x0 - x1) < 1e-9);
  assert.ok(Math.abs(y0 - y1) < 1e-9);
  assert.equal(after.scale, 2);
});

test('a wheel pointer is measured from the canvas box', () => {
  assert.deepEqual(pointerOnCanvas(150, 90, { left: 40, top: 30 }), { x: 110, y: 60 });
});
