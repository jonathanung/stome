import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createCommit } from '../src/data/commit.ts';
import { listChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { accountVaultPaths, MAX_VAULT_PATHS, parseMarkdown, sourceIdentity } from '../src/import/markdown.ts';
import { nodeDb } from './support/node-db.ts';

const root = fileURLToPath(new URL('./fixtures/import-vault/', import.meta.url));

function vaultPaths(): string[] {
  const paths: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      const info = statSync(full);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) visit(full);
      else paths.push(relative(root, full).split('\\').join('/'));
    }
  };
  visit(root);
  return paths.sort();
}

function contentLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
}

test('tiny vault skips attachments and config with visible accounting', () => {
  const paths = vaultPaths();
  assert.deepEqual(paths, [
    '.obsidian/app.json',
    'Attachments/cell-diagram.png',
    'Attachments/page.pdf',
    'Biology/Cells.md',
    'Biology/Organelles.md',
    'Daily/rough.md',
    'Inbox/quoted.md',
    'README.txt',
  ]);
  const accounted = accountVaultPaths(paths);
  assert.deepEqual(accounted.entries.map((entry) => entry.kind), [
    'config', 'attachment', 'attachment', 'note', 'note', 'note', 'note', 'unsupported',
  ]);
  assert.deepEqual(accounted.warnings, [
    'Skipped 2 attachments (Attachments/cell-diagram.png, Attachments/page.pdf), 1 config file (.obsidian/app.json), 1 unsupported file (README.txt). These files were not copied or executed.',
  ]);
  const unsafe = accountVaultPaths(['../secret.md', '/etc/passwd', 'C:\\note.md', ...Array.from({ length: MAX_VAULT_PATHS }, (_, i) => `notes/${i}.md`)]);
  assert.equal(unsafe.entries.filter((entry) => entry.kind === 'note').length, MAX_VAULT_PATHS - 3);
  assert.ok(unsafe.warnings.some((warning) => warning.includes('additional paths were not imported')));
  assert.ok(unsafe.warnings.some((warning) => warning.includes('unsafe paths')));
  assert.equal(unsafe.entries.some((entry) => entry.kind === 'note' && entry.path.includes('..')), false);
});

test('vault notes keep headings, frontmatter, tags, wikilinks and source text', () => {
  const notes = ['Biology/Cells.md', 'Biology/Organelles.md', 'Daily/rough.md', 'Inbox/quoted.md'].map((path) => {
    const text = readFileSync(join(root, path), 'utf8');
    return { path, text, note: parseMarkdown({ path, text }) };
  });
  const [cells, organelles, rough, quoted] = notes;
  for (const item of notes) {
    assert.equal(item.note.path, item.path);
    for (const line of contentLines(item.text)) assert.ok(item.note.bodies.some((body) => body.includes(line)), `${item.path} dropped ${line}`);
  }
  assert.deepEqual(cells.note.subjects, ['biology', 'revision', 'cells', 'science']);
  assert.deepEqual(cells.note.metadata.headings.map((heading) => heading.text), ['Cells', 'Examples', 'Revision']);
  assert.deepEqual(cells.note.metadata.tags, ['biology', 'revision', 'science']);
  assert.deepEqual(cells.note.metadata.properties, [
    { key: 'tags', values: ['biology', 'revision'] },
    { key: 'subjects', values: ['cells'] },
    { key: 'aliases', values: ['Cell notes'] },
  ]);
  assert.deepEqual(cells.note.metadata.wikilinks, [
    { raw: '[[Organelles|organelles]]', target: 'Organelles', heading: null, alias: 'organelles', embed: false },
  ]);
  assert.deepEqual(cells.note.metadata.skippedAttachments, [{ raw: '![[cell-diagram.png]]', name: 'cell-diagram.png' }]);
  assert.ok(cells.note.warnings.some((warning) => warning.includes('Skipped 1 attachment (cell-diagram.png)')));
  assert.equal(cells.note.metadata.headings.some((heading) => heading.text.includes('code')), false);

  assert.deepEqual(organelles.note.metadata.wikilinks, [
    { raw: '[[Cells#Cells|the cell note]]', target: 'Cells', heading: 'Cells', alias: 'the cell note', embed: false },
  ]);
  assert.equal(organelles.note.bodies.join('\n').includes('[[Hidden|not metadata]]'), true);
  assert.equal(organelles.note.metadata.wikilinks.some((link) => link.target === 'Hidden'), false);

  assert.deepEqual(rough.note.metadata.properties, [{ key: 'title', values: ['still here'] }]);
  assert.deepEqual(rough.note.subjects, ['Daily']);
  assert.deepEqual(rough.note.metadata.wikilinks.map((link) => link.raw), ['[[|missing target]]', '[[Good|alias|extra]]']);
  assert.deepEqual(rough.note.metadata.skippedAttachments.map((item) => item.name), ['../secret.png', 'https://example.com/a.png']);
  assert.ok(rough.note.warnings.some((warning) => warning.includes('empty target')));
  assert.ok(rough.note.warnings.some((warning) => warning.includes('unclosed wikilink')));
  assert.ok(rough.note.warnings.some((warning) => warning.includes('Complex YAML')));

  assert.deepEqual(quoted.note.subjects, ['Inbox']);
  assert.deepEqual(quoted.note.metadata.properties, []);
  assert.deepEqual(quoted.note.metadata.wikilinks, [
    { raw: '[[Organelles|]]', target: 'Organelles', heading: null, alias: null, embed: false },
  ]);
  assert.ok(quoted.note.warnings.some((warning) => warning.includes('inline frontmatter comment')));
  const skippedText = `${readFileSync(join(root, 'README.txt'), 'utf8')}\n${readFileSync(join(root, '.obsidian/app.json'), 'utf8')}`;
  for (const line of contentLines(skippedText)) {
    assert.equal(notes.some((item) => item.note.bodies.some((body) => body.includes(line))), false);
  }
});

test('re-importing a parsed vault note keeps identical-source dedupe and conflict protection', async (t) => {
  const db = nodeDb();
  t.after(() => db.close());
  await migrateDb(db);
  let id = 0;
  const commit = createCommit(db, { now: () => 1234, newId: () => `id-${++id}` });
  const text = readFileSync(join(root, 'Biology/Cells.md'), 'utf8');
  const parsed = parseMarkdown({ path: 'Biology/Cells.md', text });
  const sourceId = sourceIdentity('vault', parsed.path);
  assert.equal(sourceId, 'markdown:vault/Biology/Cells.md');
  const fingerprint = createHash('sha256').update(text).digest('hex');
  const op = {
    opId: 'import-cells', kind: 'import.note' as const, source: 'import' as const, confirmed: true,
    payload: { sourceId, fingerprint, destination: { name: 'biology' }, bodies: parsed.bodies, subjects: parsed.subjects },
  };
  const first = await commit(op);
  assert.ok(first.ok && first.value.skipped === false);
  const again = await commit({ ...op, opId: 'import-cells-again' });
  assert.ok(again.ok && again.value.skipped === true);
  assert.deepEqual(again.value.chunkIds, first.value.chunkIds);
  const chunks = await listChunks(db, first.value.roomId);
  assert.equal(chunks.length, parsed.bodies.length);
  assert.deepEqual(chunks.map((chunk) => chunk.body), parsed.bodies);
  assert.ok(chunks.every((chunk) => chunk.sourceLink === sourceId && chunk.subjects.join(',') === parsed.subjects.join(',')));
  assert.ok(chunks.some((chunk) => chunk.body.startsWith('---') && chunk.body.includes('tags: [biology, revision]')));
  assert.ok(chunks.some((chunk) => chunk.body.includes('[[Organelles|organelles]]') && chunk.body.includes('![[cell-diagram.png]]')));
  assert.ok(parsed.metadata.headings.every((heading) => chunks.some((chunk) => chunk.body.includes(`# ${heading.text}`) || chunk.body.includes(`${'#'.repeat(heading.level)} ${heading.text}`))));
  const changed = await commit({
    ...op,
    opId: 'import-cells-changed',
    payload: { ...op.payload, fingerprint: 'b'.repeat(64), bodies: ['changed source'] },
  });
  assert.ok(!changed.ok && changed.error.code === 'conflict');
  assert.deepEqual((await listChunks(db, first.value.roomId)).map((chunk) => chunk.body), parsed.bodies);
});
