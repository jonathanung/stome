/** Read-only queries. Writes go through `commit.ts` only. */

import type { Db } from '../db/driver.ts';
import type { ReviewState } from '../db/schema.ts';
import { isStudyStale } from '../features/study/scheduling.ts';
import type {
  Annotation,
  AnswerMark,
  Chunk,
  DueAnswer,
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

export async function getAnnotation(db: Db, annotationId: string): Promise<Annotation | null> {
  const row = await db.get<AnnotationRow>('SELECT * FROM annotations WHERE id = ?', [annotationId]);
  return row ? toAnnotation(row) : null;
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

interface AnswerMarkRow {
  annotation_id: string;
  chunk_id: string;
  state: ReviewState;
  local_day: string;
  marked_at: number;
  due_at: number;
  time_zone: string;
}

const toAnswerMark = (row: AnswerMarkRow): AnswerMark => ({
  annotationId: row.annotation_id,
  chunkId: row.chunk_id,
  state: row.state,
  localDay: row.local_day,
  markedAt: row.marked_at,
  dueAt: row.due_at,
  timeZone: row.time_zone,
});

/** The answer mark that currently sets this pin's due time, if it has been marked. */
export async function latestAnswerMark(db: Db, annotationId: string): Promise<AnswerMark | null> {
  const row = await db.get<AnswerMarkRow>(
    `SELECT m.annotation_id, a.chunk_id AS chunk_id, m.state, m.local_day, m.marked_at, m.due_at, m.time_zone
       FROM answer_marks m
       JOIN annotations a ON a.id = m.annotation_id
      WHERE m.annotation_id = ?
      ORDER BY m.marked_at DESC, m.local_day DESC
      LIMIT 1`,
    [annotationId],
  );
  return row ? toAnswerMark(row) : null;
}

type DueAnswerRow = ChunkRow & {
  annotation_id: string;
  annotation_chunk_id: string;
  annotation_type: Annotation['type'];
  annotation_anchor: string;
  annotation_payload: string;
  annotation_created: number;
  annotation_updated: number;
  mark_state: ReviewState | null;
  mark_day: string | null;
  mark_marked: number | null;
  mark_due: number | null;
  mark_zone: string | null;
};

const ANSWER_COLUMNS = `
  a.id AS annotation_id, a.chunk_id AS annotation_chunk_id, a.type AS annotation_type,
  a.anchor AS annotation_anchor, a.payload AS annotation_payload,
  a.created_at AS annotation_created, a.updated_at AS annotation_updated`;

function toDueAnswer(row: DueAnswerRow): DueAnswer {
  const mark =
    row.mark_state === null || row.mark_day === null || row.mark_marked === null || row.mark_due === null || row.mark_zone === null
      ? null
      : {
          annotationId: row.annotation_id,
          chunkId: row.annotation_chunk_id,
          state: row.mark_state,
          localDay: row.mark_day,
          markedAt: row.mark_marked,
          dueAt: row.mark_due,
          timeZone: row.mark_zone,
        };
  return {
    chunk: toChunk(row),
    annotation: {
      id: row.annotation_id,
      chunkId: row.annotation_chunk_id,
      type: row.annotation_type,
      anchor: JSON.parse(row.annotation_anchor),
      payload: JSON.parse(row.annotation_payload),
      createdAt: row.annotation_created,
      updatedAt: row.annotation_updated,
    },
    mark,
  };
}

/**
 * Pinned `ai_answer` annotations that are due at `now` (#127). An answer with
 * no mark is due as soon as it is pinned; a marked answer is due when its
 * latest answer mark is due. Staleness is not filtered here — marking rejects
 * a stale anchor or passage with a message and writes nothing.
 */
export async function listDueAnswers(db: Db, now: number): Promise<DueAnswer[]> {
  return dueAnswers(db, now);
}

/** Due pinned answers in one room, for the review session. */
export async function listRoomDueAnswers(db: Db, roomId: string, now: number): Promise<DueAnswer[]> {
  return dueAnswers(db, now, roomId);
}

async function dueAnswers(db: Db, now: number, roomId?: string): Promise<DueAnswer[]> {
  const roomFilter = roomId === undefined ? '' : 'AND c.room_id = ?';
  const roomParams = roomId === undefined ? [] : [roomId];
  const marked = await db.all<DueAnswerRow>(
    `SELECT ${CHUNK_COLUMNS}, ${ANSWER_COLUMNS},
            m.state AS mark_state, m.local_day AS mark_day, m.marked_at AS mark_marked,
            m.due_at AS mark_due, m.time_zone AS mark_zone
       FROM answer_marks m
       JOIN annotations a ON a.id = m.annotation_id
       JOIN chunks c ON c.id = a.chunk_id
      WHERE a.type = 'ai_answer'
        AND m.due_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM answer_marks newer
           WHERE newer.annotation_id = m.annotation_id
             AND (newer.marked_at > m.marked_at
                  OR (newer.marked_at = m.marked_at AND newer.local_day > m.local_day))
        )
        ${roomFilter}
      ORDER BY m.due_at, a.id`,
    [now, ...roomParams],
  );
  const fresh = await db.all<DueAnswerRow>(
    `SELECT ${CHUNK_COLUMNS}, ${ANSWER_COLUMNS},
            NULL AS mark_state, NULL AS mark_day, NULL AS mark_marked,
            NULL AS mark_due, NULL AS mark_zone
       FROM annotations a
       JOIN chunks c ON c.id = a.chunk_id
      WHERE a.type = 'ai_answer'
        AND NOT EXISTS (
          SELECT 1 FROM answer_marks m WHERE m.annotation_id = a.id
        )
        ${roomFilter}
      ORDER BY a.created_at, a.id`,
    [...roomParams],
  );
  return [...fresh.map(toDueAnswer), ...marked.map(toDueAnswer)];
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

/* ------------------------------------------------ study scheduling (#136) */

export interface DueStudyCard {
  card: StudyCard;
  /**
   * The source mark that makes this card due, or null when the card is due
   * because a source was never rated. Stale cards never appear here.
   */
  mark: ReviewMark | null;
}

export interface DueStudyQuestion {
  question: StudyQuestion;
  /**
   * The source mark that makes this question due, or null when the question
   * is due because a source was never rated. Stale questions never appear here.
   */
  mark: ReviewMark | null;
}

export interface StaleStudyAttempt {
  attempt: StudyAttempt;
  /** True when the quiz's sources have drifted since generation. */
  stale: boolean;
}

/** One saved quiz run by id. */
export async function getStudyAttempt(db: Db, attemptId: string): Promise<StudyAttempt | null> {
  const row = await db.get<StudyAttemptRow>('SELECT * FROM study_attempts WHERE id = ?', [attemptId]);
  return row ? toStudyAttempt(row) : null;
}

/**
 * Read-time staleness for one generated row: true when any grounding chunk
 * is gone (deleted) or its revision no longer equals the snapshot taken at
 * generation. The row itself is untouched, so the original quote is
 * preserved; callers exclude stale rows from due lists and flag (never
 * delete or recompute) history built on them.
 */
export async function isStudySourcesStale(
  db: Db,
  sourceChunkIds: string[],
  sourceRevision: number,
): Promise<boolean> {
  if (sourceChunkIds.length === 0) return true;
  const placeholders = sourceChunkIds.map(() => '?').join(', ');
  const rows = await db.all<{ id: string; revision: number }>(
    `SELECT id, revision FROM chunks WHERE id IN (${placeholders})`,
    sourceChunkIds,
  );
  const revisionByChunk = new Map(rows.map((row) => [row.id, row.revision]));
  for (const id of sourceChunkIds) {
    if (revisionByChunk.get(id) !== sourceRevision) return true;
  }
  return false;
}

async function latestMarksByChunk(db: Db, chunkIds: string[]): Promise<Map<string, ReviewMark>> {
  const byChunk = new Map<string, ReviewMark>();
  if (chunkIds.length === 0) return byChunk;
  const placeholders = chunkIds.map(() => '?').join(', ');
  const rows = await db.all<ReviewRow>(
    `SELECT chunk_id, state, local_day, marked_at, due_at, time_zone
       FROM review_marks m
      WHERE m.chunk_id IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM review_marks newer
           WHERE newer.chunk_id = m.chunk_id
             AND (newer.marked_at > m.marked_at
                  OR (newer.marked_at = m.marked_at AND newer.local_day > m.local_day))
        )`,
    chunkIds,
  );
  for (const row of rows) {
    byChunk.set(row.chunk_id, toReview(row));
  }
  return byChunk;
}

interface DueStudyItem {
  sourceChunkIds: string[];
  sourceRevision: number;
  position: number;
  id: string;
}

/**
 * Shared due rule for cards and questions. A rating is saved as a
 * `review.mark` on the rated item's source chunk(s) with the REV.1 interval,
 * so an item is due when it is fresh and any source is unrated or its latest
 * mark is due. Stale items are excluded (never verified); sources whose
 * latest mark is still in the future do not trigger due, and superseded
 * (older) marks are ignored via the latest-mark anti-join.
 */
async function dueStudyItems<T extends DueStudyItem>(
  db: Db,
  items: T[],
  now: number,
): Promise<{ item: T; mark: ReviewMark | null }[]> {
  const chunkIds = [...new Set(items.flatMap((item) => item.sourceChunkIds))];
  const placeholders = chunkIds.map(() => '?').join(', ');
  const revisions = new Map<string, number>();
  if (chunkIds.length > 0) {
    const rows = await db.all<{ id: string; revision: number }>(
      `SELECT id, revision FROM chunks WHERE id IN (${placeholders})`,
      chunkIds,
    );
    for (const row of rows) revisions.set(row.id, row.revision);
  }
  const marks = await latestMarksByChunk(db, chunkIds);
  const fresh: { item: T; mark: ReviewMark | null }[] = [];
  const scheduled: { item: T; mark: ReviewMark; dueAt: number }[] = [];
  for (const item of items) {
    if (isStudyStale(item.sourceRevision, item.sourceChunkIds, revisions)) continue;
    const dueMarks = item.sourceChunkIds.flatMap((id) => {
      const mark = marks.get(id);
      return mark && mark.dueAt <= now ? [mark] : [];
    });
    const hasUnratedSource = item.sourceChunkIds.some((id) => !marks.has(id));
    if (dueMarks.length === 0 && !hasUnratedSource) continue;
    dueMarks.sort((a, b) => a.dueAt - b.dueAt);
    const mark = dueMarks[0] ?? null;
    if (mark === null) fresh.push({ item, mark });
    else scheduled.push({ item, mark, dueAt: mark.dueAt });
  }
  scheduled.sort((a, b) => a.dueAt - b.dueAt || a.item.position - b.item.position || (a.item.id < b.item.id ? -1 : 1));
  return [...fresh, ...scheduled.map(({ item, mark }) => ({ item, mark }))];
}

/**
 * Cards of one deck that are due at `now`: unrated-or-due sources, fresh
 * first, then earliest due. Stale cards and cards whose sources are all
 * still in the future are excluded.
 */
export async function listDueStudyCards(db: Db, deckId: string, now: number): Promise<DueStudyCard[]> {
  const cards = await listStudyCards(db, deckId);
  return (await dueStudyItems(db, cards, now)).map(({ item, mark }) => ({ card: item, mark }));
}

/**
 * Questions of one quiz that are due at `now`: unrated-or-due sources,
 * fresh first, then earliest due. Stale questions and questions whose
 * sources are all still in the future are excluded.
 */
export async function listDueStudyQuestions(db: Db, quizId: string, now: number): Promise<DueStudyQuestion[]> {
  const questions = await listStudyQuestions(db, quizId);
  return (await dueStudyItems(db, questions, now)).map(({ item, mark }) => ({ question: item, mark }));
}

/**
 * Attempts for one quiz, oldest first, each flagged when the quiz's sources
 * have drifted since generation. Flagged rows keep their saved scores; the
 * flag tells the UI the run was on since-edited material. A missing quiz
 * cannot prove provenance, so its attempts read stale.
 */
export async function listStudyAttemptsWithStaleness(db: Db, quizId: string): Promise<StaleStudyAttempt[]> {
  const [quiz, attempts] = await Promise.all([getStudyQuiz(db, quizId), listStudyAttempts(db, quizId)]);
  if (!quiz) return attempts.map((attempt) => ({ attempt, stale: true }));
  const stale = await isStudySourcesStale(db, quiz.sourceChunkIds, quiz.sourceRevision);
  return attempts.map((attempt) => ({ attempt, stale }));
}
