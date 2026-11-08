import assert from 'node:assert/strict';
import { test } from 'node:test';

import { showsWhiteboardSidePanel, whiteboardEntry, whiteboardNotesTarget } from '../src/features/room/whiteboard-entry.ts';

test('iPad portrait and landscape open the whiteboard from the room header', () => {
  // CSS pixels for mini, 10.9, 11-inch, and 12.9-inch iPads. Native is portrait-locked;
  // Safari can be either orientation. None of these except 12.9 landscape are wide.
  const ipad = [744, 768, 810, 820, 834, 1024, 1080, 1112, 1133, 1180, 1194, 1366];
  for (const width of ipad) {
    assert.equal(whiteboardEntry(width), 'header', `width ${width}`);
  }
  assert.equal(showsWhiteboardSidePanel(1194), false);
  assert.equal(showsWhiteboardSidePanel(1366), true);
});

test('Notes returns to the room when the board was opened directly', () => {
  assert.equal(whiteboardNotesTarget('room-1'), '/rooms/room-1');
  assert.equal(whiteboardNotesTarget(undefined), '/');
});

test('a phone-width window does not use the room header', () => {
  assert.equal(whiteboardEntry(390), 'phone');
  assert.equal(whiteboardEntry(599), 'phone');
  assert.equal(whiteboardEntry(600), 'header');
});
