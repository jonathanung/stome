import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { listChunks } from '../src/data/queries.ts';
import { pastedParagraphs, splitParagraphs } from '../src/features/chunks/paste.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

const THREE = 'Glycolysis splits glucose.\n\nThe Krebs cycle runs twice per glucose.\n\nThe electron transport chain needs oxygen.';

test('splitParagraphs splits on blank lines, trims, and drops empties', () => {
  assert.deepEqual(splitParagraphs(THREE), [
    'Glycolysis splits glucose.',
    'The Krebs cycle runs twice per glucose.',
    'The electron transport chain needs oxygen.',
  ]);
  assert.deepEqual(splitParagraphs('a\r\n\r\nb\n \t\n\n\nc\n'), ['a', 'b', 'c']);
  assert.deepEqual(splitParagraphs('line one\nline two'), ['line one\nline two']);
  assert.deepEqual(splitParagraphs('  \n\n  '), []);
});

test('a multi-paragraph paste is recognized; typing is not', () => {
  assert.equal(pastedParagraphs('', THREE)?.length, 3);
  assert.equal(pastedParagraphs('intro', `intro${THREE}`)?.length, 3);
  assert.equal(pastedParagraphs('one paragraph', 'one paragraph.'), null); // typed one character
  assert.equal(pastedParagraphs('a\n', 'a\n\n'), null); // typed Enter
  assert.equal(pastedParagraphs('', 'a single pasted line'), null);
  assert.equal(pastedParagraphs('first', 'first\n\nsecond paragraph')?.length, 2);
  // A draft that already has a blank line must not commit when a short edit lands in it.
  assert.equal(pastedParagraphs('Hello\n\nWorld', 'Hello\n\nWorld!!'), null);
  assert.equal(pastedParagraphs('Hello\n\nWorld', 'Hello!!\n\nWorld'), null);
});

test('pasting 3 paragraphs creates 3 chunks, in order, in one op', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let n = 0;
  const commit = createCommit(db, { newId: () => `id-${++n}`, now: () => 1 });
  const room = await commit({ opId: 'op-room', kind: 'room.create', payload: { name: 'bio' }, source: 'human', confirmed: false });
  assert.ok(room.ok);

  const paragraphs = pastedParagraphs('', THREE);
  assert.ok(paragraphs);
  const created = await commit({
    opId: 'op-paste',
    kind: 'chunk.create',
    payload: { roomId: room.value.roomId, bodies: paragraphs },
    source: 'human',
    confirmed: false,
  });
  assert.ok(created.ok);
  assert.equal(created.value.chunkIds.length, 3);
  const chunks = await listChunks(db, room.value.roomId);
  assert.deepEqual(
    chunks.map((c) => [c.position, c.body]),
    paragraphs.map((p, i) => [i, p]),
  );
});
