/** Read-only queries. Writes go through `commit.ts` only. */

import type { Db } from '../db/driver.ts';
import type { ReviewState } from '../db/schema.ts';
import type {
  Annotation,
  Chunk,
  DueChunk,
  RecentChunk,
  ReviewMark,
  Room,
  RoomStage,
  SlideOutline,
  StudyAttempt,
  StudyCard,
  StudyDeck,
  StudyQuestion,
  StudyQuiz,
} from './models.ts';

interface RoomRow {
  id: string;
  name: string;
  stage: RoomStage;
  revision: number;
  created_at: number;
  updated_at: number;
}

interface ChunkRow {
  id: string;
  room_id: string;
  position: number;
  body: string;
  source_link: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
  subjects_json: string;
}

const toRoom = (r: RoomRow): Room => ({
  id: r.id,
  name: r.name,
  stage: r.stage,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toChunk = (r: ChunkRow): Chunk => ({
  id: r.id,
  roomId: r.room_id,
  position: r.position,
  body: r.body,
  subjects: JSON.parse(r.subjects_json) as string[],
  sourceLink: r.source_link,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const CHUNK_COLUMNS = `
  c.*, c.content AS body,
  (SELECT json_group_array(subject) FROM
     (SELECT subject FROM chunk_subjects s WHERE s.chunk_id = c.id ORDER BY s.position)) AS subjects_json`;

export async function listRooms(db: Db): Promise<Room[]> {
  const rows = await db.all<RoomRow>('SELECT * FROM rooms ORDER BY name COLLATE NOCASE, created_at');
  return rows.map(toRoom);
}

export async function getRoom(db: Db, roomId: string): Promise<Room | null> {
  const row = await db.get<RoomRow>('SELECT * FROM rooms WHERE id = ?', [roomId]);
  return row ? toRoom(row) : null;
}

export async function listChunks(db: Db, roomId: string): Promise<Chunk[]> {
  const rows = await db.all<ChunkRow>(`SELECT ${CHUNK_COLUMNS} FROM chunks c WHERE c.room_id = ? ORDER BY c.position`, [roomId]);
  return rows.map(toChunk);
}

export async function getChunk(db: Db, chunkId: string): Promise<Chunk | null> {
  const row = await db.get<ChunkRow>(`SELECT ${CHUNK_COLUMNS} FROM chunks c WHERE c.id = ?`, [chunkId]);
  return row ? toChunk(row) : null;
}

/** Most recently edited chunks across all rooms (#39). */
export async function listRecentChunks(db: Db, limit = 30): Promise<RecentChunk[]> {
  const rows = await db.all<ChunkRow & { room_name: string }>(
    `SELECT ${CHUNK_COLUMNS}, r.name AS room_name
       FROM chunks c JOIN rooms r ON r.id = c.room_id
      ORDER BY c.updated_at DESC, c.id
      LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ ...toChunk(r), roomName: r.room_name }));
}

interface AnnotationRow {
  id: string;
  chunk_id: string;
  type: Annotation['type'];
  anchor: string;
  payload: string;
  created_at: number;
  updated_at: number;
}

const toAnnotation = (row: AnnotationRow): Annotation => ({
  id: row.id,
  chunkId: row.chunk_id,
  type: row.type,
  anchor: JSON.parse(row.anchor),
  payload: JSON.parse(row.payload),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listAnnotations(db: Db, chunkId: string): Promise<Annotation[]> {
  const rows = await db.all<AnnotationRow>('SELECT * FROM annotations WHERE chunk_id = ? ORDER BY created_at, id', [chunkId]);
  return rows.map(toAnnotation);
}

interface ReviewRow {
  chunk_id: string;
  state: ReviewState;
  local_day: string;
  marked_at: number;
  due_at: number;
  time_zone: string;
}

const toReview = (row: ReviewRow): ReviewMark => ({
  chunkId: row.chunk_id,
  state: row.state,
  localDay: row.local_day,
  markedAt: row.marked_at,
  dueAt: row.due_at,
  timeZone: row.time_zone,
});

/** The mark that currently sets this chunk's due time, if it has been reviewed. */
export async function latestReviewMark(db: Db, chunkId: string): Promise<ReviewMark | null> {
  const row = await db.get<ReviewRow>(
    `SELECT chunk_id, state, local_day, marked_at, due_at, time_zone
       FROM review_marks
      WHERE chunk_id = ?
      ORDER BY marked_at DESC, local_day DESC
      LIMIT 1`,
    [chunkId],
  );
  return row ? toReview(row) : null;
}

/**
 * Chunks whose latest mark is due at `now`. An older mark does not count
 * once a newer one has moved the due time.
 */
export async function listDueChunks(db: Db, now: number): Promise<DueChunk[]> {
  const rows = await db.all<ChunkRow & ReviewRow>(
    `SELECT ${CHUNK_COLUMNS},
            m.chunk_id, m.state, m.local_day, m.marked_at, m.due_at, m.time_zone
       FROM review_marks m
       JOIN chunks c ON c.id = m.chunk_id
      WHERE m.due_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM review_marks newer
           WHERE newer.chunk_id = m.chunk_id
             AND (newer.marked_at > m.marked_at
                  OR (newer.marked_at = m.marked_at AND newer.local_day > m.local_day))
        )
      ORDER BY m.due_at, c.id`,
    [now],
  );
  return rows.map((row) => ({ chunk: toChunk(row), mark: toReview(row) }));
}

/** Loads annotations for all chunks in one room without one query per chunk. */
export async function listRoomAnnotations(db: Db, roomId: string): Promise<Annotation[]> {
  const rows = await db.all<AnnotationRow>(
    `SELECT a.* FROM annotations a
       JOIN chunks c ON c.id = a.chunk_id
      WHERE c.room_id = ?
      ORDER BY c.position, a.created_at, a.id`,
    [roomId],
  );
  return rows.map(toAnnotation);
}

/* ------------------------------------------------ study materials (#130) */

function parseIdList(value: string, what: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new Error(`Stored ${what} is not a list of ids`);
  }
  return parsed;
}

interface StudyDeckRow {
  id: string;
  room_id: string;
  title: string;
  source_chunk_ids: string;
  source_revision: number;
  created_at: number;
  updated_at: number;
}

const toStudyDeck = (row: StudyDeckRow): StudyDeck => ({
  id: row.id,
  roomId: row.room_id,
  title: row.title,
  sourceChunkIds: parseIdList(row.source_chunk_ids, 'source chunk ids'),
  sourceRevision: row.source_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

interface StudyQuizRow {
  id: string;
  room_id: string;
  title: string;
  source_chunk_ids: string;
  source_revision: number;
  created_at: number;
  updated_at: number;
}

const toStudyQuiz = (row: StudyQuizRow): StudyQuiz => ({
  id: row.id,
  roomId: row.room_id,
  title: row.title,
  sourceChunkIds: parseIdList(row.source_chunk_ids, 'source chunk ids'),
  sourceRevision: row.source_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

interface StudyCardRow extends StudyDeckRow {
  deck_id: string;
  position: number;
  front: string;
  back: string;
}

const toStudyCard = (row: StudyCardRow): StudyCard => ({
  id: row.id,
  deckId: row.deck_id,
  roomId: row.room_id,
  position: row.position,
  front: row.front,
  back: row.back,
  sourceChunkIds: parseIdList(row.source_chunk_ids, 'source chunk ids'),
  sourceRevision: row.source_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

interface StudyQuestionRow extends StudyDeckRow {
  quiz_id: string;
  position: number;
  kind: StudyQuestion['kind'];
  stem: string;
  choices: string;
  answer: string;
  explanation: string;
}

const toStudyQuestion = (row: StudyQuestionRow): StudyQuestion => ({
  id: row.id,
  quizId: row.quiz_id,
  roomId: row.room_id,
  position: row.position,
  kind: row.kind,
  stem: row.stem,
  choices: JSON.parse(row.choices) as string[],
  answer: row.answer,
  explanation: row.explanation,
  sourceChunkIds: parseIdList(row.source_chunk_ids, 'source chunk ids'),
  sourceRevision: row.source_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

interface StudyAttemptRow {
  id: string;
  quiz_id: string;
  room_id: string;
  score_pct: number;
  correct: number;
  total: number;
  results: string;
  duration_ms: number;
  created_at: number;
}

const toStudyAttempt = (row: StudyAttemptRow): StudyAttempt => ({
  id: row.id,
  quizId: row.quiz_id,
  roomId: row.room_id,
  scorePct: row.score_pct,
  correct: row.correct,
  total: row.total,
  results: JSON.parse(row.results) as StudyAttempt['results'],
  durationMs: row.duration_ms,
  createdAt: row.created_at,
});

interface SlideOutlineRow extends StudyDeckRow {
  slides: string;
}

const toSlideOutline = (row: SlideOutlineRow): SlideOutline => ({
  id: row.id,
  roomId: row.room_id,
  title: row.title,
  slides: JSON.parse(row.slides) as SlideOutline['slides'],
  sourceChunkIds: parseIdList(row.source_chunk_ids, 'source chunk ids'),
  sourceRevision: row.source_revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Decks for one room, oldest first. Never leaks another room's decks. */
export async function listStudyDecks(db: Db, roomId: string): Promise<StudyDeck[]> {
  const rows = await db.all<StudyDeckRow>(
    'SELECT * FROM study_decks WHERE room_id = ? ORDER BY created_at, id',
    [roomId],
  );
  return rows.map(toStudyDeck);
}

export async function getStudyDeck(db: Db, deckId: string): Promise<StudyDeck | null> {
  const row = await db.get<StudyDeckRow>('SELECT * FROM study_decks WHERE id = ?', [deckId]);
  return row ? toStudyDeck(row) : null;
}

/** Cards of one deck in study order. */
export async function listStudyCards(db: Db, deckId: string): Promise<StudyCard[]> {
  const rows = await db.all<StudyCardRow>(
    'SELECT * FROM study_cards WHERE deck_id = ? ORDER BY position',
    [deckId],
  );
  return rows.map(toStudyCard);
}

/** Quizzes for one room, oldest first. */
export async function listStudyQuizzes(db: Db, roomId: string): Promise<StudyQuiz[]> {
  const rows = await db.all<StudyQuizRow>(
    'SELECT * FROM study_quizzes WHERE room_id = ? ORDER BY created_at, id',
    [roomId],
  );
  return rows.map(toStudyQuiz);
}

export async function getStudyQuiz(db: Db, quizId: string): Promise<StudyQuiz | null> {
  const row = await db.get<StudyQuizRow>('SELECT * FROM study_quizzes WHERE id = ?', [quizId]);
  return row ? toStudyQuiz(row) : null;
}

/** Questions of one quiz in study order. */
export async function listStudyQuestions(db: Db, quizId: string): Promise<StudyQuestion[]> {
  const rows = await db.all<StudyQuestionRow>(
    'SELECT * FROM study_questions WHERE quiz_id = ? ORDER BY position',
    [quizId],
  );
  return rows.map(toStudyQuestion);
}

/** Attempts for one quiz, oldest first. */
export async function listStudyAttempts(db: Db, quizId: string): Promise<StudyAttempt[]> {
  const rows = await db.all<StudyAttemptRow>(
    'SELECT * FROM study_attempts WHERE quiz_id = ? ORDER BY created_at, id',
    [quizId],
  );
  return rows.map(toStudyAttempt);
}

/** Slide outlines for one room, oldest first. */
export async function listSlideOutlines(db: Db, roomId: string): Promise<SlideOutline[]> {
  const rows = await db.all<SlideOutlineRow>(
    'SELECT * FROM slide_outlines WHERE room_id = ? ORDER BY created_at, id',
    [roomId],
  );
  return rows.map(toSlideOutline);
}

export async function getSlideOutline(db: Db, outlineId: string): Promise<SlideOutline | null> {
  const row = await db.get<SlideOutlineRow>('SELECT * FROM slide_outlines WHERE id = ?', [outlineId]);
  return row ? toSlideOutline(row) : null;
}
