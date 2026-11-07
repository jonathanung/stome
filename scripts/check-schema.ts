import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

const directory = mkdtempSync(join(tmpdir(), 'stome-schema-'));
const databasePath = join(directory, 'stome.db');

try {
  assert(migrationsFor(0).length === 1, 'a new database should receive the notes migration');
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
  assert(readVersion(reopened) === SUPPORTED_VERSION, 'schema version should stay at 1');
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

  console.log('schema checks passed (node:sqlite, not the Expo native driver)');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
