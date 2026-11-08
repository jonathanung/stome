import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the room list does not virtualize away every note after the first', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/screens/RoomScreen.tsx', import.meta.url)), 'utf8');
  assert.equal(source.includes('windowSize={1}'), false);
  assert.equal(source.includes('initialNumToRender={1}'), false);
  assert.match(source, /windowSize=\{21\}/);
});

test('the note field does not take control of the caret on every selection change', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/features/chunks/ChunkEditor.tsx', import.meta.url)), 'utf8');
  assert.equal(source.includes('setSelection(event.nativeEvent.selection)'), false);
  assert.match(source, /if \(selection\) setSelection\(undefined\)/);
});
