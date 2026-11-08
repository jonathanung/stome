import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { getChunk } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { renderMath } from '../src/features/notes/math-render.ts';
import { segmentNote, type NoteBlock } from '../src/features/notes/math-source.ts';
import { nodeDb } from './support/node-db.ts';

function maths(blocks: NoteBlock[]): string[] {
  const found: string[] = [];
  for (const block of blocks) {
    if (block.type === 'math') found.push(block.tex);
    else for (const part of block.inlines) if (part.type === 'math') found.push(part.tex);
  }
  return found;
}

const SOURCE = [
  'Energy $E=mc^{2}$ costs $5 today and $12.50 tomorrow, not $1,000.',
  '',
  '$$',
  '\\frac{1}{2}',
  '\\begin{bmatrix}',
  'a & b \\\\',
  'c & d',
  '\\end{bmatrix}',
  '$$',
  '',
  '\\[x_{i}\\]',
  'Inline \\(a^2\\) and a price in code: `$5 + $x$`.',
  '',
  '```',
  '$not math$',
  '$$',
  '\\frac{1}{2}',
  '$$',
  '```',
  '',
  'Broken $\\frac{1}{ stays text.',
].join('\n');

test('math is recognized and prices, code, and unclosed dollars stay text', () => {
  const blocks = segmentNote(SOURCE);
  assert.deepEqual(maths(blocks), ['E=mc^{2}', '\\frac{1}{2}\n\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}', 'x_{i}', 'a^2']);
  const code = blocks.filter((block) => block.type === 'line' && block.code).map((block) => block.type === 'line' ? block.inlines[0] : null);
  assert.ok(code.some((part) => part?.type === 'text' && part.text === '$not math$'));
  assert.equal(maths(blocks).some((tex) => tex.includes('stays text')), false);
  assert.equal(SOURCE.includes('$5 today'), true);
});

test('segmenting does not rewrite the source string', () => {
  const body = 'Keep $x^2$ and $9.99 exactly.';
  const copy = body.slice();
  segmentNote(body);
  assert.equal(body, copy);
});

test('a saved note reloads with the same dollars and backslashes', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let n = 0;
  const commit = createCommit(db, { newId: () => `id-${++n}`, now: () => 1 });
  const room = await commit({ opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'math' } });
  assert.ok(room.ok);
  const body = 'See $\\frac{1}{2}$ and $$E=mc^{2}$$ plus $5.';
  const created = await commit({
    opId: 'chunk', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: [body] },
  });
  assert.ok(created.ok);
  const chunk = await getChunk(db, created.value.chunkIds[0]);
  assert.equal(chunk?.body, body);
  const edited = `${body}\nStill $\\alpha$.`;
  const updated = await commit({
    opId: 'edit', kind: 'chunk.update', source: 'human', confirmed: false, expectedRevision: chunk!.revision,
    payload: { chunkId: chunk!.id, body: edited },
  });
  assert.ok(updated.ok);
  assert.equal((await getChunk(db, chunk!.id))?.body, edited);
});

test('fractions, superscripts, and matrices typeset, and a broken formula does not throw', () => {
  const fraction = renderMath('\\frac{1}{2}', true);
  const power = renderMath('E=mc^{2}', false);
  const matrix = renderMath('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', true);
  assert.equal(fraction.ok && power.ok && matrix.ok, true);
  if (fraction.ok) assert.match(fraction.html, /<mfrac>/);
  if (power.ok) assert.match(power.html, /<msup>/);
  if (matrix.ok) assert.match(matrix.html, /<mtable[\s>]/);
  for (const html of [fraction, power, matrix]) {
    if (html.ok) assert.equal(/<\s*script\b|javascript:/i.test(html.html), false);
  }
  const broken = renderMath('\\frac{1}{', true);
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.match(broken.message, /formula|parse|expected|Could not/i);
  assert.doesNotThrow(() => segmentNote('$$\n\\frac{1}{\n'));
});
