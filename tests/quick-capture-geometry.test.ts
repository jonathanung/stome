import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAPTURE_PANEL_MAX_WIDTH,
  captureLayerGeometry,
} from '../src/features/capture/geometry.ts';

function assertInsideViewport(viewportWidth: number) {
  const geometry = captureLayerGeometry(viewportWidth);
  assert.ok(geometry.left >= 0, `left ${geometry.left} must not be negative at ${viewportWidth}px`);
  assert.ok(
    geometry.right >= 0 && geometry.right <= viewportWidth,
    `right ${geometry.right} must stay inside ${viewportWidth}px`,
  );
  assert.equal(
    Math.round(geometry.left + geometry.width + geometry.right),
    Math.round(viewportWidth),
    'left, width, and right must fill the viewport exactly',
  );
  assert.ok(geometry.width > 0, 'the panel must keep a positive width');
  return geometry;
}

test('quick capture fits 320x568 without clipping', () => {
  const geometry = assertInsideViewport(320);
  assert.equal(geometry.width, 288);
  assert.equal(geometry.left, 16);
  assert.equal(geometry.right, 16);
  // The input and Save live inside the panel's 16px padding; the remaining
  // content box must still be wide enough for them.
  assert.ok(geometry.width - 32 > 0);
});

test('quick capture keeps the 16px inset at 360px and wider', () => {
  for (const viewportWidth of [360, 390, 768, 1280]) {
    const geometry = assertInsideViewport(viewportWidth);
    assert.equal(geometry.right, 16, `right inset at ${viewportWidth}px`);
    assert.ok(geometry.width <= CAPTURE_PANEL_MAX_WIDTH);
  }
  assert.equal(captureLayerGeometry(360).width, 328);
  assert.equal(captureLayerGeometry(390).width, CAPTURE_PANEL_MAX_WIDTH);
  assert.equal(captureLayerGeometry(1280).left, 924);
});

test('quick capture keeps its intended width when the viewport is unknown', () => {
  assert.deepEqual(captureLayerGeometry(0), { width: CAPTURE_PANEL_MAX_WIDTH, left: 0, right: 16 });
  assert.deepEqual(captureLayerGeometry(Number.NaN), { width: CAPTURE_PANEL_MAX_WIDTH, left: 0, right: 16 });
});
