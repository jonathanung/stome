import { REVIEW_STATES } from './models.ts';

export const DATABASE_NAME = 'stome.db';

export const SUPPORTED_VERSION = 6;

export { ROOM_STAGES, ANNOTATION_TYPES, REVIEW_STATES, type RoomStage, type AnnotationType, type ReviewState } from './models.ts';

export const CONNECTION_PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;';

export const INSERT_NOTE_SQL =
  'INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)';

export const LIST_NOTES_SQL =
  'SELECT id, title, body, created_at, updated_at FROM notes ORDER BY created_at DESC, id DESC';

export const GET_NOTE_SQL =
  'SELECT id, title, body, created_at, updated_at FROM notes WHERE id = ?';

export type Migration = {
  version: number;
  name?: string;
  sql: string;
};

const SQL_UUID = `lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
)`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
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
    sql: `
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        stage TEXT NOT NULL CHECK (stage IN ('stonehenge', 'brick')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE chunks (
        id TEXT PRIMARY KEY NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        content TEXT NOT NULL,
        subject_tags TEXT NOT NULL DEFAULT '[]',
        source_link TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX chunks_room_position_idx ON chunks (room_id, position);

      CREATE TABLE annotations (
        id TEXT PRIMARY KEY NOT NULL,
        chunk_id TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('highlight', 'ai_answer', 'stroke')),
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX annotations_chunk_idx ON annotations (chunk_id);
    `,
  },
  {
    version: 3,
    name: 'revisioned commit boundary and normalized subjects',
    sql: `
      ALTER TABLE rooms ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE chunks ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE annotations ADD COLUMN anchor TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(anchor));
      CREATE INDEX chunks_updated ON chunks (updated_at DESC);
      CREATE TABLE chunk_subjects (
        chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
        subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
        position INTEGER NOT NULL,
        PRIMARY KEY (chunk_id, subject)
      );
      CREATE INDEX chunk_subjects_subject ON chunk_subjects(subject);
      INSERT OR IGNORE INTO chunk_subjects (chunk_id, subject, position)
        SELECT c.id, j.value, CAST(j.key AS INTEGER) FROM chunks c,
        json_each(CASE WHEN json_valid(c.subject_tags) THEN
          CASE WHEN json_type(c.subject_tags) = 'array' THEN c.subject_tags ELSE '[]' END
          ELSE '[]' END) j
        WHERE j.type = 'text' AND length(trim(j.value)) > 0;
      CREATE TABLE applied_ops (
        op_id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        result TEXT NOT NULL CHECK (json_valid(result)),
        committed_at INTEGER NOT NULL
      );
      -- Snapshot scaffold notes for the room workspace, retaining the originals
      -- for the independently shipped notes/harness UI.
      CREATE TEMP TABLE legacy_room AS SELECT ${SQL_UUID} AS id;
      INSERT INTO rooms (id, name, stage, created_at, updated_at)
        SELECT legacy_room.id, 'notes', 'stonehenge', MIN(notes.created_at), MAX(notes.updated_at)
        FROM legacy_room, notes GROUP BY legacy_room.id HAVING COUNT(notes.id) > 0;
      INSERT INTO chunks (id, room_id, position, content, created_at, updated_at)
        SELECT ${SQL_UUID}, legacy_room.id,
          ROW_NUMBER() OVER (ORDER BY notes.created_at, notes.id) - 1,
          CASE WHEN notes.body = '' THEN notes.title ELSE notes.title || char(10) || notes.body END,
          notes.created_at, notes.updated_at FROM notes, legacy_room;
      DROP TABLE legacy_room;
    `,
  },
  {
    version: 4,
    name: 'import source provenance',
    sql: `
      CREATE TABLE import_sources (
        source_id   TEXT PRIMARY KEY NOT NULL,
        fingerprint TEXT NOT NULL,
        room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        chunk_ids   TEXT NOT NULL CHECK (json_valid(chunk_ids)),
        imported_at INTEGER NOT NULL
      );
      CREATE INDEX import_sources_room ON import_sources (room_id);
    `,
  },
  {
    version: 5,
    name: 'human review marks',
    sql: `
      CREATE TABLE review_marks (
        chunk_id TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
        local_day TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        state TEXT NOT NULL CHECK (state IN (${REVIEW_STATES.map((state) => `'${state}'`).join(', ')})),
        marked_at INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
        PRIMARY KEY (chunk_id, local_day)
      );
    `,
  },
  {
    version: 6,
    name: 'review marks and room whiteboards compatibility',
    sql: `
      CREATE TABLE IF NOT EXISTS review_marks (
        chunk_id TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
        local_day TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        state TEXT NOT NULL CHECK (state IN (${REVIEW_STATES.map((state) => `'${state}'`).join(', ')})),
        marked_at INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
        PRIMARY KEY (chunk_id, local_day)
      );
      CREATE TABLE IF NOT EXISTS whiteboards (
        room_id TEXT PRIMARY KEY NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 1,
        items TEXT NOT NULL CHECK (json_valid(items)),
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

export function migrationsFor(currentVersion: number): readonly Migration[] {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error('Could not read the database schema version');
  }
  if (currentVersion > SUPPORTED_VERSION) {
    throw new Error('Database schema is newer than this app supports');
  }
  return MIGRATIONS.filter((migration) => currentVersion < migration.version);
}
