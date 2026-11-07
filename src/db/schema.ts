/**
 * Local schema (issue #35, FND.1). Migrations are append-only: never edit a
 * shipped migration, add a new one with the next version.
 */

export const DATABASE_NAME = 'stome.db';

export const CONNECTION_PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;';

export const ROOM_STAGES = ['stonehenge', 'brick'] as const;
export type RoomStage = (typeof ROOM_STAGES)[number];

export const ANNOTATION_TYPES = ['highlight', 'ai_answer', 'stroke'] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

/** A v4-shaped UUID built in SQL, for rows a migration creates itself. */
const SQL_UUID = `lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
)`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'scaffold notes',
    sql: `
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'rooms, chunks, annotations, applied ops',
    sql: `
      CREATE TABLE rooms (
        id         TEXT PRIMARY KEY NOT NULL,
        name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
        stage      TEXT NOT NULL DEFAULT 'stonehenge' CHECK (stage IN ('stonehenge', 'brick')),
        revision   INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE chunks (
        id          TEXT PRIMARY KEY NOT NULL,
        room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        body        TEXT NOT NULL,
        source_link TEXT,
        revision    INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX chunks_room_position ON chunks (room_id, position);
      CREATE INDEX chunks_updated ON chunks (updated_at DESC);

      CREATE TABLE chunk_subjects (
        chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
        subject  TEXT NOT NULL CHECK (length(trim(subject)) > 0),
        position INTEGER NOT NULL,
        PRIMARY KEY (chunk_id, subject)
      );
      CREATE INDEX chunk_subjects_subject ON chunk_subjects (subject);

      CREATE TABLE annotations (
        id         TEXT PRIMARY KEY NOT NULL,
        chunk_id   TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
        type       TEXT NOT NULL CHECK (type IN ('highlight', 'ai_answer', 'stroke')),
        anchor     TEXT NOT NULL CHECK (json_valid(anchor)),
        payload    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX annotations_chunk ON annotations (chunk_id);

      -- One row per committed operation, so a repeated op ID changes nothing (FND.2).
      CREATE TABLE applied_ops (
        op_id        TEXT PRIMARY KEY NOT NULL,
        kind         TEXT NOT NULL,
        source       TEXT NOT NULL,
        result       TEXT NOT NULL CHECK (json_valid(result)),
        committed_at INTEGER NOT NULL
      );

      -- Keep anything typed into the scaffold's notes screen: each note becomes
      -- one chunk in a room called "notes", then the old table goes away.
      CREATE TEMP TABLE legacy_room AS SELECT ${SQL_UUID} AS id;
      INSERT INTO rooms (id, name, created_at, updated_at)
        SELECT legacy_room.id, 'notes', MIN(notes.created_at), MAX(notes.updated_at)
        FROM legacy_room, notes
        GROUP BY legacy_room.id
        HAVING COUNT(notes.id) > 0;
      INSERT INTO chunks (id, room_id, position, body, created_at, updated_at)
        SELECT ${SQL_UUID}, legacy_room.id,
               ROW_NUMBER() OVER (ORDER BY notes.created_at, notes.id) - 1,
               CASE WHEN notes.body = '' THEN notes.title ELSE notes.title || char(10) || notes.body END,
               notes.created_at, notes.updated_at
        FROM notes, legacy_room;
      DROP TABLE legacy_room;
      DROP TABLE notes;
    `,
  },
];

export const SUPPORTED_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function migrationsFor(currentVersion: number): readonly Migration[] {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error('Could not read the database schema version');
  }
  if (currentVersion > SUPPORTED_VERSION) {
    throw new Error('Database schema is newer than this app supports');
  }
  return MIGRATIONS.filter((migration) => currentVersion < migration.version);
}
