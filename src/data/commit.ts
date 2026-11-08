/**
 * The single validate-and-commit boundary (issue #36, FND.2).
 *
 * This is the ONLY module that writes to app tables. `npm run check:writes`
 * fails if SQL writes appear anywhere else under src/ (migrations excepted).
 *
 * Order of checks: shape → permission → confirmation, then inside one
 * transaction: op-ID dedupe → references → expected revision → anchors →
 * writes → op record. Any failure rolls back everything.
 */

import type { Db, SqlValue } from '../db/driver.ts';
import { ANNOTATION_TYPES, REVIEW_STATES, STUDY_QUESTION_KINDS, type ReviewState } from '../db/schema.ts';
import { validBoardItems } from '../whiteboard/model.ts';
import {
  LIMITS,
  NEEDS_CONFIRMATION,
  NEEDS_REVISION,
  OP_KINDS,
  PERMISSIONS,
  SOURCES,
  type CommitError,
  type CommitErrorCode,
  type CommitResult,
  type OpKind,
  type Operation,
  type Payloads,
  type Results,
} from './operations.ts';
import type { SlideItem } from './models.ts';

export interface CommitDeps {
  now(): number;
  newId(): string;
}

export type Commit = <K extends OpKind>(op: Operation<K>) => Promise<CommitResult<K>>;

class Rejection extends Error {
  readonly code: CommitErrorCode;
  constructor(code: CommitErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const reject = (code: CommitErrorCode, message: string): never => {
  throw new Rejection(code, message);
};

/* ------------------------------------------------------------------ shape */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function requireId(v: unknown, field: string): string {
  if (!isId(v)) reject('invalid', `${field} must be a non-empty id`);
  return v as string;
}

function optionalId(v: unknown, field: string): string | undefined {
  return v === undefined ? undefined : requireId(v, field);
}

function roomName(v: unknown): string {
  if (typeof v !== 'string') return reject('invalid', 'name must be text');
  const name = v.trim().replace(/\s+/g, ' ');
  if (name.length === 0) reject('invalid', 'name cannot be empty');
  if (name.length > LIMITS.roomName) reject('invalid', `name is longer than ${LIMITS.roomName} characters`);
  return name;
}

function chunkBody(v: unknown, { allowEmpty }: { allowEmpty: boolean }): string {
  if (typeof v !== 'string') return reject('invalid', 'body must be text');
  if (!allowEmpty && v.trim().length === 0) reject('invalid', 'body cannot be empty');
  if (v.length > LIMITS.body) reject('invalid', `body is longer than ${LIMITS.body} characters`);
  return v;
}

/** Trims, collapses spaces, drops empties and case-insensitive duplicates, keeps order. */
export function normalizeSubjects(v: unknown): string[] {
  if (!Array.isArray(v)) return reject('invalid', 'subjects must be a list');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') reject('invalid', 'each subject must be text');
    const subject = (raw as string).trim().replace(/\s+/g, ' ');
    if (subject.length === 0) continue;
    if (subject.length > LIMITS.subject) reject('invalid', `subject "${subject.slice(0, 20)}…" is too long`);
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(subject);
  }
  if (out.length > LIMITS.subjects) reject('invalid', `at most ${LIMITS.subjects} subjects`);
  return out;
}

/* ------------------------------------------------------- study shapes */

function studyTitle(v: unknown, field = 'title'): string {
  if (typeof v !== 'string') return reject('invalid', `${field} must be text`);
  const title = v.trim().replace(/\s+/g, ' ');
  if (title.length === 0) reject('invalid', `${field} cannot be empty`);
  if (title.length > LIMITS.studyTitle) reject('invalid', `${field} is longer than ${LIMITS.studyTitle} characters`);
  return title;
}

function studyText(v: unknown, field: string): string {
  if (typeof v !== 'string') return reject('invalid', `${field} must be text`);
  if (v.trim().length === 0) reject('invalid', `${field} cannot be empty`);
  if (v.length > LIMITS.studyText) reject('invalid', `${field} is longer than ${LIMITS.studyText} characters`);
  return v;
}

/** Non-empty unique chunk ids that ground one generated row. */
function sourceChunkIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) reject('invalid', 'sourceChunkIds must be a non-empty list');
  const ids = (v as unknown[]).map((id) => requireId(id, 'sourceChunkIds[]'));
  if (new Set(ids).size !== ids.length) reject('invalid', 'sourceChunkIds must be unique');
  return ids;
}

/** Caller-taken revision snapshot. Presence is validated here; staleness is read-time. */
function sourceRevision(v: unknown): number {
  if (!isInt(v) || (v as number) < 1) reject('invalid', 'sourceRevision must be a positive integer');
  return v as number;
}

function studyPosition(v: unknown): number | undefined {
  if (v !== undefined && (!isInt(v) || (v as number) < 0)) reject('invalid', 'position must be a non-negative integer');
  return v as number | undefined;
}

function studyChoices(kind: string, v: unknown): string[] {
  if (kind !== 'mcq') {
    if (v !== undefined && (!Array.isArray(v) || (v as unknown[]).length !== 0)) {
      reject('invalid', 'only mcq questions take choices');
    }
    return [];
  }
  if (!Array.isArray(v) || v.length < 2 || v.length > LIMITS.studyChoices) {
    reject('invalid', `mcq needs 2 to ${LIMITS.studyChoices} choices`);
  }
  return (v as unknown[]).map((choice, i) => {
    if (typeof choice !== 'string' || choice.trim().length === 0) reject('invalid', `choice ${i + 1} cannot be empty`);
    if ((choice as string).length > LIMITS.studyChoice) reject('invalid', `choice ${i + 1} is too long`);
    return choice as string;
  });
}

function studyAnswer(kind: string, v: unknown, choices: string[]): string {
  if (typeof v !== 'string' || v.trim().length === 0) reject('invalid', 'answer cannot be empty');
  const answer = v as string;
  if (answer.length > LIMITS.studyChoice) reject('invalid', 'answer is too long');
  if (kind === 'true_false' && answer !== 'true' && answer !== 'false') {
    reject('invalid', 'a true_false answer must be "true" or "false"');
  }
  if (kind === 'mcq' && !choices.includes(answer)) reject('invalid', 'an mcq answer must be one of the choices');
  return answer;
}

function studyResults(v: unknown, total: number): { questionId: string; correct: boolean }[] {
  if (!Array.isArray(v) || v.length !== total) reject('invalid', 'results must cover every question exactly once');
  const seen = new Set<string>();
  return (v as unknown[]).map((entry) => {
    if (!isObject(entry)) reject('invalid', 'each result needs a questionId and a correct flag');
    const questionId = requireId((entry as Record<string, unknown>).questionId, 'results[].questionId');
    if (typeof (entry as Record<string, unknown>).correct !== 'boolean') reject('invalid', 'each result needs a correct flag');
    if (seen.has(questionId)) reject('invalid', 'results must not repeat a question');
    seen.add(questionId);
    return { questionId, correct: (entry as Record<string, unknown>).correct as boolean };
  });
}

function studySlides(v: unknown): SlideItem[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > LIMITS.studySlides) {
    reject('invalid', `slides must be 1 to ${LIMITS.studySlides} items`);
  }
  return (v as unknown[]).map((slide, i) => {
    if (!isObject(slide)) reject('invalid', `slide ${i + 1} must be an object`);
    const s = slide as Record<string, unknown>;
    const title = studyTitle(s.title, `slides[${i}].title`);
    if (!Array.isArray(s.bullets) || s.bullets.length === 0 || s.bullets.length > LIMITS.studyBullets) {
      reject('invalid', `slides[${i}].bullets must be 1 to ${LIMITS.studyBullets} items`);
    }
    const bullets = (s.bullets as unknown[]).map((bullet, j) => {
      if (typeof bullet !== 'string' || bullet.trim().length === 0) reject('invalid', `slides[${i}].bullets[${j}] cannot be empty`);
      if ((bullet as string).length > LIMITS.studyBullet) reject('invalid', `slides[${i}].bullets[${j}] is too long`);
      return bullet as string;
    });
    const notes = s.notes === undefined || (typeof s.notes === 'string' && s.notes.trim().length === 0)
      ? ''
      : studyText(s.notes, `slides[${i}].notes`);
    return {
      title,
      bullets,
      notes,
      sourceChunkIds: sourceChunkIds(s.sourceChunkIds),
      sourceRevision: sourceRevision(s.sourceRevision),
    };
  });
}

type Normalized = { [K in OpKind]: { kind: K; payload: Payloads[K] } }[OpKind];

function normalize(op: Operation): Normalized {
  if (!isObject(op)) reject('invalid', 'operation must be an object');
  requireId(op.opId, 'opId');
  if (!(OP_KINDS as readonly string[]).includes(op.kind)) reject('invalid', `unknown kind "${String(op.kind)}"`);
  if (!(SOURCES as readonly string[]).includes(op.source)) reject('invalid', `unknown source "${String(op.source)}"`);
  if (typeof op.confirmed !== 'boolean') reject('invalid', 'confirmed must be true or false');
  if (NEEDS_REVISION.has(op.kind) && !isInt(op.expectedRevision)) reject('invalid', `${op.kind} needs expectedRevision`);
  if (op.expectedRevision !== undefined && !isInt(op.expectedRevision)) reject('invalid', 'expectedRevision must be an integer');
  const p: Record<string, unknown> = isObject(op.payload) ? op.payload : reject('invalid', 'payload must be an object');

  switch (op.kind) {
    case 'board.save': {
      const roomId = requireId(p.roomId, 'roomId');
      if (!validBoardItems(p.items) || JSON.stringify(p.items).length > 300_000) reject('invalid', 'invalid whiteboard items');
      return { kind: op.kind, payload: { roomId, items: p.items as Payloads['board.save']['items'] } };
    }
    case 'import.note': {
      if (typeof p.sourceId !== 'string' || !p.sourceId.startsWith('markdown:') || p.sourceId.length > 2048 || p.sourceId.length <= 9) {
        reject('invalid', 'import needs a stable Markdown collection/path identity');
      }
      if (typeof p.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(p.fingerprint)) reject('invalid', 'import needs a SHA-256 fingerprint');
      if (!isObject(p.destination)) return reject('invalid', 'choose an import destination');
      const d = p.destination;
      if ((d.roomId === undefined) === (d.name === undefined)) reject('invalid', 'choose an existing room or a new room name');
      const destination = d.roomId !== undefined ? { roomId: requireId(d.roomId, 'roomId') } : { name: roomName(d.name) };
      if (!Array.isArray(p.bodies) || !p.bodies.length || p.bodies.length > LIMITS.bodiesPerOp) reject('invalid', 'invalid import chunk count');
      const bodies = (p.bodies as unknown[]).map((body) => chunkBody(body, { allowEmpty: false }));
      if (bodies.reduce((size, body) => size + new TextEncoder().encode(body).length, 0) > 1024 * 1024) reject('invalid', 'import is too large');
      return { kind: op.kind, payload: { sourceId: p.sourceId as string, fingerprint: p.fingerprint as string, destination, bodies, subjects: normalizeSubjects(p.subjects) } };
    }
    case 'room.create':
      return { kind: op.kind, payload: { roomId: optionalId(p.roomId, 'roomId'), name: roomName(p.name) } };
    case 'room.rename':
      return { kind: op.kind, payload: { roomId: requireId(p.roomId, 'roomId'), name: roomName(p.name) } };
    case 'room.delete':
      return { kind: op.kind, payload: { roomId: requireId(p.roomId, 'roomId') } };
    case 'chunk.create': {
      if (!Array.isArray(p.bodies) || p.bodies.length === 0) reject('invalid', 'bodies must be a non-empty list');
      const bodies = (p.bodies as unknown[]).map((b) => chunkBody(b, { allowEmpty: false }));
      if (bodies.length > LIMITS.bodiesPerOp) reject('invalid', `at most ${LIMITS.bodiesPerOp} chunks per op`);
      let chunkIds: string[] | undefined;
      if (p.chunkIds !== undefined) {
        if (!Array.isArray(p.chunkIds) || p.chunkIds.length !== bodies.length) reject('invalid', 'chunkIds must match bodies');
        chunkIds = (p.chunkIds as unknown[]).map((id) => requireId(id, 'chunkIds[]'));
        if (new Set(chunkIds).size !== chunkIds.length) reject('invalid', 'chunkIds must be unique');
      }
      if (p.index !== undefined && (!isInt(p.index) || p.index < 0)) reject('invalid', 'index must be a non-negative integer');
      if (p.sourceLink != null && (typeof p.sourceLink !== 'string' || p.sourceLink.length > 2048)) reject('invalid', 'sourceLink must be text');
      return {
        kind: op.kind,
        payload: {
          roomId: requireId(p.roomId, 'roomId'),
          bodies,
          chunkIds,
          subjects: p.subjects === undefined ? [] : normalizeSubjects(p.subjects),
          index: p.index as number | undefined,
          sourceLink: (p.sourceLink as string | null | undefined) ?? null,
        },
      };
    }
    case 'chunk.update': {
      if (p.body === undefined && p.subjects === undefined) reject('invalid', 'chunk.update needs body or subjects');
      return {
        kind: op.kind,
        payload: {
          chunkId: requireId(p.chunkId, 'chunkId'),
          body: p.body === undefined ? undefined : chunkBody(p.body, { allowEmpty: true }),
          subjects: p.subjects === undefined ? undefined : normalizeSubjects(p.subjects),
        },
      };
    }
    case 'chunk.move':
      if (!isInt(p.toIndex) || p.toIndex < 0) reject('invalid', 'toIndex must be a non-negative integer');
      return { kind: op.kind, payload: { chunkId: requireId(p.chunkId, 'chunkId'), toIndex: p.toIndex as number } };
    case 'chunk.delete':
      return { kind: op.kind, payload: { chunkId: requireId(p.chunkId, 'chunkId') } };
    case 'annotation.create': {
      if (!(ANNOTATION_TYPES as readonly unknown[]).includes(p.type)) reject('invalid', `unknown annotation type "${String(p.type)}"`);
      if (!isObject(p.anchor)) reject('invalid', 'anchor must be an object');
      const payload = p.payload === undefined ? {} : isObject(p.payload) ? p.payload : reject('invalid', 'payload must be an object');
      if (JSON.stringify(payload).length > LIMITS.payloadChars) reject('invalid', 'annotation payload is too large');
      return {
        kind: op.kind,
        payload: {
          annotationId: optionalId(p.annotationId, 'annotationId'),
          chunkId: requireId(p.chunkId, 'chunkId'),
          type: p.type as Payloads['annotation.create']['type'],
          anchor: p.anchor as Payloads['annotation.create']['anchor'],
          payload,
        },
      };
    }
    case 'annotation.delete':
      return { kind: op.kind, payload: { annotationId: requireId(p.annotationId, 'annotationId') } };
    case 'review.mark':
      if (!(REVIEW_STATES as readonly string[]).includes(String(p.state))) reject('invalid', 'review state must be missed, unclear, or got_it');
      return {
        kind: op.kind,
        payload: {
          chunkId: requireId(p.chunkId, 'chunkId'),
          state: p.state as ReviewState,
          timeZone: timeZone(p.timeZone),
        },
      };
    case 'study.deck.create':
      return {
        kind: op.kind,
        payload: {
          deckId: optionalId(p.deckId, 'deckId'),
          roomId: requireId(p.roomId, 'roomId'),
          title: studyTitle(p.title),
          sourceChunkIds: sourceChunkIds(p.sourceChunkIds),
          sourceRevision: sourceRevision(p.sourceRevision),
        },
      };
    case 'study.card.create':
      return {
        kind: op.kind,
        payload: {
          cardId: optionalId(p.cardId, 'cardId'),
          deckId: requireId(p.deckId, 'deckId'),
          roomId: requireId(p.roomId, 'roomId'),
          front: studyText(p.front, 'front'),
          back: studyText(p.back, 'back'),
          position: studyPosition(p.position),
          sourceChunkIds: sourceChunkIds(p.sourceChunkIds),
          sourceRevision: sourceRevision(p.sourceRevision),
        },
      };
    case 'study.quiz.create':
      return {
        kind: op.kind,
        payload: {
          quizId: optionalId(p.quizId, 'quizId'),
          roomId: requireId(p.roomId, 'roomId'),
          title: studyTitle(p.title),
          sourceChunkIds: sourceChunkIds(p.sourceChunkIds),
          sourceRevision: sourceRevision(p.sourceRevision),
        },
      };
    case 'study.question.create': {
      if (!(STUDY_QUESTION_KINDS as readonly string[]).includes(p.kind as string)) {
        reject('invalid', `unknown question kind "${String(p.kind)}"`);
      }
      const kind = p.kind as Payloads['study.question.create']['kind'];
      const choices = studyChoices(kind, p.choices);
      const answer = studyAnswer(kind, p.answer, choices);
      return {
        kind: op.kind,
        payload: {
          questionId: optionalId(p.questionId, 'questionId'),
          quizId: requireId(p.quizId, 'quizId'),
          roomId: requireId(p.roomId, 'roomId'),
          kind,
          stem: studyText(p.stem, 'stem'),
          choices,
          answer,
          explanation: p.explanation === undefined ? '' : studyText(p.explanation, 'explanation'),
          position: studyPosition(p.position),
          sourceChunkIds: sourceChunkIds(p.sourceChunkIds),
          sourceRevision: sourceRevision(p.sourceRevision),
        },
      };
    }
    case 'study.attempt.save': {
      if (typeof p.scorePct !== 'number' || !Number.isFinite(p.scorePct) || p.scorePct < 0 || p.scorePct > 100) {
        reject('invalid', 'scorePct must be between 0 and 100');
      }
      const scorePct = p.scorePct as number;
      if (!isInt(p.correct) || (p.correct as number) < 0) reject('invalid', 'correct must be a non-negative integer');
      if (!isInt(p.total) || (p.total as number) < 1) reject('invalid', 'total must be a positive integer');
      if ((p.correct as number) > (p.total as number)) reject('invalid', 'correct cannot exceed total');
      if (!isInt(p.durationMs) || (p.durationMs as number) < 0) reject('invalid', 'durationMs must be a non-negative integer');
      return {
        kind: op.kind,
        payload: {
          attemptId: optionalId(p.attemptId, 'attemptId'),
          quizId: requireId(p.quizId, 'quizId'),
          roomId: requireId(p.roomId, 'roomId'),
          scorePct,
          correct: p.correct as number,
          total: p.total as number,
          results: studyResults(p.results, p.total as number),
          durationMs: p.durationMs as number,
        },
      };
    }
    case 'study.slide-outline.create':
      return {
        kind: op.kind,
        payload: {
          outlineId: optionalId(p.outlineId, 'outlineId'),
          roomId: requireId(p.roomId, 'roomId'),
          title: studyTitle(p.title),
          slides: studySlides(p.slides),
          sourceChunkIds: sourceChunkIds(p.sourceChunkIds),
          sourceRevision: sourceRevision(p.sourceRevision),
        },
      };
  }
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const REVIEW_DUE_MS: Record<ReviewState, number> = {
  missed: 10 * MINUTE_MS,
  unclear: DAY_MS,
  got_it: 3 * DAY_MS,
};

/** One review_marks row is one credit: a chunk on one local day. */
const BRICK_CREDIT_COUNT = 3;

function timeZone(value: unknown): string {
  if (typeof value !== 'string') return reject('invalid', 'time zone must be text');
  const zone = value.trim();
  if (zone.length === 0 || zone.length > 64) return reject('invalid', 'time zone must be a recognized IANA name');
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
  } catch {
    return reject('invalid', 'time zone must be a recognized IANA name');
  }
  return zone;
}

/** Calendar day of `now` in `zone`, as YYYY-MM-DD. */
function localDay(now: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return reject('invalid', 'time zone must be a recognized IANA name');
  return `${year}-${month}-${day}`;
}

function checkAnchor(type: string, anchor: Record<string, unknown>, body: string): void {
  if (type === 'stroke') {
    const points = anchor.points;
    const ok =
      Array.isArray(points) &&
      points.length > 0 &&
      points.length <= LIMITS.strokePoints &&
      points.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === 'number' && Number.isFinite(n)));
    if (!ok) reject('invalid', 'stroke anchor needs 1 or more [x, y] points');
    return;
  }
  const { start, end } = anchor;
  if (!isInt(start) || !isInt(end) || start < 0 || end <= start || end > body.length) {
    reject('invalid', `${type} anchor must be a range inside the chunk (0–${body.length})`);
  }
}

/* --------------------------------------------------------------- execute */

interface RevisionRow {
  revision: number;
}

async function expectRevision(found: RevisionRow | null, expected: number | undefined, what: string): Promise<void> {
  if (!found) reject('not_found', `${what} does not exist`);
  if (expected !== undefined && found!.revision !== expected) {
    reject('stale_revision', `${what} changed elsewhere (now revision ${found!.revision}, expected ${expected})`);
  }
}

/**
 * Every generated row is grounded in chunks from one room. A missing chunk
 * is `not_found`; a chunk from another room rejects the op as `invalid` so a
 * cross-room generation can never be saved.
 */
async function expectSourcesInRoom(db: Db, roomId: string, sourceChunkIds: string[]): Promise<void> {
  for (const chunkId of sourceChunkIds) {
    const row = await db.get<{ room_id: string }>('SELECT room_id FROM chunks WHERE id = ?', [chunkId]);
    if (!row) reject('not_found', `source chunk ${chunkId} does not exist`);
    if (row!.room_id !== roomId) reject('invalid', 'study materials must come from a single room');
  }
}

/** A child study row (card, question, attempt) must live in its parent's room. */
async function expectStudyParent(
  db: Db,
  table: 'study_decks' | 'study_quizzes',
  parentId: string,
  what: string,
  roomId: string,
): Promise<void> {
  const row = await db.get<{ room_id: string }>(`SELECT room_id FROM ${table} WHERE id = ?`, [parentId]);
  if (!row) reject('not_found', `${what} does not exist`);
  if (row!.room_id !== roomId) reject('invalid', `a study row must live in its parent's room`);
}

async function apply(db: Db, op: Operation, n: Normalized, deps: CommitDeps): Promise<Results[OpKind]> {
  const now = deps.now();
  const run = (sql: string, params: SqlValue[]) => db.run(sql, params);

  switch (n.kind) {
    case 'import.note': {
      const { sourceId, fingerprint, destination, bodies, subjects } = n.payload;
      const prior = await db.get<{ fingerprint: string; room_id: string; chunk_ids: string }>(
        'SELECT fingerprint, room_id, chunk_ids FROM import_sources WHERE source_id = ?', [sourceId],
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint) reject('conflict', 'This source has changed since import. Your notes were kept. Use a different source path to save a separate copy.');
        return { roomId: prior.room_id, chunkIds: JSON.parse(prior.chunk_ids), skipped: true };
      }
      let roomId: string;
      if ('roomId' in destination) {
        roomId = destination.roomId;
        if (!await db.get('SELECT 1 FROM rooms WHERE id = ?', [roomId])) reject('not_found', 'the destination room no longer exists');
      } else {
        roomId = deps.newId();
        await run('INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES (?, ?, \'stonehenge\', ?, ?)', [roomId, destination.name, now, now]);
      }
      const start = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE room_id = ?', [roomId]))!.n;
      const chunkIds = bodies.map(() => deps.newId());
      for (let i = 0; i < bodies.length; i++) {
        await run('INSERT INTO chunks (id, room_id, position, content, source_link, subject_tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [chunkIds[i], roomId, start + i, bodies[i], sourceId, JSON.stringify(subjects), now, now]);
        for (let s = 0; s < subjects.length; s++) {
          await run('INSERT INTO chunk_subjects (chunk_id, subject, position) VALUES (?, ?, ?)', [chunkIds[i], subjects[s], s]);
        }
      }
      await run('INSERT INTO import_sources (source_id, fingerprint, room_id, chunk_ids, imported_at) VALUES (?, ?, ?, ?, ?)',
        [sourceId, fingerprint, roomId, JSON.stringify(chunkIds), now]);
      return { roomId, chunkIds, skipped: false };
    }
    case 'room.create': {
      const roomId = n.payload.roomId ?? deps.newId();
      if (await db.get('SELECT 1 FROM rooms WHERE id = ?', [roomId])) reject('conflict', 'a room with that id already exists');
      await run('INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES (?, ?, \'stonehenge\', ?, ?)', [roomId, n.payload.name, now, now]);
      return { roomId, revision: 1 };
    }
    case 'room.rename': {
      const { roomId, name } = n.payload;
      await expectRevision(await db.get<RevisionRow>('SELECT revision FROM rooms WHERE id = ?', [roomId]), op.expectedRevision, 'room');
      await run('UPDATE rooms SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ?', [name, now, roomId]);
      return { roomId, revision: op.expectedRevision! + 1 };
    }
    case 'room.delete': {
      const { roomId } = n.payload;
      await expectRevision(await db.get<RevisionRow>('SELECT revision FROM rooms WHERE id = ?', [roomId]), op.expectedRevision, 'room');
      await run('DELETE FROM rooms WHERE id = ?', [roomId]);
      return { roomId };
    }
    case 'chunk.create': {
      const { roomId, bodies, subjects = [], sourceLink = null } = n.payload;
      if (!(await db.get('SELECT 1 FROM rooms WHERE id = ?', [roomId]))) reject('not_found', 'room does not exist');
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE room_id = ?', [roomId]))!.n;
      const index = Math.min(n.payload.index ?? count, count);
      const chunkIds = n.payload.chunkIds ?? bodies.map(() => deps.newId());
      for (const id of chunkIds) {
        if (await db.get('SELECT 1 FROM chunks WHERE id = ?', [id])) reject('conflict', 'a chunk with that id already exists');
      }
      if (index < count) {
        await run('UPDATE chunks SET position = position + ? WHERE room_id = ? AND position >= ?', [bodies.length, roomId, index]);
      }
      for (let i = 0; i < bodies.length; i += 1) {
        await run(
          'INSERT INTO chunks (id, room_id, position, content, source_link, subject_tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [chunkIds[i], roomId, index + i, bodies[i], sourceLink, JSON.stringify(subjects), now, now],
        );
        for (let s = 0; s < subjects.length; s += 1) {
          await run('INSERT INTO chunk_subjects (chunk_id, subject, position) VALUES (?, ?, ?)', [chunkIds[i], subjects[s], s]);
        }
      }
      return { chunkIds };
    }
    case 'chunk.update': {
      const { chunkId, body, subjects } = n.payload;
      await expectRevision(await db.get<RevisionRow>('SELECT revision FROM chunks WHERE id = ?', [chunkId]), op.expectedRevision, 'chunk');
      if (body !== undefined) {
        await run('UPDATE chunks SET content = ? WHERE id = ?', [body, chunkId]);
      }
      if (subjects !== undefined) {
        await run('UPDATE chunks SET subject_tags = ? WHERE id = ?', [JSON.stringify(subjects), chunkId]);
        await run('DELETE FROM chunk_subjects WHERE chunk_id = ?', [chunkId]);
        for (let s = 0; s < subjects.length; s += 1) {
          await run('INSERT INTO chunk_subjects (chunk_id, subject, position) VALUES (?, ?, ?)', [chunkId, subjects[s], s]);
        }
      }
      await run('UPDATE chunks SET revision = revision + 1, updated_at = ? WHERE id = ?', [now, chunkId]);
      return { chunkId, revision: op.expectedRevision! + 1, updatedAt: now };
    }
    case 'chunk.move': {
      const { chunkId, toIndex } = n.payload;
      const chunk = await db.get<RevisionRow & { room_id: string }>('SELECT revision, room_id FROM chunks WHERE id = ?', [chunkId]);
      await expectRevision(chunk, op.expectedRevision, 'chunk');
      const order = (await db.all<{ id: string }>('SELECT id FROM chunks WHERE room_id = ? ORDER BY position', [chunk!.room_id])).map((r) => r.id);
      const next = order.filter((id) => id !== chunkId);
      next.splice(Math.min(toIndex, next.length), 0, chunkId);
      for (let i = 0; i < next.length; i += 1) {
        if (order[i] !== next[i]) await run('UPDATE chunks SET position = ? WHERE id = ?', [i, next[i]]);
      }
      // Reordering is not an edit, so updated_at (and the recent list) is unchanged.
      await run('UPDATE chunks SET revision = revision + 1 WHERE id = ?', [chunkId]);
      return { chunkId, revision: op.expectedRevision! + 1 };
    }
    case 'chunk.delete': {
      const { chunkId } = n.payload;
      const chunk = await db.get<RevisionRow & { room_id: string; position: number }>(
        'SELECT revision, room_id, position FROM chunks WHERE id = ?',
        [chunkId],
      );
      await expectRevision(chunk, op.expectedRevision, 'chunk');
      await run('DELETE FROM chunks WHERE id = ?', [chunkId]);
      await run('UPDATE chunks SET position = position - 1 WHERE room_id = ? AND position > ?', [chunk!.room_id, chunk!.position]);
      return { chunkId };
    }
    case 'annotation.create': {
      const { chunkId, type, anchor, payload = {} } = n.payload;
      const chunk = await db.get<RevisionRow & { body: string }>('SELECT revision, content AS body FROM chunks WHERE id = ?', [chunkId]);
      await expectRevision(chunk, op.expectedRevision, 'chunk');
      checkAnchor(type, anchor as unknown as Record<string, unknown>, chunk!.body);
      const annotationId = n.payload.annotationId ?? deps.newId();
      if (await db.get('SELECT 1 FROM annotations WHERE id = ?', [annotationId])) reject('conflict', 'an annotation with that id already exists');
      await run(
        'INSERT INTO annotations (id, chunk_id, type, anchor, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [annotationId, chunkId, type, JSON.stringify(anchor), JSON.stringify(payload), now, now],
      );
      return { annotationId };
    }
    case 'annotation.delete': {
      const { annotationId } = n.payload;
      const deleted = await run('DELETE FROM annotations WHERE id = ?', [annotationId]);
      if (deleted.changes === 0) reject('not_found', 'annotation does not exist');
      return { annotationId };
    }
    case 'review.mark': {
      const { chunkId, state, timeZone: zone } = n.payload;
      const chunk = await db.get<RevisionRow & { room_id: string }>('SELECT revision, room_id FROM chunks WHERE id = ?', [chunkId]);
      await expectRevision(chunk, op.expectedRevision, 'chunk');
      const day = localDay(now, zone);
      const dueAt = now + REVIEW_DUE_MS[state];
      await run(
        `INSERT INTO review_marks (chunk_id, local_day, state, marked_at, due_at, time_zone)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (chunk_id, local_day) DO UPDATE SET
           state = excluded.state,
           marked_at = excluded.marked_at,
           due_at = excluded.due_at,
           time_zone = excluded.time_zone`,
        [chunkId, day, state, now, dueAt, zone],
      );
      const credits = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM review_marks
         JOIN chunks ON chunks.id = review_marks.chunk_id
         WHERE chunks.room_id = ?`,
        [chunk!.room_id],
      );
      const room = await db.get<{ stage: string }>('SELECT stage FROM rooms WHERE id = ?', [chunk!.room_id]);
      if (!room) reject('not_found', 'room does not exist');
      if (room!.stage !== 'stonehenge' && room!.stage !== 'brick') reject('not_found', 'room does not exist');
      let stage: 'stonehenge' | 'brick' = room!.stage === 'brick' ? 'brick' : 'stonehenge';
      if ((credits?.n ?? 0) >= BRICK_CREDIT_COUNT && stage === 'stonehenge') {
        await run(`UPDATE rooms SET stage = 'brick', updated_at = ? WHERE id = ? AND stage = 'stonehenge'`, [now, chunk!.room_id]);
        stage = 'brick';
      }
      return { chunkId, state, localDay: day, markedAt: now, dueAt, timeZone: zone, stage };
    }
    case 'board.save': {
      const { roomId, items } = n.payload;
      if (!await db.get('SELECT 1 FROM rooms WHERE id = ?', [roomId])) reject('not_found', 'room does not exist');
      const board = await db.get<RevisionRow>('SELECT revision FROM whiteboards WHERE room_id = ?', [roomId]);
      const revision = board?.revision ?? 0;
      if (op.expectedRevision !== revision) reject('stale_revision', `whiteboard changed elsewhere (now revision ${revision})`);
      if (board) await run('UPDATE whiteboards SET items = ?, revision = revision + 1, updated_at = ? WHERE room_id = ?', [JSON.stringify(items), now, roomId]);
      else await run('INSERT INTO whiteboards (room_id, items, updated_at) VALUES (?, ?, ?)', [roomId, JSON.stringify(items), now]);
      return { roomId, revision: revision + 1 };
    }
    case 'study.deck.create': {
      const { roomId, title, sourceChunkIds, sourceRevision } = n.payload;
      if (!await db.get('SELECT 1 FROM rooms WHERE id = ?', [roomId])) reject('not_found', 'room does not exist');
      await expectSourcesInRoom(db, roomId, sourceChunkIds);
      const deckId = n.payload.deckId ?? deps.newId();
      if (await db.get('SELECT 1 FROM study_decks WHERE id = ?', [deckId])) reject('conflict', 'a deck with that id already exists');
      await run(
        'INSERT INTO study_decks (id, room_id, title, source_chunk_ids, source_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [deckId, roomId, title, JSON.stringify(sourceChunkIds), sourceRevision, now, now],
      );
      return { deckId };
    }
    case 'study.card.create': {
      const { deckId, roomId, front, back, sourceChunkIds, sourceRevision } = n.payload;
      await expectStudyParent(db, 'study_decks', deckId, 'deck', roomId);
      await expectSourcesInRoom(db, roomId, sourceChunkIds);
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM study_cards WHERE deck_id = ?', [deckId]))!.n;
      const position = Math.min(n.payload.position ?? count, count);
      const cardId = n.payload.cardId ?? deps.newId();
      if (await db.get('SELECT 1 FROM study_cards WHERE id = ?', [cardId])) reject('conflict', 'a card with that id already exists');
      if (position < count) {
        await run('UPDATE study_cards SET position = position + 1 WHERE deck_id = ? AND position >= ?', [deckId, position]);
      }
      await run(
        'INSERT INTO study_cards (id, deck_id, room_id, position, front, back, source_chunk_ids, source_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [cardId, deckId, roomId, position, front, back, JSON.stringify(sourceChunkIds), sourceRevision, now, now],
      );
      return { cardId };
    }
    case 'study.quiz.create': {
      const { roomId, title, sourceChunkIds, sourceRevision } = n.payload;
      if (!await db.get('SELECT 1 FROM rooms WHERE id = ?', [roomId])) reject('not_found', 'room does not exist');
      await expectSourcesInRoom(db, roomId, sourceChunkIds);
      const quizId = n.payload.quizId ?? deps.newId();
      if (await db.get('SELECT 1 FROM study_quizzes WHERE id = ?', [quizId])) reject('conflict', 'a quiz with that id already exists');
      await run(
        'INSERT INTO study_quizzes (id, room_id, title, source_chunk_ids, source_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [quizId, roomId, title, JSON.stringify(sourceChunkIds), sourceRevision, now, now],
      );
      return { quizId };
    }
    case 'study.question.create': {
      const { quizId, roomId, kind, stem, choices, answer, explanation = '', sourceChunkIds, sourceRevision } = n.payload;
      await expectStudyParent(db, 'study_quizzes', quizId, 'quiz', roomId);
      await expectSourcesInRoom(db, roomId, sourceChunkIds);
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM study_questions WHERE quiz_id = ?', [quizId]))!.n;
      const position = Math.min(n.payload.position ?? count, count);
      const questionId = n.payload.questionId ?? deps.newId();
      if (await db.get('SELECT 1 FROM study_questions WHERE id = ?', [questionId])) reject('conflict', 'a question with that id already exists');
      if (position < count) {
        await run('UPDATE study_questions SET position = position + 1 WHERE quiz_id = ? AND position >= ?', [quizId, position]);
      }
      await run(
        'INSERT INTO study_questions (id, quiz_id, room_id, position, kind, stem, choices, answer, explanation, source_chunk_ids, source_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [questionId, quizId, roomId, position, kind, stem, JSON.stringify(choices), answer, explanation, JSON.stringify(sourceChunkIds), sourceRevision, now, now],
      );
      return { questionId };
    }
    case 'study.attempt.save': {
      const { quizId, roomId, scorePct, correct, total, results, durationMs } = n.payload;
      await expectStudyParent(db, 'study_quizzes', quizId, 'quiz', roomId);
      const known = new Set(
        (await db.all<{ id: string }>('SELECT id FROM study_questions WHERE quiz_id = ?', [quizId])).map((row) => row.id),
      );
      for (const result of results) {
        if (!known.has(result.questionId)) reject('not_found', `question ${result.questionId} is not part of this quiz`);
      }
      const attemptId = n.payload.attemptId ?? deps.newId();
      if (await db.get('SELECT 1 FROM study_attempts WHERE id = ?', [attemptId])) reject('conflict', 'an attempt with that id already exists');
      await run(
        'INSERT INTO study_attempts (id, quiz_id, room_id, score_pct, correct, total, results, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [attemptId, quizId, roomId, scorePct, correct, total, JSON.stringify(results), durationMs, now],
      );
      return { attemptId };
    }
    case 'study.slide-outline.create': {
      const { roomId, title, slides, sourceChunkIds, sourceRevision } = n.payload;
      if (!await db.get('SELECT 1 FROM rooms WHERE id = ?', [roomId])) reject('not_found', 'room does not exist');
      await expectSourcesInRoom(db, roomId, sourceChunkIds);
      for (const slide of slides) {
        await expectSourcesInRoom(db, roomId, slide.sourceChunkIds);
      }
      const outlineId = n.payload.outlineId ?? deps.newId();
      if (await db.get('SELECT 1 FROM slide_outlines WHERE id = ?', [outlineId])) reject('conflict', 'an outline with that id already exists');
      await run(
        'INSERT INTO slide_outlines (id, room_id, title, slides, source_chunk_ids, source_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [outlineId, roomId, title, JSON.stringify(slides), JSON.stringify(sourceChunkIds), sourceRevision, now, now],
      );
      return { outlineId };
    }
  }
}

/**
 * One queue per database object. Room saves and harness confirms must share
 * that object — `expoDriver` returns the same wrapper for one SQLite handle —
 * because `withTransactionAsync` does not isolate two wrappers. Each caller
 * still uses its own clock and id factory. A failed commit rolls back only
 * its own transaction; the next queued commit then runs on the committed
 * database.
 */
const commitQueues = new WeakMap<Db, Promise<unknown>>();

/**
 * Creates the app's commit function for one database. Commits are queued so
 * two never share a transaction, even when the UI fires them concurrently.
 */
export function createCommit(db: Db, deps: CommitDeps): Commit {
  async function commitNow(op: Operation): Promise<CommitResult> {
    let normalized: Normalized;
    try {
      normalized = normalize(op);
      if (!PERMISSIONS[op.source].has(op.kind)) reject('forbidden', `${op.source} changes cannot ${op.kind}`);
      if ((op.source === 'ai' || NEEDS_CONFIRMATION.has(op.kind)) && !op.confirmed) {
        reject(
          'unconfirmed',
          op.kind === 'import.note'
            ? 'importing needs review and confirmation'
            : op.source === 'ai'
              ? 'AI changes need confirmation'
              : op.kind === 'room.delete'
                ? 'deleting a room needs confirmation'
                : 'confirm this change before saving it',
        );
      }
    } catch (error) {
      return failure(error);
    }

    try {
      return await db.transaction(async () => {
        const prior = await db.get<{ kind: string; result: string }>('SELECT kind, result FROM applied_ops WHERE op_id = ?', [op.opId]);
        if (prior) {
          if (prior.kind !== op.kind) reject('conflict', `op ${op.opId} was already used for ${prior.kind}`);
          return { ok: true as const, duplicate: true, value: JSON.parse(prior.result) };
        }
        const value = await apply(db, op, normalized, deps);
        await db.run('INSERT INTO applied_ops (op_id, kind, source, result, committed_at) VALUES (?, ?, ?, ?, ?)', [
          op.opId,
          op.kind,
          op.source,
          JSON.stringify(value),
          deps.now(),
        ]);
        return { ok: true as const, duplicate: false, value };
      });
    } catch (error) {
      return failure(error);
    }
  }

  return (<K extends OpKind>(op: Operation<K>) => {
    const previous = commitQueues.get(db) ?? Promise.resolve();
    const next = previous.then(() => commitNow(op as Operation));
    commitQueues.set(db, next.catch(() => undefined));
    return next as Promise<CommitResult<K>>;
  }) as Commit;
}

function failure(error: unknown): { ok: false; error: CommitError } {
  if (error instanceof Rejection) return { ok: false, error: { code: error.code, message: error.message } };
  const message = error instanceof Error ? error.message : String(error);
  if (/constraint/i.test(message)) return { ok: false, error: { code: 'invalid', message } };
  return { ok: false, error: { code: 'failed', message } };
}
