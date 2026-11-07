import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ROOM_BACK_LABEL,
  backLabelHasArrow,
  followRoomBack,
  roomBackStep,
} from '../src/navigation/room-back.ts';

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

test('the room back label is the word rooms and not a second arrow', () => {
  assert.equal(ROOM_BACK_LABEL, 'rooms');
  assert.equal(backLabelHasArrow(ROOM_BACK_LABEL), false);
  assert.equal(backLabelHasArrow('← rooms'), true);
});

test('ordinary back pops history and a direct open opens the rooms list', () => {
  const calls: string[] = [];
  const nav = {
    back: () => { calls.push('back'); },
    replace: (href: '/') => { calls.push(href); },
  };
  followRoomBack(roomBackStep(true), nav);
  followRoomBack(roomBackStep(false), nav);
  assert.deepEqual(calls, ['back', '/']);
});

test('the room header uses one chevron label and the screen does not add another arrow', () => {
  const header = source('../src/screens/RoomHeader.tsx');
  const screen = source('../src/screens/RoomScreen.tsx');
  assert.match(header, /label=\{ROOM_BACK_LABEL\}/);
  assert.equal(header.includes('←'), false);
  assert.equal(screen.includes('←'), false);
  assert.match(screen, /followRoomBack\(roomBackStep\(router\.canGoBack\(\)\), router\)/);
  assert.match(screen, /Open whiteboard/);
});
