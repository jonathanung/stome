import { REVIEW_STATES } from './models.ts';

export const DATABASE_NAME = 'stome.db';

export const SUPPORTED_VERSION = 8;

export {
  ROOM_STAGES,
  ANNOTATION_TYPES,
  REVIEW_STATES,
  STUDY_QUESTION_KINDS,
  type RoomStage,
  type AnnotationType,
  type ReviewState,
  type StudyQuestionKind,
} from './models.ts';

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
    name: 'study materials grounded in room notes',
    sql: `
      CREATE TABLE study_decks (
        id TEXT PRIMARY KEY NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        source_chunk_ids TEXT NOT NULL CHECK (json_valid(source_chunk_ids)),
        source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS study_decks_room ON study_decks (room_id);

      CREATE TABLE study_cards (
        id TEXT PRIMARY KEY NOT NULL,
        deck_id TEXT NOT NULL REFERENCES study_decks (id) ON DELETE CASCADE,
        room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        front TEXT NOT NULL CHECK (length(front) BETWEEN 1 AND 10000),
        back TEXT NOT NULL CHECK (length(back) BETWEEN 1 AND 10000),
        source_chunk_ids TEXT NOT NULL CHECK (json_valid(source_chunk_ids)),
        source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS study_cards_deck ON study_cards (deck_id, position);
      CREATE INDEX IF NOT EXISTS study_cards_room ON study_cards (room_id);

      CREATE TABLE study_quizzes (
        id TEXT PRIMARY KEY NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        source_chunk_ids TEXT NOT NULL CHECK (json_valid(source_chunk_ids)),
        source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS study_quizzes_room ON study_quizzes (room_id);

      CREATE TABLE study_questions (
        id TEXT PRIMARY KEY NOT NULL,
        quiz_id TEXT NOT NULL REFERENCES study_quizzes (id) ON DELETE CASCADE,
        room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        kind TEXT NOT NULL CHECK (kind IN ('mcq', 'true_false', 'fill')),
        stem TEXT NOT NULL CHECK (length(stem) BETWEEN 1 AND 10000),
        choices TEXT NOT NULL CHECK (json_valid(choices)),
        answer TEXT NOT NULL CHECK (length(answer) BETWEEN 1 AND 500),
        explanation TEXT NOT NULL DEFAULT '' CHECK (length(explanation) <= 10000),
        source_chunk_ids TEXT NOT NULL CHECK (json_valid(source_chunk_ids)),
        source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS study_questions_quiz ON study_questions (quiz_id, position);
      CREATE INDEX IF NOT EXISTS study_questions_room ON study_questions (room_id);

      CREATE TABLE study_attempts (
        id TEXT PRIMARY KEY NOT NULL,
        quiz_id TEXT NOT NULL REFERENCES study_quizzes (id) ON DELETE CASCADE,
        room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
        score_pct REAL NOT NULL CHECK (score_pct BETWEEN 0 AND 100),
        correct INTEGER NOT NULL CHECK (correct >= 0),
        total INTEGER NOT NULL CHECK (total >= 1),
        results TEXT NOT NULL CHECK (json_valid(results)),
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        created_at INTEGER NOT NULL,
        CHECK (correct <= total)
      );
      CREATE INDEX IF NOT EXISTS study_attempts_quiz ON study_attempts (quiz_id, created_at);
      CREATE INDEX IF NOT EXISTS study_attempts_room ON study_attempts (room_id);

      CREATE TABLE slide_outlines (
        id TEXT PRIMARY KEY NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        slides TEXT NOT NULL CHECK (json_valid(slides)),
        source_chunk_ids TEXT NOT NULL CHECK (json_valid(source_chunk_ids)),
        source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS slide_outlines_room ON slide_outlines (room_id);
    `,
  },
  {
    version: 7,
    name: 'pinned answer review marks (REV.3 #127, annotation-keyed)',
    sql: `
      CREATE TABLE answer_marks (
        annotation_id TEXT NOT NULL REFERENCES annotations (id) ON DELETE CASCADE,
        local_day TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        state TEXT NOT NULL CHECK (state IN (${REVIEW_STATES.map((state) => `'${state}'`).join(', ')})),
        marked_at INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
        PRIMARY KEY (annotation_id, local_day)
      );
    `,
  },
  {
    version: 8,
    name: 'review marks and whiteboards both exist',
    // #79 published user_version 5 as review_marks. #123 replaced that same
    // version with whiteboards, and #145 reverted the merge. A database that
    // already applied the replaced SQL stays at 5 (or 6, once study ran) and
    // will not run version 5 again. Versions 6 and 7 are the study and answer
    // mark migrations shipped on main and are not renumbered. This step creates
    // whichever of the two tables is missing and does not rewrite rows.
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
