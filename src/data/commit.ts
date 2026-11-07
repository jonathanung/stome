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
import { ANNOTATION_TYPES } from '../db/schema.ts';
import {
  LIMITS,
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
  }
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
        await run('INSERT INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [roomId, destination.name, now, now]);
      }
      const start = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE room_id = ?', [roomId]))!.n;
      const chunkIds = bodies.map(() => deps.newId());
      for (let i = 0; i < bodies.length; i++) {
        await run('INSERT INTO chunks (id, room_id, position, body, source_link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [chunkIds[i], roomId, start + i, bodies[i], sourceId, now, now]);
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
      await run('INSERT INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [roomId, n.payload.name, now, now]);
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
          'INSERT INTO chunks (id, room_id, position, body, source_link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [chunkIds[i], roomId, index + i, bodies[i], sourceLink, now, now],
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
        await run('UPDATE chunks SET body = ? WHERE id = ?', [body, chunkId]);
      }
      if (subjects !== undefined) {
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
      const chunk = await db.get<RevisionRow & { body: string }>('SELECT revision, body FROM chunks WHERE id = ?', [chunkId]);
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
  }
}

/**
 * Creates the app's commit function for one database. Commits are queued so
 * two never share a transaction, even when the UI fires them concurrently.
 */
export function createCommit(db: Db, deps: CommitDeps): Commit {
  let queue: Promise<unknown> = Promise.resolve();

  async function commitNow(op: Operation): Promise<CommitResult> {
    let normalized: Normalized;
    try {
      normalized = normalize(op);
      if (!PERMISSIONS[op.source].has(op.kind)) reject('forbidden', `${op.source} changes cannot ${op.kind}`);
      if ((op.source === 'ai' || op.kind === 'room.delete' || op.kind === 'import.note') && !op.confirmed) {
        reject('unconfirmed', op.kind === 'import.note' ? 'importing needs review and confirmation' : op.source === 'ai' ? 'AI changes need confirmation' : 'deleting a room needs confirmation');
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
    const next = queue.then(() => commitNow(op as Operation));
    queue = next.catch(() => undefined);
    return next as Promise<CommitResult<K>>;
  }) as Commit;
}

function failure(error: unknown): { ok: false; error: CommitError } {
  if (error instanceof Rejection) return { ok: false, error: { code: error.code, message: error.message } };
  const message = error instanceof Error ? error.message : String(error);
  if (/constraint/i.test(message)) return { ok: false, error: { code: 'invalid', message } };
  return { ok: false, error: { code: 'failed', message } };
}
