export const DATABASE_NAME = 'stome.db';

export const SUPPORTED_VERSION = 2;

export const CONNECTION_PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;';

export const INSERT_NOTE_SQL =
  'INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)';

export const LIST_NOTES_SQL =
  'SELECT id, title, body, created_at, updated_at FROM notes ORDER BY created_at DESC, id DESC';

export type Migration = {
  version: number;
  sql: string;
};

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
