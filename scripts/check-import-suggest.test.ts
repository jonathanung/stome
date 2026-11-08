import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HarnessError } from '../src/harness/contract.ts';
import { completeReadTool, mockProvider } from '../src/harness/provider.ts';
import {
  IMPORT_EXCERPT_CHARS,
  IMPORT_TOOL_NAME,
  MAX_IMPORT_NOTES,
  type ImportSuggestInput,
  type ImportSuggestOutput,
} from '../src/harness/tools.ts';
import { applySuggestion, buildSuggestBatches, excerptAt, mergeSubjects } from '../src/import/suggest.ts';

const rooms = [{ id: 'r-bio', name: 'Biology' }, { id: 'r-hist', name: 'History' }];
const note = (id: string, title: string, text: string) => ({ id, title, bodies: [text] });
const signal = () => new AbortController().signal;

test('13 notes become 2 batches of at most 12', () => {
  const notes = Array.from({ length: 13 }, (_, i) => note(`n${i}`, `Note ${i}`, 'text'));
  const batches = buildSuggestBatches(notes, rooms);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].notes.length, MAX_IMPORT_NOTES);
  assert.equal(batches[1].notes.length, 1);
  assert.equal(batches[1].notes[0].id, 'n12');
  assert.deepEqual(batches[0].rooms, rooms);
});

test('excerpts are at most 500 chars and cut at a word boundary', () => {
  const text = Array.from({ length: 200 }, () => 'photosynthesis').join(' ');
  const cut = excerptAt(text);
  assert.ok(cut.length <= IMPORT_EXCERPT_CHARS);
  assert.ok(cut.length > IMPORT_EXCERPT_CHARS - 'photosynthesis'.length - 1);
  assert.match(cut, /photosynthesis$/);
  assert.equal(excerptAt('short text'), 'short text');
  const batch = buildSuggestBatches([note('a', 'A', text)], rooms)[0];
  assert.ok(batch.notes[0].text.length <= IMPORT_EXCERPT_CHARS);
});

test('applying a suggestion yields the existing RoomMapping for both kinds', () => {
  const existing = applySuggestion({ noteId: 'a', roomId: 'r-bio', newRoomName: null, subjects: [] }, 'x');
  assert.deepEqual(existing.mapping, { status: 'existing', roomId: 'r-bio' });
  const fresh = applySuggestion({ noteId: 'a', roomId: null, newRoomName: 'Cell biology', subjects: ['cells'] }, '');
  assert.deepEqual(fresh.mapping, { status: 'new', name: 'Cell biology' });
  assert.equal(fresh.subjects, 'cells');
});

test('subjects merge without duplicates', () => {
  assert.equal(mergeSubjects('Cells, Plants', ['cells', 'Energy', 'energy']), 'Cells, Plants, Energy');
  assert.equal(mergeSubjects('', []), '');
});

test('end to end with the mock: an existing match and a new room', async () => {
  const [batch] = buildSuggestBatches(
    [note('a', 'Biology week 1', 'cells'), note('b', 'Cooking', 'pasta')],
    rooms,
  );
  const out = await completeReadTool<ImportSuggestOutput>(
    mockProvider,
    { tool: IMPORT_TOOL_NAME, input: batch, scenario: 'success' },
    signal(),
  );
  assert.equal(out.suggestions.length, 2);
  assert.deepEqual(applySuggestion(out.suggestions[0], '').mapping, { status: 'existing', roomId: 'r-bio' });
  assert.deepEqual(applySuggestion(out.suggestions[1], '').mapping, { status: 'new', name: 'Imported notes' });
});

test('an invented room id is rejected with scope_rejected', async () => {
  const [batch] = buildSuggestBatches([note('a', 'A', 'x')], rooms);
  const fake = {
    async complete(): Promise<unknown> {
      return { suggestions: [{ noteId: 'a', roomId: 'r-made-up', newRoomName: null, subjects: [] }] };
    },
  };
  await assert.rejects(
    completeReadTool<ImportSuggestOutput>(fake, { tool: IMPORT_TOOL_NAME, input: batch as ImportSuggestInput, scenario: 'success' }, signal()),
    (error: unknown) => error instanceof HarnessError && error.code === 'scope_rejected',
  );
});
