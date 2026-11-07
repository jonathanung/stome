import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_IMPORT_BYTES } from '../src/import/markdown.ts';
import { collectPickedNotes, documentPickerCopiesToCache, type BoundedByteSource, type BrowserFile, type PickedAsset, type PickedNoteDependencies } from '../src/import/picked-notes.ts';

const FINGERPRINT = 'a'.repeat(64);
const CAP = MAX_IMPORT_BYTES + 1;

function glycolysis159(): Uint8Array {
  const prefix = '---\ntags: [metabolism, biology]\n---\n\n# Glycolysis\n\n';
  const encoded = new TextEncoder().encode(prefix);
  const bytes = new Uint8Array(159);
  bytes.set(encoded);
  bytes.fill('x'.charCodeAt(0), encoded.length);
  assert.equal(bytes.byteLength, 159);
  return bytes;
}

function asset(overrides: Partial<PickedAsset> = {}): PickedAsset {
  return { name: 'glycolysis.md', uri: 'content://downloads/glycolysis.md', size: 159, ...overrides };
}

function track(content: Uint8Array | 'huge') {
  const calls: number[] = [];
  let closed = false;
  let served = 0;
  const logical = content === 'huge' ? Number.MAX_SAFE_INTEGER : content.byteLength;
  const source: BoundedByteSource = {
    async read(maxBytes: number) {
      if (closed) throw new Error('read after close');
      calls.push(maxBytes);
      if (maxBytes > CAP) throw new Error(`unbounded read of ${maxBytes}`);
      const n = Math.min(maxBytes, logical - served);
      const out = new Uint8Array(n);
      if (content !== 'huge') out.set(content.subarray(served, served + n));
      else out.fill('x'.charCodeAt(0));
      served += n;
      return out;
    },
    close() {
      if (closed) throw new Error('closed twice');
      closed = true;
    },
  };
  return { source, calls, get closed() { return closed; } };
}

function browserFile(bytes: Uint8Array, reportedSize = bytes.byteLength): BrowserFile & { slices: number[]; textCalled: boolean } {
  const slices: number[] = [];
  const file = {
    size: reportedSize,
    slices,
    textCalled: false,
    slice(start: number, end: number) {
      slices.push(end - start);
      const view = bytes.subarray(start, Math.min(end, bytes.length));
      return { arrayBuffer: async () => Uint8Array.from(view).buffer };
    },
  };
  return file;
}

function deps(
  overrides: Partial<PickedNoteDependencies> & Pick<PickedNoteDependencies, 'platform' | 'pick'>,
  content: Uint8Array | 'huge' = glycolysis159(),
) {
  const opened = track(content);
  const stats: string[] = [];
  const opens: string[] = [];
  const base: PickedNoteDependencies = {
    expoGo: false,
    stat: (uri) => {
      stats.push(uri);
      return { exists: true, size: 159 };
    },
    open: (uri) => {
      opens.push(uri);
      return opened.source;
    },
    fingerprint: async () => FINGERPRINT,
    ...overrides,
  };
  return { ...base, ...overrides, opened, stats, opens };
}

test('only Android Expo Go skips the document-picker cache copy', () => {
  assert.equal(documentPickerCopiesToCache('android', true), false);
  assert.equal(documentPickerCopiesToCache('android', false), true);
  assert.equal(documentPickerCopiesToCache('ios', true), true);
  assert.equal(documentPickerCopiesToCache('web', false), true);
});

test('a 159-byte content URI is reviewed when File.exists is false', async () => {
  const picker = deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({ canceled: false, assets: [asset({ size: 159 })] }),
    stat: () => {
      throw new Error('stat should not decide the read length');
    },
  });
  const result = await collectPickedNotes(picker);
  assert.deepEqual(picker.opened.calls, [CAP]);
  assert.equal(picker.opened.closed, true);
  assert.equal(picker.opens.length, 1);
  assert.equal(result?.errors.length, 0);
  assert.equal(result?.notes.length, 1);
  assert.equal(result?.notes[0].title, 'glycolysis');
  assert.equal(result?.notes[0].path, 'glycolysis.md');
  assert.ok(result?.notes[0].bodies.some((body) => body.includes('# Glycolysis')));
  assert.ok(result?.notes[0].subjects.includes('metabolism'));
  assert.ok(result?.notes[0].subjects.includes('biology'));
  assert.equal(result?.notes[0].fingerprint, FINGERPRINT);
});

test('unknown or underreported Expo Go input stops after one capped read and closes', async () => {
  for (const size of [undefined, 159, 0]) {
    const picker = deps({
      platform: 'android',
      expoGo: true,
      pick: async () => ({ canceled: false, assets: [asset({ size })] }),
      stat: () => ({ exists: false, size: null }),
    }, 'huge');
    const result = await collectPickedNotes(picker);
    assert.deepEqual(picker.opened.calls, [CAP]);
    assert.equal(picker.opened.closed, true);
    assert.deepEqual(result?.notes, []);
    assert.deepEqual(result?.errors, ['glycolysis.md: Each note must be at most 1 MiB.']);
  }
});

test('an unreadable Expo Go note closes the handle and keeps the missing error', async () => {
  let closed = false;
  const result = await collectPickedNotes(deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({ canceled: false, assets: [asset({ size: undefined })] }),
    open: () => ({
      read: async () => {
        throw new Error('permission denied');
      },
      close() {
        if (closed) throw new Error('closed twice');
        closed = true;
      },
    }),
  }));
  assert.equal(closed, true);
  assert.deepEqual(result?.notes, []);
  assert.deepEqual(result?.errors, ['glycolysis.md: The file is missing or exceeds 1 MiB.']);
});

test('files over 1 MiB and non-markdown files are rejected on every platform', async () => {
  for (const platform of ['android', 'ios', 'web']) {
    const exact = new Uint8Array(MAX_IMPORT_BYTES).fill('y'.charCodeAt(0));
    const note = glycolysis159();
    const big = browserFile(new Uint8Array(0), MAX_IMPORT_BYTES + 1);
    const exactFile = browserFile(exact);
    const textFile = browserFile(new TextEncoder().encode('not markdown'));
    const mdFile = browserFile(note);
    let opens = 0;
    const result = await collectPickedNotes(deps({
      platform,
      pick: async () => ({
        canceled: false,
        assets: [
          asset({ name: 'big.md', size: MAX_IMPORT_BYTES + 1, file: big }),
          asset({ name: 'exact.md', size: MAX_IMPORT_BYTES, file: exactFile }),
          asset({ name: 'notes.txt', size: 12, file: textFile }),
          asset({ name: 'NOTES.MD', size: 159, file: mdFile }),
        ],
      }),
      open: () => {
        opens += 1;
        const body = opens === 1 ? exact : note;
        return track(body).source;
      },
    }));
    assert.equal(opens, platform === 'web' ? 0 : 2);
    assert.equal(big.slices.length, 0);
    if (platform === 'web') {
      assert.deepEqual(exactFile.slices, [CAP]);
      assert.deepEqual(mdFile.slices, [CAP]);
    }
    assert.deepEqual(result?.errors, [
      'big.md: Each note must be at most 1 MiB.',
      'notes.txt: Only UTF-8 .md files are supported.',
    ]);
    assert.deepEqual(result?.notes.map((item) => item.title), ['exact', 'NOTES']);
  }
});

test('web keeps the browser file checks, cancellation, and the 20-file batch', async () => {
  const canceled = await collectPickedNotes(deps({
    platform: 'web',
    pick: async () => ({ canceled: true, assets: null }),
  }));
  assert.equal(canceled, null);

  const missingFile = await collectPickedNotes(deps({
    platform: 'web',
    pick: async () => ({ canceled: false, assets: [asset({ file: undefined })] }),
  }));
  assert.deepEqual(missingFile?.errors, ['glycolysis.md: The browser did not provide a readable file. Try selecting it again.']);

  const honestLarge = browserFile(new Uint8Array(0), MAX_IMPORT_BYTES + 1);
  const webSize = await collectPickedNotes(deps({
    platform: 'web',
    pick: async () => ({ canceled: false, assets: [asset({ size: 10, file: honestLarge })] }),
  }));
  assert.equal(honestLarge.slices.length, 0);
  assert.deepEqual(webSize?.errors, ['glycolysis.md: Each note must be at most 1 MiB.']);

  const lying = browserFile(new Uint8Array(CAP).fill('x'.charCodeAt(0)), 159);
  const underreported = await collectPickedNotes(deps({
    platform: 'web',
    pick: async () => ({ canceled: false, assets: [asset({ size: 159, file: lying })] }),
  }));
  assert.deepEqual(lying.slices, [CAP]);
  assert.deepEqual(underreported?.notes, []);
  assert.deepEqual(underreported?.errors, ['glycolysis.md: Each note must be at most 1 MiB.']);

  const webOk = browserFile(glycolysis159());
  const accepted = await collectPickedNotes(deps({
    platform: 'web',
    pick: async () => ({ canceled: false, assets: [asset({ file: webOk })] }),
  }));
  assert.deepEqual(webOk.slices, [CAP]);
  assert.equal(accepted?.notes[0].title, 'glycolysis');
  assert.equal(accepted?.notes[0].fingerprint, FINGERPRINT);

  let opens = 0;
  const batch = await collectPickedNotes(deps({
    platform: 'ios',
    pick: async () => ({
      canceled: false,
      assets: Array.from({ length: 21 }, (_, i) => asset({ name: `n${i}.md`, uri: `file:///tmp/${i}.md`, size: 159 })),
    }),
    open: () => {
      opens += 1;
      return track(glycolysis159()).source;
    },
  }));
  assert.equal(opens, 20);
  assert.equal(batch?.notes.length, 20);
  assert.deepEqual(batch?.errors, ['Only the first 20 files were read. Import the remaining files in another batch.']);
});

test('iOS and standalone Android keep the missing-file gate and still cap a short reported size', async () => {
  for (const platform of ['ios', 'android']) {
    let opens = 0;
    const missing = await collectPickedNotes(deps({
      platform,
      expoGo: false,
      pick: async () => ({ canceled: false, assets: [asset({ uri: 'file:///cache/glycolysis.md', size: 159 })] }),
      stat: () => ({ exists: false, size: null }),
      open: () => {
        opens += 1;
        throw new Error('open should not run');
      },
    }));
    assert.equal(opens, 0);
    assert.deepEqual(missing?.errors, ['glycolysis.md: The file is missing or exceeds 1 MiB.']);

    const measured = await collectPickedNotes(deps({
      platform,
      expoGo: false,
      pick: async () => ({ canceled: false, assets: [asset({ size: undefined })] }),
      stat: () => ({ exists: true, size: MAX_IMPORT_BYTES + 1 }),
      open: () => {
        opens += 1;
        throw new Error('open should not run');
      },
    }));
    assert.equal(opens, 0);
    assert.deepEqual(measured?.errors, ['glycolysis.md: The file is missing or exceeds 1 MiB.']);

    const lying = deps({
      platform,
      expoGo: false,
      pick: async () => ({ canceled: false, assets: [asset({ size: 159 })] }),
      stat: () => ({ exists: true, size: 159 }),
    }, 'huge');
    const over = await collectPickedNotes(lying);
    assert.deepEqual(lying.opened.calls, [CAP]);
    assert.equal(lying.opened.closed, true);
    assert.deepEqual(over?.notes, []);
    assert.deepEqual(over?.errors, ['glycolysis.md: Each note must be at most 1 MiB.']);
  }

  const boundary = deps({
    platform: 'ios',
    pick: async () => ({ canceled: false, assets: [asset({ size: MAX_IMPORT_BYTES })] }),
    stat: () => ({ exists: true, size: MAX_IMPORT_BYTES }),
  }, new Uint8Array(MAX_IMPORT_BYTES).fill('y'.charCodeAt(0)));
  const accepted = await collectPickedNotes(boundary);
  assert.deepEqual(boundary.opened.calls, [CAP]);
  assert.equal(boundary.opened.closed, true);
  assert.equal(accepted?.notes[0].title, 'glycolysis');
  assert.equal(new TextEncoder().encode(accepted?.notes[0].bodies.join('') ?? '').length, MAX_IMPORT_BYTES);
  assert.deepEqual(accepted?.errors, []);
});

test('one rejected file does not drop a valid Android note', async () => {
  const result = await collectPickedNotes(deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({
      canceled: false,
      assets: [asset({ name: 'slide.pdf', size: 40 }), asset()],
    }),
  }));
  assert.deepEqual(result?.errors, ['slide.pdf: Only UTF-8 .md files are supported.']);
  assert.deepEqual(result?.notes.map((note) => note.path), ['glycolysis.md']);
});
