import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_IMPORT_BATCH, assignRoomToUnmapped, batchLimitMessage, mergeBatch, remainingCapacity } from '../src/import/batch.ts';
import { chooseExistingRoom, chooseNewRoom, unsetRoomMapping } from '../src/import/room-map.ts';

const item = (path: string, fingerprint = path) => ({ id: path, note: { path, fingerprint } });

test('the batch holds far more than 20 notes', () => {
  assert.ok(MAX_IMPORT_BATCH >= 200);
  const many = Array.from({ length: 150 }, (_, i) => item(`n${i}.md`));
  assert.equal(mergeBatch([], many).items.length, 150);
});

test('choosing more files appends to the batch instead of replacing it', () => {
  const first = mergeBatch([], [item('a.md'), item('b.md')]).items;
  const second = mergeBatch(first, [item('c.md')]);
  assert.deepEqual(second.items.map((i) => i.id), ['a.md', 'b.md', 'c.md']);
  assert.equal(second.duplicates, 0);
});

test('picking the same file twice adds it once; same name with new content is kept', () => {
  const first = mergeBatch([], [item('a.md', 'h1')]).items;
  const again = mergeBatch(first, [item('a.md', 'h1'), item('a.md', 'h2')]);
  assert.equal(again.items.length, 2);
  assert.equal(again.duplicates, 1);
});

test('files past the cap are counted, not added', () => {
  const result = mergeBatch([item('a.md')], [item('b.md'), item('c.md'), item('d.md')], 2);
  assert.deepEqual(result.items.map((i) => i.id), ['a.md', 'b.md']);
  assert.equal(result.dropped, 2);
  assert.equal(remainingCapacity(2, 2), 0);
  assert.equal(remainingCapacity(5, 2), 0);
  assert.match(batchLimitMessage(2, 2), /up to 2 notes\. 2 files were not added/);
});

test('one room can be given to every note that still needs one', () => {
  const room = chooseExistingRoom('room-1');
  const notes = [
    { id: 'unset', mapping: unsetRoomMapping() },
    { id: 'blank-new', mapping: chooseNewRoom('  ') },
    { id: 'has-room', mapping: chooseExistingRoom('room-2') },
    { id: 'has-new', mapping: chooseNewRoom('biology') },
    { id: 'skipped', mapping: unsetRoomMapping(), skipped: true },
    { id: 'done', mapping: unsetRoomMapping(), done: true },
  ];
  const result = assignRoomToUnmapped(notes, room);
  assert.deepEqual(Object.fromEntries(result.map((n) => [n.id, n.mapping])), {
    unset: room,
    'blank-new': room,
    'has-room': chooseExistingRoom('room-2'),
    'has-new': chooseNewRoom('biology'),
    skipped: unsetRoomMapping(),
    done: unsetRoomMapping(),
  });
  assert.equal(result[2], notes[2], 'untouched notes keep their identity');
});
