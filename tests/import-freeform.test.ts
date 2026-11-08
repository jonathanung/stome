import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { listChunks, listRooms } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import {
  FREEFORM_IMAGE_WARNING,
  freeformPathSubjects,
  freeformSourceIdentity,
  imageInfo,
  isFreeformImagePath,
  parseFreeformImage,
} from '../src/import/freeform/parse.ts';
import { nodeDb } from './support/node-db.ts';

/** A synthetic PNG header: signature plus an IHDR chunk with the given size. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A synthetic JPEG: SOI, an APP0 segment, then a baseline SOF0 frame header. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00,
  ]);
}

test('a PNG board export becomes one reference chunk with its size and source', () => {
  const note = parseFreeformImage({ path: 'Biology/Boards/Krebs map.png', bytes: png(2048, 1536) });
  assert.equal(note.exportFormat, 'freeform-image');
  assert.equal(note.title, 'Krebs map');
  assert.deepEqual(note.image, { type: 'png', width: 2048, height: 1536 });
  assert.equal(note.bodies.length, 1);
  assert.match(note.bodies[0], /^# Krebs map/);
  assert.match(note.bodies[0], /2048 × 1536 PNG/);
  assert.match(note.bodies[0], /Source: Biology\/Boards\/Krebs map\.png/);
  assert.deepEqual(note.warnings, [FREEFORM_IMAGE_WARNING]);
});

test('JPEG sizes are read from the frame header, skipping earlier segments', () => {
  assert.deepEqual(imageInfo(jpeg(1200, 800)), { type: 'jpeg', width: 1200, height: 800 });
});

test('files that are not PNG or JPEG are refused instead of guessed', () => {
  assert.throws(() => parseFreeformImage({ path: 'board.png', bytes: new TextEncoder().encode('not an image') }), /not a PNG or JPEG/);
  assert.throws(() => parseFreeformImage({ path: '../board.png', bytes: png(10, 10) }), /relative source path/);
  assert.throws(() => parseFreeformImage({ path: 'board.gif', bytes: png(10, 10) }), /\.png, \.jpg or \.jpeg/);
});

test('only image extensions are routed to the Freeform reader', () => {
  assert.equal(isFreeformImagePath('Board.PNG'), true);
  assert.equal(isFreeformImagePath('Board.jpeg'), true);
  assert.equal(isFreeformImagePath('Board.pdf'), false);
});

test('folders in the source path suggest subjects', () => {
  assert.deepEqual(freeformPathSubjects([], 'Biology/Cells/Board.png').subjects.split(',').map((s) => s.trim()), ['Biology', 'Cells']);
  assert.ok(freeformPathSubjects([], 'Board.png').folderWarning);
});

test('a reviewed board reference commits through the import boundary and dedupes on re-import', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let n = 0;
  const commit = createCommit(db, { now: () => 1_000, newId: () => `id-${++n}` });
  const note = parseFreeformImage({ path: 'Biology/Krebs map.png', bytes: png(640, 480) });
  const operation = (opId: string) => ({
    opId, kind: 'import.note' as const, source: 'import' as const, confirmed: true,
    payload: {
      sourceId: freeformSourceIdentity('Freeform', note.path),
      fingerprint: 'cd'.repeat(32),
      bodies: note.bodies,
      subjects: ['Biology'],
      destination: { name: 'Biology' },
    },
  });
  const first = await commit(operation('op-1'));
  assert.equal(first.ok, true);
  const rooms = await listRooms(db);
  assert.equal(rooms.length, 1);
  const chunks = await listChunks(db, rooms[0].id);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].body, /640 × 480 PNG/);
  await commit(operation('op-2'));
  assert.equal((await listChunks(db, rooms[0].id)).length, 1);
});
