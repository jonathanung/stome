import assert from 'node:assert/strict';
import { test } from 'node:test';

import { documentPickerCopiesToCache, routeImportAsset, takeCappedBytes, type BoundedByteSource } from '../src/import/import-bytes.ts';
import { MAX_IMPORT_BYTES, parseMarkdown } from '../src/import/markdown.ts';
import { MAX_PDF_BYTES } from '../src/import/pdf/parse.ts';

const NOTE_CAP = MAX_IMPORT_BYTES + 1;
const PDF_CAP = MAX_PDF_BYTES + 1;

function track(kind: 'small' | 'huge', small?: Uint8Array) {
  const calls: number[] = [];
  let closed = false;
  const source: BoundedByteSource = {
    async read(maxBytes: number) {
      if (closed) throw new Error('read after close');
      calls.push(maxBytes);
      if (kind === 'small') {
        const bytes = small ?? new Uint8Array();
        return bytes.subarray(0, Math.min(maxBytes, bytes.byteLength));
      }
      if (maxBytes > PDF_CAP) throw new Error(`unbounded read of ${maxBytes}`);
      return new Uint8Array(maxBytes);
    },
    close() {
      if (closed) throw new Error('closed twice');
      closed = true;
    },
  };
  return { source, calls, get closed() { return closed; } };
}

test('only Android Expo Go skips the document-picker cache copy', () => {
  assert.equal(documentPickerCopiesToCache('android', true), false);
  assert.equal(documentPickerCopiesToCache('android', false), true);
  assert.equal(documentPickerCopiesToCache('ios', true), true);
  assert.equal(documentPickerCopiesToCache('web', false), true);
});

test('PDF keeps an 8 MiB route and other notes stay at 1 MiB', () => {
  assert.deepEqual(routeImportAsset('slides.pdf', 2 * 1024 * 1024), { kind: 'pdf', limit: MAX_PDF_BYTES });
  assert.deepEqual(routeImportAsset('slides.PDF', undefined), { kind: 'pdf', limit: MAX_PDF_BYTES });
  assert.deepEqual(routeImportAsset('slides.pdf', MAX_PDF_BYTES + 1), { kind: 'reject', message: 'Each PDF must be at most 8 MiB.' });
  assert.deepEqual(routeImportAsset('glycolysis.md', 159), { kind: 'markdown' });
  assert.deepEqual(routeImportAsset('NOTE.MD', undefined), { kind: 'markdown' });
  assert.deepEqual(routeImportAsset('big.md', MAX_IMPORT_BYTES + 1), { kind: 'reject', message: 'Each note must be at most 1 MiB.' });
  assert.deepEqual(routeImportAsset('Cells.html', 400), { kind: 'onenote-text' });
  assert.deepEqual(routeImportAsset('Cells.htm', 400), { kind: 'onenote-text' });
  assert.deepEqual(routeImportAsset('Cells.mhtml', 400), { kind: 'onenote-text' });
  assert.deepEqual(routeImportAsset('Cells.mht', 400), { kind: 'onenote-text' });
  assert.deepEqual(routeImportAsset('Cells.docx', 400), { kind: 'docx' });
  assert.deepEqual(routeImportAsset('board.png', 2 * 1024 * 1024), { kind: 'freeform', limit: 8 * 1024 * 1024 });
  assert.deepEqual(routeImportAsset('board.jpeg', undefined), { kind: 'freeform', limit: 8 * 1024 * 1024 });
  assert.deepEqual(routeImportAsset('board.jpg', 8 * 1024 * 1024 + 1), { kind: 'reject', message: 'Each image must be at most 8 MiB.' });
  const unsupported = 'Only UTF-8 Markdown, OneNote HTML, MHTML and DOCX exports, PDF files, and PNG or JPEG board images are supported.';
  assert.deepEqual(routeImportAsset('notes.txt', 13), { kind: 'reject', message: unsupported });
  assert.deepEqual(routeImportAsset('page.one', 20), { kind: 'reject', message: unsupported });
});

test('a missing or underreported size stops after one capped read and closes', async () => {
  for (const limit of [MAX_IMPORT_BYTES, MAX_PDF_BYTES]) {
    const huge = track('huge');
    await assert.rejects(
      () => takeCappedBytes(huge.source, limit, 'too big'),
      /too big/,
    );
    assert.deepEqual(huge.calls, [limit + 1]);
    assert.equal(huge.closed, true);
  }
});

test('a 159-byte source is returned and the handle closes', async () => {
  const bytes = new Uint8Array(159);
  bytes.set(new TextEncoder().encode('---\ntags: [metabolism, biology]\n---\n\n# Glycolysis\n\n'));
  bytes.fill('x'.charCodeAt(0), new TextEncoder().encode('---\ntags: [metabolism, biology]\n---\n\n# Glycolysis\n\n').length);
  const source = track('small', bytes);
  const read = await takeCappedBytes(source.source, MAX_IMPORT_BYTES, 'too big');
  assert.equal(read.byteLength, 159);
  assert.deepEqual(source.calls, [NOTE_CAP]);
  assert.equal(source.closed, true);
  const note = parseMarkdown({ path: 'glycolysis.md', text: new TextDecoder().decode(read) });
  assert.ok(note.subjects.includes('metabolism'));
  assert.ok(note.subjects.includes('biology'));
});

test('a failed read still closes the handle', async () => {
  let closed = false;
  await assert.rejects(
    () => takeCappedBytes({
      read: async () => {
        throw new Error('permission denied');
      },
      close() {
        if (closed) throw new Error('closed twice');
        closed = true;
      },
    }, MAX_IMPORT_BYTES, 'too big'),
    /permission denied/,
  );
  assert.equal(closed, true);
});
