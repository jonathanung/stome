import assert from 'node:assert/strict';
import { test } from 'node:test';

import { consumeCommaList, isSubmitShortcut, matchesQuery, mergeNotes, splitAt } from '../src/features/notes/note-ops.ts';
import { PendingDeletes, type PendingDelete } from '../src/features/notes/pending-delete.ts';

/* ---------------------------------------------------------------- search */

test('search matches every word in the text or subjects, ignoring case and order', () => {
  const note = { body: 'Mitochondria make ATP through oxidative phosphorylation.', subjects: ['Cell biology'] };
  assert.equal(matchesQuery(note, ''), true);
  assert.equal(matchesQuery(note, '  '), true);
  assert.equal(matchesQuery(note, 'atp'), true);
  assert.equal(matchesQuery(note, 'ATP mitochondria'), true);
  assert.equal(matchesQuery(note, 'cell atp'), true, 'subjects are searched too');
  assert.equal(matchesQuery(note, 'atp ribosome'), false, 'every word must match');
});

/* ----------------------------------------------------------------- split */

test('split at the cursor trims the cut and needs text on both sides', () => {
  const body = 'Glycolysis splits glucose.\n\nThe Krebs cycle runs twice.';
  const caret = body.indexOf('The');
  assert.deepEqual(splitAt(body, caret), { head: 'Glycolysis splits glucose.', tail: 'The Krebs cycle runs twice.' });
  assert.deepEqual(splitAt('ab', 1), { head: 'a', tail: 'b' });
  assert.equal(splitAt(body, 0), null, 'at the start nothing moves');
  assert.equal(splitAt(body, body.length), null, 'at the end nothing moves');
  assert.equal(splitAt('text   ', 4), null, 'only spaces after the cursor');
  assert.equal(splitAt(body, Number.NaN), null);
});

/* ----------------------------------------------------------------- merge */

test('merge joins with a blank line and keeps both subject lists without duplicates', () => {
  const merged = mergeNotes({ body: 'First.\n', subjects: ['Biology', 'cells'] }, { body: '\nSecond.', subjects: ['Cells', 'energy'] });
  assert.deepEqual(merged, { body: 'First.\n\nSecond.', subjects: ['Biology', 'cells', 'energy'] });
});

test('merge refuses results the save boundary would reject', () => {
  assert.deepEqual(mergeNotes({ body: 'a'.repeat(30_000), subjects: [] }, { body: 'b'.repeat(30_000), subjects: [] }), { error: 'Those notes are too long to merge into one.' });
  const many = (prefix: string) => Array.from({ length: 7 }, (_, i) => `${prefix}${i}`);
  assert.ok('error' in mergeNotes({ body: 'a', subjects: many('x') }, { body: 'b', subjects: many('y') }));
});

/* -------------------------------------------------------------- shortcut */

test('a subject field is consumed once when Enter also blurs it', () => {
  const holder = { current: 'cells, energy' };
  assert.deepEqual(consumeCommaList(holder), ['cells', 'energy']);
  assert.equal(holder.current, '');
  assert.deepEqual(consumeCommaList(holder), []);
});

test('Ctrl+Enter and Cmd+Enter are the submit shortcut; plain Enter is not', () => {
  assert.equal(isSubmitShortcut({ key: 'Enter', ctrlKey: true }), true);
  assert.equal(isSubmitShortcut({ key: 'Enter', metaKey: true }), true);
  assert.equal(isSubmitShortcut({ nativeEvent: { key: 'Enter', ctrlKey: true } }), true);
  assert.equal(isSubmitShortcut({ key: 'Enter' }), false);
  assert.equal(isSubmitShortcut({ nativeEvent: { key: 'Enter' } }), false, 'native keyboards have no modifiers');
  assert.equal(isSubmitShortcut({ key: 'a', ctrlKey: true }), false);
});

/* ---------------------------------------------------------- undo delete */

function fakeTimers() {
  let timers: { fn: () => void; id: number }[] = [];
  let next = 0;
  return {
    schedule(fn: () => void) {
      const id = ++next;
      timers.push({ fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    fire() {
      const due = timers;
      timers = [];
      due.forEach((t) => t.fn());
    },
    pending: () => timers.length,
  };
}

function setup(fail = false) {
  const clock = fakeTimers();
  const committed: string[] = [];
  const changes: (PendingDelete | null)[] = [];
  const errors: string[] = [];
  const deletes = new PendingDeletes({
    schedule: clock.schedule,
    commit: async (entry) => {
      committed.push(entry.chunkId);
      return fail ? { ok: false, message: 'stale' } : { ok: true };
    },
    onChange: (pending) => changes.push(pending),
    onError: (message) => errors.push(message),
  });
  return { clock, committed, changes, errors, deletes };
}

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

test('a deleted note is hidden at once and committed only when the window closes', async () => {
  const s = setup();
  await s.deletes.remove({ chunkId: 'a', label: 'Note deleted' });
  assert.equal(s.deletes.isHidden('a'), true);
  assert.deepEqual(s.committed, []);
  s.clock.fire();
  await flushMicrotasks();
  assert.deepEqual(s.committed, ['a']);
  assert.equal(s.deletes.pending, null);
  assert.equal(s.deletes.isHidden('a'), false);
});

test('undo cancels the delete: nothing is committed and the text to restore comes back', async () => {
  const s = setup();
  await s.deletes.remove({ chunkId: 'a', label: 'Empty note removed', restoreBody: 'old text' });
  const undone = s.deletes.undo();
  assert.deepEqual(undone, { chunkId: 'a', label: 'Empty note removed', restoreBody: 'old text' });
  assert.equal(s.deletes.isHidden('a'), false);
  assert.equal(s.clock.pending(), 0);
  s.clock.fire();
  await flushMicrotasks();
  assert.deepEqual(s.committed, []);
});

test('deleting a second note commits the first; only the latest can be undone', async () => {
  const s = setup();
  await s.deletes.remove({ chunkId: 'a', label: 'Note deleted' });
  await s.deletes.remove({ chunkId: 'b', label: 'Note deleted' });
  assert.deepEqual(s.committed, ['a']);
  assert.equal(s.deletes.pending?.chunkId, 'b');
  assert.equal(s.deletes.undo()?.chunkId, 'b');
  assert.deepEqual(s.committed, ['a']);
});

test('leaving the screen commits a pending delete', async () => {
  const s = setup();
  await s.deletes.remove({ chunkId: 'a', label: 'Note deleted' });
  await s.deletes.flush();
  assert.deepEqual(s.committed, ['a']);
  await s.deletes.flush();
  assert.deepEqual(s.committed, ['a'], 'a second flush does nothing');
});

test('a failed delete reports the error and the note is shown again', async () => {
  const s = setup(true);
  await s.deletes.remove({ chunkId: 'a', label: 'Note deleted' });
  await s.deletes.flush();
  assert.equal(s.deletes.isHidden('a'), false);
  assert.match(s.errors[0], /Could not delete the note: stale/);
});
