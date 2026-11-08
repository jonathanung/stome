import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { roomRowPress } from '../src/navigation/room-row.ts';

test('a tap opens the room unless it is the row whose actions are showing', () => {
  assert.equal(roomRowPress(null, 'a'), 'open');
  assert.equal(roomRowPress('a', 'a'), 'close');
  assert.equal(roomRowPress('a', 'b'), 'open');
});

test('the phone rooms list opens a different room while a swipe is open', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/screens/RoomsScreen.phone.tsx', import.meta.url)), 'utf8');
  assert.match(source, /roomRowPress\(swipedId, item\.id\) === 'close'/);
  assert.match(source, /router\.push\(`\/rooms\/\$\{item\.id\}`\)/);
});
