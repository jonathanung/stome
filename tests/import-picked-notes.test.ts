import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_IMPORT_BYTES } from '../src/import/markdown.ts';
import { collectPickedNotes, documentPickerCopiesToCache, type PickedAsset, type PickedNoteDependencies } from '../src/import/picked-notes.ts';

const FINGERPRINT = 'a'.repeat(64);

function glycolysis159(): string {
  const prefix = '---\ntags: [metabolism, biology]\n---\n\n# Glycolysis\n\n';
  const text = prefix + 'x'.repeat(159 - new TextEncoder().encode(prefix).length);
  assert.equal(new TextEncoder().encode(text).length, 159);
  return text;
}

function asset(overrides: Partial<PickedAsset> = {}): PickedAsset {
  return { name: 'glycolysis.md', uri: 'content://downloads/glycolysis.md', size: 159, ...overrides };
}

function deps(overrides: Partial<PickedNoteDependencies> & Pick<PickedNoteDependencies, 'platform' | 'pick'>): PickedNoteDependencies & { reads: string[]; stats: string[] } {
  const reads: string[] = [];
  const stats: string[] = [];
  return {
    expoGo: false,
    stat: (uri) => {
      stats.push(uri);
      return { exists: true, size: 159 };
    },
    read: async (uri) => {
      reads.push(uri);
      return glycolysis159();
    },
    fingerprint: async () => FINGERPRINT,
    reads,
    stats,
    ...overrides,
  };
}

test('only Android Expo Go skips the document-picker cache copy', () => {
  assert.equal(documentPickerCopiesToCache('android', true), false);
  assert.equal(documentPickerCopiesToCache('android', false), true);
  assert.equal(documentPickerCopiesToCache('ios', true), true);
  assert.equal(documentPickerCopiesToCache('web', false), true);
});

test('a 159-byte Android note is reviewed when File.exists is false', async () => {
  const picker = deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({ canceled: false, assets: [asset({ size: 159 })] }),
    stat: () => {
      throw new Error('stat should not run when the picker reported a small size');
    },
  });
  const result = await collectPickedNotes(picker);
  assert.equal(picker.reads.length, 1);
  assert.equal(result?.errors.length, 0);
  assert.equal(result?.notes.length, 1);
  assert.equal(result?.notes[0].title, 'glycolysis');
  assert.equal(result?.notes[0].path, 'glycolysis.md');
  assert.ok(result?.notes[0].bodies.some((body) => body.includes('# Glycolysis')));
  assert.ok(result?.notes[0].subjects.includes('metabolism'));
  assert.ok(result?.notes[0].subjects.includes('biology'));
  assert.equal(result?.notes[0].fingerprint, FINGERPRINT);
});

test('Android still reads when the local size is missing or larger than the picker size', async () => {
  for (const stat of [{ exists: false, size: null }, { exists: false, size: 0 }, { exists: true, size: MAX_IMPORT_BYTES + 50 }]) {
    let reads = 0;
    const result = await collectPickedNotes(deps({
      platform: 'android',
      expoGo: true,
      pick: async () => ({ canceled: false, assets: [asset({ size: 159 })] }),
      stat: () => stat,
      read: async () => {
        reads += 1;
        return glycolysis159();
      },
    }));
    assert.equal(reads, 1);
    assert.equal(result?.notes[0].title, 'glycolysis');
    assert.deepEqual(result?.errors, []);
  }
});

test('Android reads a small note whose picker size was omitted and whose stat says missing', async () => {
  const result = await collectPickedNotes(deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({ canceled: false, assets: [asset({ size: undefined })] }),
    stat: () => ({ exists: false, size: null }),
  }));
  assert.equal(result?.notes.length, 1);
  assert.deepEqual(result?.errors, []);
});

test('Android rejects an unreadable note and a measured file over 1 MiB', async () => {
  const missing = await collectPickedNotes(deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({ canceled: false, assets: [asset({ size: undefined })] }),
    stat: () => ({ exists: false, size: null }),
    read: async () => {
      throw new Error('permission denied');
    },
  }));
  assert.deepEqual(missing?.notes, []);
  assert.deepEqual(missing?.errors, ['glycolysis.md: The file is missing or exceeds 1 MiB.']);

  let reads = 0;
  const measured = await collectPickedNotes(deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({ canceled: false, assets: [asset({ size: undefined })] }),
    stat: () => ({ exists: true, size: MAX_IMPORT_BYTES + 1 }),
    read: async () => {
      reads += 1;
      return 'x';
    },
  }));
  assert.equal(reads, 0);
  assert.deepEqual(measured?.errors, ['glycolysis.md: The file is missing or exceeds 1 MiB.']);
});

test('files over 1 MiB and non-markdown files are rejected on every platform', async () => {
  for (const platform of ['android', 'ios', 'web']) {
    let reads = 0;
    const result = await collectPickedNotes(deps({
      platform,
      pick: async () => ({
        canceled: false,
        assets: [
          asset({ name: 'big.md', size: MAX_IMPORT_BYTES + 1, file: { size: MAX_IMPORT_BYTES + 1, text: async () => 'x' } }),
          asset({ name: 'exact.md', size: MAX_IMPORT_BYTES, file: { size: MAX_IMPORT_BYTES, text: async () => 'y'.repeat(MAX_IMPORT_BYTES) } }),
          asset({ name: 'notes.txt', size: 12, file: { size: 12, text: async () => 'not markdown' } }),
          asset({ name: 'NOTES.MD', size: 159, file: { size: 159, text: async () => glycolysis159() } }),
        ],
      }),
      read: async () => {
        reads += 1;
        return glycolysis159();
      },
    }));
    assert.equal(reads, platform === 'web' ? 0 : 2);
    assert.deepEqual(result?.errors, [
      'big.md: Each note must be at most 1 MiB.',
      'notes.txt: Only UTF-8 .md files are supported.',
    ]);
    assert.deepEqual(result?.notes.map((note) => note.title), ['exact', 'NOTES']);
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

  const webSize = await collectPickedNotes(deps({
    platform: 'web',
    pick: async () => ({
      canceled: false,
      assets: [asset({ size: 10, file: { size: MAX_IMPORT_BYTES + 1, text: async () => 'x'.repeat(MAX_IMPORT_BYTES + 1) } })],
    }),
  }));
  assert.deepEqual(webSize?.errors, ['glycolysis.md: Each note must be at most 1 MiB.']);

  const webOk = await collectPickedNotes(deps({
    platform: 'web',
    pick: async () => ({
      canceled: false,
      assets: [asset({ file: { size: 159, text: async () => glycolysis159() } })],
    }),
  }));
  assert.equal(webOk?.notes[0].title, 'glycolysis');
  assert.equal(webOk?.notes[0].fingerprint, FINGERPRINT);

  let reads = 0;
  const batch = await collectPickedNotes(deps({
    platform: 'ios',
    pick: async () => ({
      canceled: false,
      assets: Array.from({ length: 21 }, (_, i) => asset({ name: `n${i}.md`, uri: `file:///tmp/${i}.md`, size: 159 })),
    }),
    read: async () => {
      reads += 1;
      return glycolysis159();
    },
  }));
  assert.equal(reads, 20);
  assert.equal(batch?.notes.length, 20);
  assert.deepEqual(batch?.errors, ['Only the first 20 files were read. Import the remaining files in another batch.']);
});

test('iOS still rejects a missing cache file and reads one inside the limit', async () => {
  const missing = await collectPickedNotes(deps({
    platform: 'ios',
    pick: async () => ({ canceled: false, assets: [asset({ uri: 'file:///cache/glycolysis.md', size: 159 })] }),
    stat: () => ({ exists: false, size: null }),
    read: async () => {
      throw new Error('read should not run');
    },
  }));
  assert.deepEqual(missing?.errors, ['glycolysis.md: The file is missing or exceeds 1 MiB.']);

  const boundary = await collectPickedNotes(deps({
    platform: 'ios',
    pick: async () => ({ canceled: false, assets: [asset({ size: MAX_IMPORT_BYTES })] }),
    stat: () => ({ exists: true, size: MAX_IMPORT_BYTES }),
    read: async () => 'y'.repeat(MAX_IMPORT_BYTES),
  }));
  assert.equal(boundary?.notes[0].title, 'glycolysis');
  assert.deepEqual(boundary?.errors, []);

  const over = await collectPickedNotes(deps({
    platform: 'ios',
    pick: async () => ({ canceled: false, assets: [asset({ size: undefined })] }),
    stat: () => ({ exists: true, size: MAX_IMPORT_BYTES + 1 }),
    read: async () => 'nope',
  }));
  assert.deepEqual(over?.errors, ['glycolysis.md: The file is missing or exceeds 1 MiB.']);
});

test('Android enforces the 1 MiB byte limit even when the picker reports 159 bytes', async () => {
  const over = await collectPickedNotes(deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({ canceled: false, assets: [asset({ size: 159 })] }),
    read: async () => 'x'.repeat(MAX_IMPORT_BYTES + 1),
  }));
  assert.deepEqual(over?.notes, []);
  assert.deepEqual(over?.errors, ['glycolysis.md: Each note must be at most 1 MiB.']);

  const exact = await collectPickedNotes(deps({
    platform: 'android',
    expoGo: true,
    pick: async () => ({ canceled: false, assets: [asset({ size: MAX_IMPORT_BYTES })] }),
    stat: () => ({ exists: false, size: null }),
    read: async () => 'y'.repeat(MAX_IMPORT_BYTES),
  }));
  assert.equal(exact?.notes.length, 1);
  assert.equal(new TextEncoder().encode(exact?.notes[0].bodies.join('') ?? '').length, MAX_IMPORT_BYTES);
  assert.deepEqual(exact?.errors, []);
});

test('Android outside Expo Go still treats a missing cache file as unavailable', async () => {
  let reads = 0;
  const result = await collectPickedNotes(deps({
    platform: 'android',
    expoGo: false,
    pick: async () => ({ canceled: false, assets: [asset({ uri: 'file:///cache/DocumentPicker/glycolysis.md', size: 159 })] }),
    stat: () => ({ exists: false, size: null }),
    read: async () => {
      reads += 1;
      return glycolysis159();
    },
  }));
  assert.equal(reads, 0);
  assert.deepEqual(result?.notes, []);
  assert.deepEqual(result?.errors, ['glycolysis.md: The file is missing or exceeds 1 MiB.']);
});

test('one rejected file does not drop a valid Android note', async () => {
  const result = await collectPickedNotes(deps({
    platform: 'android',
    pick: async () => ({
      canceled: false,
      assets: [asset({ name: 'slide.pdf', size: 40 }), asset()],
    }),
  }));
  assert.deepEqual(result?.errors, ['slide.pdf: Only UTF-8 .md files are supported.']);
  assert.deepEqual(result?.notes.map((note) => note.path), ['glycolysis.md']);
});
