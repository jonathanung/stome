import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';

import { createCommit } from '../src/data/commit.ts';
import { listChunks, listRooms } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { MAX_PDF_BYTES, normalizePdfPath, parsePdf, pdfPathSubjects, pdfSourceIdentity, PDF_WARNING } from '../src/import/pdf/parse.ts';
import { sourceIdentity } from '../src/import/markdown.ts';
import { nodeDb } from './support/node-db.ts';
import { HELVETICA, lines, PdfBuilder, simplePdf } from './support/pdf-builder.ts';

const parse = (bytes: Uint8Array, path = 'Biology/Cells.pdf') => parsePdf({ path, bytes });

/** A document whose single page uses `fontDict` as /F1 and draws `content`. */
function onePage(fontDict: string, content: string, extra: (b: PdfBuilder) => string = () => ''): Uint8Array {
  const b = new PdfBuilder();
  const font = b.add(fontDict);
  const pagesId = b.reserve();
  const extraResources = extra(b);
  const contentId = b.stream('', content);
  const page = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font} 0 R >> ${extraResources} >> >>`);
  b.set(pagesId, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  return b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)} 0 R`);
}

/* ------------------------------------------------------------------ text */

test('each page becomes a chunk headed with its page number, in page order', async () => {
  const note = await parse(simplePdf([lines('Glycolysis splits glucose.', 'It happens in the cytoplasm.'), lines('The Krebs cycle runs twice.')], { title: 'Cell respiration' }));
  assert.deepEqual(note.bodies, [
    '## Page 1\nGlycolysis splits glucose.\nIt happens in the cytoplasm.',
    '## Page 2\nThe Krebs cycle runs twice.',
  ]);
  assert.deepEqual(note.pages, [1, 2]);
  assert.equal(note.title, 'Cell respiration');
  assert.equal(note.exportFormat, 'pdf');
  assert.ok(note.warnings.includes(PDF_WARNING), 'the no-OCR / not-certified warning is always shown');
});

test('compressed content streams are read', async () => {
  const note = await parse(simplePdf([lines('Compressed text survives.')], { compress: true }));
  assert.deepEqual(note.bodies, ['## Page 1\nCompressed text survives.']);
});

test('the file name is the title when the PDF has none', async () => {
  const note = await parse(simplePdf([lines('x')]), 'Stats/Lecture 9.pdf');
  assert.equal(note.title, 'Lecture 9');
});

test('kerning gaps become spaces and line moves become line breaks', async () => {
  const content = `BT /F1 12 Tf [(Hel) -20 (lo) -300 (world)] TJ T* (next line) Tj 1 0 0 1 72 600 Tm (moved) Tj 1 0 0 1 200 600 Tm (same row) Tj ET`;
  const note = await parse(onePage(HELVETICA, content));
  assert.deepEqual(note.bodies, ['## Page 1\nHello world\nnext line\nmoved same row']);
});

test('a composite font with a ToUnicode map decodes two-byte codes', async () => {
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0001> <0048> <0002> <00E9> endbfchar
2 beginbfrange <0010> <0012> <0061> <0020> <0021> [<2192> <0020>] endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;
  const b = new PdfBuilder();
  const toUnicode = b.stream('', cmap);
  const type0 = b.add(`<< /Type /Font /Subtype /Type0 /BaseFont /Fake /Encoding /Identity-H /DescendantFonts [] /ToUnicode ${toUnicode} 0 R >>`);
  const pagesId = b.reserve();
  const content = b.stream('', 'BT /F2 12 Tf <0001 0010 0011 0012 0021 0020 0021 0002> Tj ET');
  const page = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${content} 0 R /Resources << /Font << /F2 ${type0} 0 R >> >> >>`);
  b.set(pagesId, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  const note = await parse(b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)} 0 R`));
  assert.deepEqual(note.bodies, ['## Page 1\nHabc → é']);
});

test('/Differences and MacRoman encodings map to Unicode', async () => {
  const differences = await parse(onePage(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [39 /quoteright 200 /uni00E9] >> >>',
    'BT /F1 12 Tf (It\'s caf\xc8) Tj ET',
  ));
  assert.deepEqual(differences.bodies, ['## Page 1\nIt’s café']);
  const mac = await parse(onePage('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /MacRomanEncoding >>', 'BT /F1 12 Tf (caf\x8e) Tj ET'));
  assert.deepEqual(mac.bodies, ['## Page 1\ncafé']);
});

test('text inside a form XObject is included; inline image bytes are not read as text', async () => {
  const note = await parse(onePage(HELVETICA, 'BT /F1 12 Tf (Before) Tj ET BI /W 4 /H 1 /CS /G /BPC 8 ID ab(fake) Tjcd EI /Fm1 Do BT /F1 12 Tf (After) Tj ET', (b) => {
    const font = b.add(HELVETICA);
    const form = b.stream(`/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Font << /F1 ${font} 0 R >> >>`, 'BT /F1 12 Tf (In a form) Tj ET');
    return `/XObject << /Fm1 ${form} 0 R >>`;
  }));
  assert.deepEqual(note.bodies, ['## Page 1\nBefore\nIn a form\nAfter']);
});

/* --------------------------------------------- pages without usable text */

test('an image-only page is kept as a placeholder and reported, never invented', async () => {
  const b = new PdfBuilder();
  const font = b.add(HELVETICA);
  const pagesId = b.reserve();
  const image = b.stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', '\x00');
  const text = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${b.stream('', lines('Typed page'))} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  const ink = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${b.stream('', 'q 100 0 0 100 0 0 cm /Im1 Do Q')} 0 R /Resources << /XObject << /Im1 ${image} 0 R >> >> >>`);
  b.set(pagesId, `<< /Type /Pages /Kids [${text} 0 R ${ink} 0 R] /Count 2 >>`);
  const note = await parse(b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)} 0 R`));
  assert.equal(note.bodies.length, 2);
  assert.match(note.bodies[1], /^## Page 2\nNo selectable text on this page/);
  assert.ok(note.warnings.some((w) => w.startsWith('Page 2 had no selectable text')));
});

test('a PDF with no selectable text at all is refused with a clear message', async () => {
  await assert.rejects(parse(simplePdf(['q Q', 'q Q'])), /no selectable text.*OCR is not supported/);
});

test('a composite font without a text map is left out and reported', async () => {
  const b = new PdfBuilder();
  const font = b.add(HELVETICA);
  const glyphs = b.add('<< /Type /Font /Subtype /Type0 /BaseFont /NoMap /Encoding /Identity-H /DescendantFonts [] >>');
  const pagesId = b.reserve();
  const p1 = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${b.stream('', lines('Readable'))} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  const p2 = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${b.stream('', 'BT /F9 12 Tf <00410042> Tj ET')} 0 R /Resources << /Font << /F9 ${glyphs} 0 R >> >> >>`);
  b.set(pagesId, `<< /Type /Pages /Kids [${p1} 0 R ${p2} 0 R] /Count 2 >>`);
  const note = await parse(b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)} 0 R`));
  assert.match(note.bodies[1], /No selectable text/);
  assert.ok(note.warnings.some((w) => /2 characters use a font without a text map/.test(w)));
});

test('unsupported compression is reported and that page is kept as a placeholder', async () => {
  const b = new PdfBuilder();
  const font = b.add(HELVETICA);
  const pagesId = b.reserve();
  const p1 = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${b.stream('', lines('Plain'))} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  const lzw = b.stream('/Filter /LZWDecode', '\x80\x0b\x60');
  const p2 = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${lzw} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  b.set(pagesId, `<< /Type /Pages /Kids [${p1} 0 R ${p2} 0 R] /Count 2 >>`);
  const note = await parse(b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)} 0 R`));
  assert.match(note.bodies[1], /No selectable text/);
  assert.ok(note.warnings.some((w) => /unsupported compression \(LZWDecode\)/.test(w)));
});

/* ------------------------------------------------------------ structure */

test('objects inside a compressed object stream are found', async () => {
  const b = new PdfBuilder();
  const pagesId = b.reserve();
  const content = b.stream('', lines('From an object stream'), true);
  const objects: [number, string][] = [
    [100, HELVETICA],
    [101, `<< /Type /Page /Parent ${pagesId} 0 R /Contents ${content} 0 R /Resources << /Font << /F1 100 0 R >> >> >>`],
  ];
  let body = '';
  const header: string[] = [];
  for (const [num, text] of objects) {
    header.push(`${num} ${body.length}`);
    body += `${text}\n`;
  }
  const head = `${header.join(' ')}\n`;
  b.stream(`/Type /ObjStm /N ${objects.length} /First ${head.length}`, head + body, true);
  b.set(pagesId, '<< /Type /Pages /Kids [101 0 R] /Count 1 >>');
  const note = await parse(b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)} 0 R`));
  assert.deepEqual(note.bodies, ['## Page 1\nFrom an object stream']);
});

test('nested page trees inherit resources, and a Kids cycle does not hang', async () => {
  const b = new PdfBuilder();
  const font = b.add(HELVETICA);
  const root = b.reserve();
  const inner = b.reserve();
  const p1 = b.add(`<< /Type /Page /Parent ${inner} 0 R /Contents ${b.stream('', lines('One'))} 0 R >>`);
  const p2 = b.add(`<< /Type /Page /Parent ${inner} 0 R /Contents ${b.stream('', lines('Two'))} 0 R >>`);
  b.set(inner, `<< /Type /Pages /Parent ${root} 0 R /Kids [${p1} 0 R ${p2} 0 R ${root} 0 R] /Count 2 /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  b.set(root, `<< /Type /Pages /Kids [${inner} 0 R] /Count 2 >>`);
  const note = await parse(b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${root} 0 R >>`)} 0 R`));
  assert.deepEqual(note.bodies, ['## Page 1\nOne', '## Page 2\nTwo']);
});

test('an incremental update wins over the original object, and broken xref offsets are tolerated', async () => {
  const b = new PdfBuilder();
  const font = b.add(HELVETICA);
  const pagesId = b.reserve();
  const content = b.stream('', lines('Old text'));
  const page = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  b.set(pagesId, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  const catalog = b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const updated = lines('New text');
  b.append(`${content} 0 obj\n<< /Length ${updated.length} >>\nstream\n${updated}\nendstream\nendobj\n`);
  const note = await parse(b.build(`/Root ${catalog} 0 R`, { brokenXref: true }));
  assert.deepEqual(note.bodies, ['## Page 1\nNew text']);
});

test('a long page is split into several chunks that keep its page heading', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => `Line ${i} ${'x'.repeat(60)}`);
  const note = await parse(simplePdf([lines(...many)]));
  assert.ok(note.bodies.length >= 2);
  assert.ok(note.bodies.every((body) => body.startsWith('## Page 1\n') && body.length <= 50_000));
  assert.deepEqual(new Set(note.pages), new Set([1]));
  assert.equal(note.bodies.join('\n').split('\n').filter((l) => l.startsWith('Line ')).length, 1000);
});

/* ------------------------------------------------------------- refusals */

test('encrypted, oversized, non-PDF and too-long documents are refused', async () => {
  const b = new PdfBuilder();
  const font = b.add(HELVETICA);
  const pagesId = b.reserve();
  const page = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${b.stream('', lines('secret'))} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  b.set(pagesId, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  const encrypted = b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)} 0 R /Encrypt << /Filter /Standard /V 1 >>`);
  await assert.rejects(parse(encrypted), /encrypted or password-protected/);

  const big = new Uint8Array(MAX_PDF_BYTES + 1);
  big.set(Buffer.from('%PDF-1.7\n'));
  await assert.rejects(parse(big), /at most 8 MiB/);

  await assert.rejects(parse(new TextEncoder().encode('just some text')), /not a PDF/);
  await assert.rejects(parse(simplePdf(Array.from({ length: 151 }, () => lines('p')))), /more than 150 pages/);
});

test('a decompression bomb stops at the expansion limit', async () => {
  const b = new PdfBuilder();
  const font = b.add(HELVETICA);
  const pagesId = b.reserve();
  const bomb = deflateSync(Buffer.alloc(65 * 1024 * 1024, 0x20));
  const content = b.add(Buffer.concat([Buffer.from(`<< /Filter /FlateDecode /Length ${bomb.length} >>\nstream\n`, 'latin1'), bomb, Buffer.from('\nendstream', 'latin1')]));
  const page = b.add(`<< /Type /Page /Parent ${pagesId} 0 R /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  b.set(pagesId, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  await assert.rejects(parse(b.build(`/Root ${b.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)} 0 R`)), /expands beyond the import size limit/);
});

/* ------------------------------------------------- identity and saving */

test('PDF paths, identity and folder subjects', () => {
  assert.equal(normalizePdfPath('./Biology\\Cells.PDF'), 'Biology/Cells.PDF');
  assert.throws(() => normalizePdfPath('notes.md'), /accepts \.pdf/);
  assert.throws(() => normalizePdfPath('../x.pdf'), /relative source path/);
  const pdf = pdfSourceIdentity('my notes', 'Biology/Cells.pdf');
  assert.equal(pdf, 'markdown:my%20notes/Biology/Cells.pdf');
  assert.notEqual(pdf, sourceIdentity('my notes', 'Biology/Cells.md'));
  assert.deepEqual(pdfPathSubjects([], 'Biology/Respiration/Krebs.pdf'), { subjects: 'Biology, Respiration', folderWarning: null });
  assert.match(pdfPathSubjects([], 'Krebs.pdf').folderWarning ?? '', /No course or topic folder/);
});

test('a parsed PDF saves through import.note with its page headings', async () => {
  const note = await parse(simplePdf([lines('Page one text'), 'q Q', lines('Page three text')]));
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  const commit = createCommit(db, { now: () => 1, newId: () => `id-${++id}` });
  const result = await commit({
    opId: 'pdf-1', kind: 'import.note', source: 'import', confirmed: true,
    payload: { sourceId: pdfSourceIdentity('lectures', note.path), fingerprint: 'b'.repeat(64), destination: { name: 'biology' }, bodies: note.bodies, subjects: ['Biology'] },
  });
  assert.ok(result.ok, JSON.stringify(result));
  const [room] = await listRooms(db);
  const saved = (await listChunks(db, room.id)).map((chunk) => chunk.body.split('\n')[0]);
  assert.deepEqual(saved, ['## Page 1', '## Page 2', '## Page 3']);
});
