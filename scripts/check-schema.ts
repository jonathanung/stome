import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ANNOTATION_TYPES,
  ROOM_STAGES,
  toAnnotation,
  toChunk,
  toRoom,
  type AnnotationRow,
  type ChunkRow,
  type RoomRow,
} from '../src/db/models.ts';
import {
  CONNECTION_PRAGMAS,
  INSERT_NOTE_SQL,
  LIST_NOTES_SQL,
  MIGRATIONS,
  SUPPORTED_VERSION,
  migrationsFor,
} from '../src/db/schema.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectFailure(run: () => void, message: string): void {
  let failed = false;
  try {
    run();
  } catch {
    failed = true;
  }
  assert(failed, message);
}

function countRows(db: DatabaseSync, table: 'rooms' | 'chunks' | 'annotations'): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
    | { count: number }
    | undefined;
  if (!row || typeof row.count !== 'number') {
    throw new Error(`Could not count rows in ${table}`);
  }
  return row.count;
}

function readVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  if (!row || typeof row.user_version !== 'number') {
    throw new Error('Could not read the database schema version');
  }
  return row.user_version;
}

function applySchema(db: DatabaseSync): void {
  db.exec(CONNECTION_PRAGMAS);
  const pending = migrationsFor(readVersion(db));
  if (pending.length === 0) {
    return;
  }
  db.exec('BEGIN');
  try {
    for (const migration of pending) {
      db.exec(migration.sql);
    }
    db.exec(`PRAGMA user_version = ${SUPPORTED_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const CHUNK_ID = '22222222-2222-4222-8222-222222222222';
const ANNOTATION_ID = '33333333-3333-4333-8333-333333333333';

function insertRoom(db: DatabaseSync): void {
  db.prepare(
    'INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(ROOM_ID, 'Stonehenge', 'stonehenge', 10, 10);
}

function insertChunk(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO chunks (id, room_id, position, content, subject_tags, source_link, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(CHUNK_ID, ROOM_ID, 0, 'First chunk', '["biology"]', 'https://example.test/source', 10, 10);
}

function insertAnnotation(db: DatabaseSync, chunkId: string | null, type: string): void {
  db.prepare(
    'INSERT INTO annotations (id, chunk_id, type, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(ANNOTATION_ID, chunkId, type, '{"text":"note"}', 10, 10);
}

const directory = mkdtempSync(join(tmpdir(), 'stome-schema-'));
const databasePath = join(directory, 'stome.db');

try {
  assert(
    migrationsFor(0).length === MIGRATIONS.length,
    'a new database should receive every migration',
  );
  assert(migrationsFor(SUPPORTED_VERSION).length === 0, 'the current schema should not migrate again');
  let rejectedNewer = false;
  try {
    migrationsFor(SUPPORTED_VERSION + 1);
  } catch (error) {
    rejectedNewer = error instanceof Error && error.message.includes('newer');
  }
  assert(rejectedNewer, 'a newer schema version should be rejected');

  const created = new DatabaseSync(databasePath);
  applySchema(created);
  const empty = created.prepare(LIST_NOTES_SQL).all();
  assert(empty.length === 0, 'a fresh database should list no notes');

  const trickyTitle = `Ada's note'); DROP TABLE notes; --`;
  const trickyBody = 'quotes "stay"';
  created.prepare(INSERT_NOTE_SQL).run(trickyTitle, trickyBody, 10, 10);
  created.close();

  const reopened = new DatabaseSync(databasePath);
  applySchema(reopened);
  const notes = reopened.prepare(LIST_NOTES_SQL).all() as {
    title: string;
    body: string;
  }[];
  assert(notes.length === 1, 'the saved note should persist across reopen');
  assert(notes[0]?.title === trickyTitle, 'bound title text should persist unchanged');
  assert(notes[0]?.body === trickyBody, 'bound body text should persist unchanged');
  assert(
    readVersion(reopened) === SUPPORTED_VERSION,
    `schema version should be ${SUPPORTED_VERSION} after migrating`,
  );
  assert(
    migrationsFor(readVersion(reopened)).length === 0,
    'migrating an up-to-date database again should do nothing',
  );
  const tables = reopened
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'")
    .all();
  assert(tables.length === 1, 'reopening should keep the notes table');
  reopened.close();

  const rollback = new DatabaseSync(':memory:');
  rollback.exec('BEGIN');
  let failed = false;
  try {
    rollback.exec(MIGRATIONS[0]?.sql ?? '');
    rollback.exec('THIS IS NOT SQL');
    rollback.exec('COMMIT');
  } catch {
    failed = true;
    rollback.exec('ROLLBACK');
  }
  const leftover = rollback
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'")
    .all();
  rollback.close();
  assert(failed, 'an invalid statement should fail the migration transaction');
  assert(leftover.length === 0, 'a failed migration should roll back the notes table');

  const upgraded = new DatabaseSync(':memory:');
  upgraded.exec(CONNECTION_PRAGMAS);
  upgraded.exec(MIGRATIONS[0]?.sql ?? '');
  upgraded.exec('PRAGMA user_version = 1');
  upgraded.prepare(INSERT_NOTE_SQL).run('saved before upgrade', 'body', 5, 5);
  applySchema(upgraded);
  assert(
    readVersion(upgraded) === SUPPORTED_VERSION,
    'upgrading version 1 should reach the supported version',
  );
  assert(
    (upgraded.prepare(LIST_NOTES_SQL).all() as { title: string }[])[0]?.title ===
      'saved before upgrade',
    'upgrading should keep the notes written before the migration',
  );
  assert(
    upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rooms'")
      .all().length === 1,
    'upgrading version 1 should create the rooms table',
  );
  upgraded.close();

  const relations = new DatabaseSync(':memory:');
  applySchema(relations);
  const foreignKeys = relations.prepare('PRAGMA foreign_keys').get() as
    | { foreign_keys: number }
    | undefined;
  assert(foreignKeys?.foreign_keys === 1, 'foreign key enforcement should be on');
  assert(
    readVersion(relations) === SUPPORTED_VERSION,
    `a fresh database should migrate to version ${SUPPORTED_VERSION}`,
  );
  applySchema(relations);
  assert(
    readVersion(relations) === SUPPORTED_VERSION,
    're-running migrations should not bump the version',
  );

  insertRoom(relations);
  insertChunk(relations);
  insertAnnotation(relations, CHUNK_ID, 'highlight');

  const room = toRoom(
    relations.prepare('SELECT * FROM rooms WHERE id = ?').get(ROOM_ID) as RoomRow,
  );
  const chunk = toChunk(
    relations.prepare('SELECT * FROM chunks WHERE id = ?').get(CHUNK_ID) as ChunkRow,
  );
  const annotation = toAnnotation(
    relations.prepare('SELECT * FROM annotations WHERE id = ?').get(ANNOTATION_ID) as AnnotationRow,
  );
  assert(room.stage === 'stonehenge', 'the room stage should map to its camelCase type');
  assert(chunk.roomId === ROOM_ID, 'the chunk room id should map to camelCase');
  assert(
    chunk.subjectTags.length === 1 && chunk.subjectTags[0] === 'biology',
    'subject tags should round-trip through the typed row model',
  );
  assert(
    chunk.sourceLink === 'https://example.test/source',
    'the optional source link should round-trip',
  );
  assert(annotation.chunkId === CHUNK_ID, 'the annotation chunk id should map to camelCase');
  assert(annotation.type === 'highlight', 'the annotation type should map to its camelCase type');
  assert(
    annotation.payload.text === 'note',
    'the annotation payload should round-trip as an object',
  );

  relations.prepare('DELETE FROM rooms WHERE id = ?').run(ROOM_ID);
  assert(countRows(relations, 'rooms') === 0, 'deleting a room should remove the room');
  assert(countRows(relations, 'chunks') === 0, 'deleting a room should cascade to its chunks');
  assert(
    countRows(relations, 'annotations') === 0,
    'deleting a room should cascade to the annotations of its chunks',
  );
  relations.close();

  const guards = new DatabaseSync(':memory:');
  applySchema(guards);
  insertRoom(guards);
  insertChunk(guards);

  expectFailure(
    () => insertAnnotation(guards, CHUNK_ID, 'not_a_type'),
    'an annotation with an invalid type should be rejected',
  );
  expectFailure(
    () => insertAnnotation(guards, null, 'highlight'),
    'an annotation without a chunk id should be rejected',
  );
  expectFailure(
    () => insertAnnotation(guards, '99999999-9999-4999-8999-999999999999', 'highlight'),
    'an annotation pointing at a missing chunk should be rejected',
  );
  expectFailure(
    () =>
      guards
        .prepare('INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('44444444-4444-4444-8444-444444444444', 'Unknown', 'limestone', 10, 10),
    'a room with an invalid stage should be rejected',
  );
  assert(countRows(guards, 'annotations') === 0, 'rejected annotations should not be stored');
  guards.close();

  assert(
    ROOM_STAGES.length === 2 && ANNOTATION_TYPES.length === 3,
    'the schema should support exactly two room stages and three annotation types',
  );

  console.log('schema checks passed (node:sqlite, not the Expo native driver)');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
