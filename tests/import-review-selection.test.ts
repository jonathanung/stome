import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectedReviewNote } from '../src/import/review-selection.ts';
import { chooseNewRoom, unsetRoomMapping } from '../src/import/room-map.ts';

const note = (id: string, mapping = unsetRoomMapping()) => ({ id, done: false, skipped: false, mapping });

test('typing a valid room name keeps the same note selected', () => {
  const notes = [note('note-00'), note('note-01'), note('note-02')];
  const pinned = selectedReviewNote(notes, null);
  assert.equal(pinned?.id, 'note-00');

  const edited = notes.map((item) => item.id === pinned?.id ? { ...item, mapping: chooseNewRoom('B') } : item);
  assert.equal(selectedReviewNote(edited, pinned?.id ?? null)?.id, 'note-00');
  assert.equal(selectedReviewNote(edited, null)?.id, 'note-01', 'forgetting the selected note moves the field');
});

test('a removed selection falls back to the next note that still needs a room', () => {
  const notes = [note('kept', chooseNewRoom('Biology Lab')), note('open')];
  assert.equal(selectedReviewNote(notes, 'gone')?.id, 'open');
});
