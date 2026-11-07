import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MAX_IMPORT_BYTES, parseMarkdown, sourceIdentity } from '../src/import/markdown.ts';

test('synthetic vault preserves source content and infers reviewable structure', () => {
  const text = readFileSync(new URL('./fixtures/import-vault/Biology/Cells.md', import.meta.url), 'utf8');
  const note = parseMarkdown({ path: 'Biology/Cells.md', text });
  assert.equal(note.bodies.length, 4);
  assert.deepEqual(note.subjects, ['biology', 'revision', 'cells', 'science']);
  assert.ok(note.bodies[0].startsWith('---'));
  assert.ok(note.bodies[1].includes('![[cell-diagram.png]]'));
  assert.ok(note.bodies[2].includes('# This is code'));
  assert.ok(note.warnings.some((w) => w.includes('attachments')));
});

test('fences, inline code, CRLF and Unicode do not produce spurious subjects/headings', () => {
  const note = parseMarkdown({ path: 'note.MD', text: '\uFEFF# Héllo\r\n~~~js\r\n# hidden\r\n```\r\n~~~\r\n`#code` #étude\r\n## Next\r\ntext' });
  assert.equal(note.bodies.length, 2);
  assert.deepEqual(note.subjects, ['étude']);
});

test('chunking is bounded and preserves surrogate pairs', () => {
  const text = 'x'.repeat(49_999) + '😀' + 'z'.repeat(20);
  const note = parseMarkdown({ path: 'long.md', text });
  assert.equal(note.bodies.length, 2);
  assert.equal(note.bodies.join(''), text);
  assert.equal(note.bodies[1].slice(0, 2), '😀');
});

test('rejects binary, empty, oversize, unsupported and unsafe inputs', () => {
  for (const text of ['', '  ', 'x\0y', '\ufffd', 'x'.repeat(MAX_IMPORT_BYTES + 1), '😀'.repeat(MAX_IMPORT_BYTES / 4 + 1), Array.from({ length: 201 }, (_, i) => `# h${i}\nx`).join('\n')]) {
    assert.throws(() => parseMarkdown({ path: 'note.md', text }));
  }
  for (const path of ['../note.md', '/note.md', 'C:\\note.md', 'folder//note.md', 'note.pdf']) {
    assert.throws(() => parseMarkdown({ path, text: 'hi' }));
  }
});

test('complex and unclosed YAML survives without invented subjects', () => {
  const text = '---\ntags: {nested: value}\n---\n# Note\ntext';
  const note = parseMarkdown({ path: 'note.md', text });
  assert.ok(note.bodies[0].includes('tags: {nested: value}'));
  assert.deepEqual(note.subjects, []);
  assert.ok(note.warnings.some((w) => w.includes('Complex YAML')));
  assert.ok(parseMarkdown({ path: 'note.md', text: '---\ntags: [x]\ntext' }).warnings.some((w) => w.includes('Unclosed')));
});

test('stable identities use collection/path and distinguish same-named notes', () => {
  assert.equal(sourceIdentity(' vault ', 'Biology\\Cells.md'), sourceIdentity('vault', 'Biology/Cells.md'));
  assert.notEqual(sourceIdentity('vault', 'A/Cells.md'), sourceIdentity('vault', 'B/Cells.md'));
  assert.notEqual(sourceIdentity('one', 'note.md'), sourceIdentity('two', 'note.md'));
  assert.throws(() => sourceIdentity('', 'note.md'));
});
