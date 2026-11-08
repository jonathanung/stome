import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { getRoom, listChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { MAX_IMPORT_BYTES } from '../src/import/markdown.ts';
import { crc32 } from '../src/import/inflate.ts';
import { parseOneNoteBytes, parseOneNoteText, onenotePathSubjects, onenoteSourceIdentity, UNSUPPORTED_WARNING } from '../src/import/onenote/parse.ts';
import { nodeDb } from './support/node-db.ts';

const htmlFixture = new URL('./fixtures/onenote-synthetic/Biology/Cells/Mitochondria.html', import.meta.url);
const mhtFixture = new URL('./fixtures/onenote-synthetic/Biology/Cells/Mitochondria.mht', import.meta.url);

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

/** Minimal ZIP of local headers only. Synthetic DOCX bytes, not a Word save. */
function zip(entries: { name: string; data: Buffer; method?: number; flags?: number }[]): Uint8Array {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name);
    chunks.push(Buffer.concat([
      u32(0x04034b50), u16(20), u16(entry.flags ?? 0), u16(method), u16(0), u16(0), u32(crc32(entry.data)),
      u32(compressed.length), u32(entry.data.length), u16(name.length), u16(0), name, compressed,
    ]));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Mitochondria</w:t></w:r></w:p>
    <w:p><w:r><w:t>The powerhouse &amp; more.</w:t></w:r><w:r><w:drawing><w:inline/></w:drawing></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Structure</w:t></w:r></w:p>
    <w:p><w:r><w:t>Crist</w:t></w:r><w:r><w:t>ae</w:t></w:r></w:p>
    <w:p><w:r><w:instrText>DO_NOT_KEEP</w:instrText></w:r><w:r><w:t>Visible</w:t></w:r></w:p>
  </w:body>
</w:document>`;

test('deflated DOCX exports do not require browser compression or Blob APIs', async () => {
  const previousStream = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  const previousBlob = Object.getOwnPropertyDescriptor(globalThis, 'Blob');
  Reflect.deleteProperty(globalThis, 'DecompressionStream');
  Reflect.deleteProperty(globalThis, 'Blob');
  try {
    const bytes = zip([{ name: 'word/document.xml', data: Buffer.from(documentXml), method: 8 }]);
    const note = await parseOneNoteBytes({ path: 'Biology/Cells.docx', bytes });
    assert.match(note.bodies.join('\n'), /Mitochondria/);
    assert.match(note.bodies.join('\n'), /powerhouse & more/);
  } finally {
    if (previousStream) Object.defineProperty(globalThis, 'DecompressionStream', previousStream);
    if (previousBlob) Object.defineProperty(globalThis, 'Blob', previousBlob);
  }
});

test('DOCX stored and deflated content must match the ZIP checksum', async () => {
  for (const method of [0, 8]) {
    const bytes = zip([{ name: 'word/document.xml', data: Buffer.from(documentXml), method }]);
    bytes[14] ^= 1;
    await assert.rejects(parseOneNoteBytes({ path: 'Corrupt.docx', bytes }), /ZIP checksum/);
  }
});

test('synthetic HTML keeps headings and drops active content without fetching', () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    throw new Error('network');
  };
  try {
    const note = parseOneNoteText({ path: 'Biology/Cells/Mitochondria.html', text: readFileSync(htmlFixture, 'utf8') });
    assert.equal(calls, 0);
    assert.equal(note.exportFormat, 'onenote-html');
    assert.equal(note.title, 'Mitochondria');
    assert.deepEqual(note.subjects, []);
    assert.deepEqual(note.bodies, [
      '# Mitochondria\nThe powerhouse of the cell.\n[image: diagram]',
      '## Structure\n- Cristae\n- Matrix\nOuter membrane\nbad link paper\nInner\nFolded',
    ]);
    const rendered = note.bodies.join('\n');
    assert.equal(rendered.includes('evil.example'), false);
    assert.equal(rendered.includes('javascript:'), false);
    assert.equal(rendered.includes('alert'), false);
    assert.equal(rendered.includes('fetch'), false);
    assert.equal(rendered.includes('onclick'), false);
    assert.ok(note.warnings.includes(UNSUPPORTED_WARNING));
    assert.ok(note.warnings.some((warning) => warning.includes('not run')));
    assert.ok(note.warnings.some((warning) => warning.includes('not fetched')));
  } finally {
    globalThis.fetch = previous;
  }
});

test('source path folders map notebook and section subjects without sticking after a path edit', () => {
  assert.equal(onenotePathSubjects([], 'Biology/Cells/Mitochondria.html').subjects, 'Biology, Cells');
  assert.equal(onenotePathSubjects(['revision'], 'Biology/Cells/Page.html').subjects, 'revision, Biology, Cells');
  assert.equal(onenotePathSubjects(['revision'], 'School/Page.html').subjects, 'revision, School');
  assert.match(onenotePathSubjects([], 'Page.html').folderWarning ?? '', /notebook or section/);
  assert.match(onenotePathSubjects([], 'Genetics, Ecology/Page.html').folderWarning ?? '', /comma/);
  assert.equal(onenotePathSubjects([], 'Genetics, Ecology/Page.html').subjects, '');
  assert.equal(onenoteSourceIdentity(' vault ', 'Biology\\Cells\\Mitochondria.html'), 'markdown:vault/Biology/Cells/Mitochondria.html');
  assert.notEqual(onenoteSourceIdentity('vault', 'Biology/Cells/Mitochondria.html'), 'markdown:vault/Biology/Cells/Mitochondria.md');
  for (const path of ['../Page.html', '/Page.html', 'note.one', 'note.pdf', 'note.md', 'note.doc']) {
    assert.throws(() => onenoteSourceIdentity('vault', path));
  }
});

test('synthetic MHTML decodes the HTML part and ignores the embedded file', () => {
  const note = parseOneNoteText({ path: 'Biology/Cells/Mitochondria.mht', text: readFileSync(mhtFixture, 'utf8') });
  assert.equal(note.exportFormat, 'onenote-mhtml');
  assert.equal(note.title, 'Mitochondria');
  assert.deepEqual(note.bodies, ['# Mitochondria\nCristæ hold enzymes.']);
  assert.equal(note.bodies.join('\n').includes('evil.example'), false);
  assert.ok(note.warnings.some((warning) => warning.includes('1 non-HTML')));
  assert.throws(() => parseOneNoteText({
    path: 'too-many.mht',
    text: `Content-Type: multipart/related; boundary="b"\n\n${Array.from({ length: 42 }, () => '--b\nContent-Type: text/plain\n\nx').join('\n')}\n--b--`,
  }));
});

test('synthetic stored and deflated DOCX keep headings and skip media', async () => {
  const xml = Buffer.from(documentXml);
  const media = Buffer.from('not-a-real-image');
  for (const method of [0, 8] as const) {
    const bytes = zip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>'), method },
      { name: 'word/document.xml', data: xml, method },
      { name: 'word/media/image1.png', data: media, method },
    ]);
    const note = await parseOneNoteBytes({ path: 'Biology/Cells/Mitochondria.docx', bytes });
    assert.equal(note.exportFormat, 'onenote-docx');
    assert.deepEqual(note.bodies, ['# Mitochondria\nThe powerhouse & more.', '## Structure\nCristae\nVisible']);
    assert.equal(note.bodies.join('\n').includes('DO_NOT_KEEP'), false);
    assert.ok(note.warnings.some((warning) => warning.includes('not fetched')));
    assert.ok(note.warnings.some((warning) => warning.includes('word/document.xml')));
  }
});

test('DOCX rejects bombs, unsafe paths, encryption, streaming layouts and document types', async () => {
  const huge = zip([{ name: 'word/document.xml', data: Buffer.alloc(0) }]);
  const view = new DataView(huge.buffer, huge.byteOffset, huge.byteLength);
  view.setUint32(22, MAX_IMPORT_BYTES + 1, true);
  await assert.rejects(() => parseOneNoteBytes({ path: 'bomb.docx', bytes: huge }), /1 MiB/);
  await assert.rejects(() => parseOneNoteBytes({ path: 'slip.docx', bytes: zip([{ name: '../word/document.xml', data: Buffer.from('<w:document/>') }]) }), /not safe/);
  await assert.rejects(() => parseOneNoteBytes({ path: 'encrypted.docx', bytes: zip([{ name: 'word/document.xml', data: Buffer.from('<w:document/>'), flags: 1 }]) }), /Encrypted/);
  await assert.rejects(() => parseOneNoteBytes({ path: 'stream.docx', bytes: zip([{ name: 'word/document.xml', data: Buffer.from('<w:document/>'), flags: 8 }]) }), /streaming/);
  const many = zip(Array.from({ length: 65 }, (_, index) => ({ name: `word/part-${index}.xml`, data: Buffer.from('<x/>') })));
  await assert.rejects(() => parseOneNoteBytes({ path: 'many.docx', bytes: many }), /too many entries/);
  const typed = documentXml.replace('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<!DOCTYPE document SYSTEM "http://evil.example/x">');
  await assert.rejects(() => parseOneNoteBytes({ path: 'type.docx', bytes: zip([{ name: 'word/document.xml', data: Buffer.from(typed) }]) }), /document type/);
  assert.throws(() => parseOneNoteText({ path: 'native.one', text: 'PK' }));
  assert.throws(() => parseOneNoteText({ path: 'empty.html', text: '<html><head><script>fetch("https://evil.example")</script></head><body></body></html>' }));
});

test('long HTML sections split on the body limit without cutting a surrogate pair', () => {
  const text = `<title>Long</title><p>${'x'.repeat(49_999)}😀${'z'.repeat(20)}</p>`;
  const note = parseOneNoteText({ path: 'Long.html', text });
  assert.equal(note.bodies[0], '# Long');
  assert.equal(note.bodies[1].length, 49_999);
  assert.equal(note.bodies[2].slice(0, 2), '😀');
  assert.ok(note.warnings.some((warning) => warning.includes('split')));
  assert.throws(() => parseOneNoteText({ path: 'big.html', text: 'x'.repeat(MAX_IMPORT_BYTES + 1) }));
});

test('a reviewed HTML export commits through the existing import boundary and awards no study credit', async (t) => {
  const parsed = parseOneNoteText({ path: 'Biology/Cells/Mitochondria.html', text: readFileSync(htmlFixture, 'utf8') });
  const db = nodeDb();
  t.after(() => db.close());
  await migrateDb(db);
  let id = 0;
  const commit = createCommit(db, { now: () => 1234, newId: () => `id-${++id}` });
  const payload = {
    sourceId: onenoteSourceIdentity('synthetic', parsed.path),
    fingerprint: 'ab'.repeat(32),
    destination: { name: parsed.title },
    bodies: parsed.bodies,
    subjects: onenotePathSubjects([], parsed.path).subjects.split(', '),
  };
  const saved = await commit({ opId: 'import-1', kind: 'import.note', source: 'import', confirmed: true, payload });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.skipped, false);
  assert.equal((await getRoom(db, saved.value.roomId))?.stage, 'stonehenge');
  assert.deepEqual((await listChunks(db, saved.value.roomId)).map((chunk) => chunk.body), parsed.bodies);
  assert.equal((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks'))?.n, 0);
  const rejected = await commit({ opId: 'import-2', kind: 'import.note', source: 'import', confirmed: false, payload });
  assert.equal(rejected.ok, false);
});
