export const DATABASE_NAME = 'stome.db';

export const SUPPORTED_VERSION = 1;

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
