import type { SQLiteDatabase } from 'expo-sqlite';

import {
  ANNOTATION_TYPES,
  ROOM_STAGES,
  type AnnotationPayload,
  type AnnotationType,
  type ChunkRow,
  type RoomRow,
  type RoomStage,
} from './models';

/**
 * The single app-owned write boundary for rooms, chunks and annotations.
 *
 * Every human, import and AI change goes through `commitOperation`. The
 * function validates shape, references, anchors, permission and the expected
 * revision, then writes the change and the operation log in one transaction.
 *
 * Revision: `updated_at` is the revision for now. A dedicated monotonic
 * revision column can replace it later without changing this contract (see
 * issue #53).
 */

export const OPERATION_KINDS = [
  'room.create',
  'room.update',
  'room.delete',
  'chunk.create',
  'chunk.update',
  'chunk.delete',
  'annotation.create',
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OPERATION_SOURCES = ['human', 'import', 'ai'] as const;

export type OperationSource = (typeof OPERATION_SOURCES)[number];

export type CommitEntity = 'room' | 'chunk' | 'annotation';

export type CommitSqlValue = string | number | null;

/**
 * The subset of `expo-sqlite`'s `SQLiteDatabase` that the commit boundary
 * needs. `SQLiteDatabase` satisfies this structurally, so production code can
 * pass the open database directly. Tests can implement the same shape on top
 * of `node:sqlite`.
 */
export type CommitDatabase = {
  runAsync(source: string, params: CommitSqlValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(source: string, params: CommitSqlValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

type AssertTrue<T extends true> = T;

/** Compile-time proof that an open expo-sqlite database can be passed directly. */
export type ExpoDatabaseSatisfiesCommitDatabase = AssertTrue<
  SQLiteDatabase extends CommitDatabase ? true : false
>;

export type RoomCreatePayload = {
  id: string;
  name: string;
  stage: RoomStage;
};

export type RoomUpdatePayload = {
  id: string;
  name?: string;
  stage?: RoomStage;
};

export type RoomDeletePayload = {
  id: string;
};

export type ChunkCreatePayload = {
  id: string;
  roomId: string;
  position: number;
  content: string;
  subjectTags?: string[];
  sourceLink?: string | null;
};

export type ChunkUpdatePayload = {
  id: string;
  position?: number;
  content?: string;
  subjectTags?: string[];
  sourceLink?: string | null;
};

export type ChunkDeletePayload = {
  id: string;
};

/**
 * `annotation.create` accepts the Foundation model payload plus the adapter
 * context the AI harness already sends (#53). When supplied, `roomId` must
 * match the chunk's room, and `proposalId` / `noteId` / `body` are folded into
 * the stored annotation payload alongside the validated anchor.
 */
export type AnnotationCreatePayload = {
  id?: string;
  chunkId: string;
  type: AnnotationType;
  payload?: AnnotationPayload;
  body?: string;
  anchorStart?: number;
  anchorEnd?: number;
  roomId?: string;
  proposalId?: string;
  noteId?: number;
};

type OperationBase<K extends OperationKind, P> = {
  opId: string;
  kind: K;
  payload: P;
  source: OperationSource;
  confirmed: boolean;
};

export type RoomCreateOperation = OperationBase<'room.create', RoomCreatePayload> & {
  expectedRevision: null;
};

export type RoomUpdateOperation = OperationBase<'room.update', RoomUpdatePayload> & {
  expectedRevision: number;
};

export type RoomDeleteOperation = OperationBase<'room.delete', RoomDeletePayload> & {
  expectedRevision: number;
};

export type ChunkCreateOperation = OperationBase<'chunk.create', ChunkCreatePayload> & {
  expectedRevision: number;
};

export type ChunkUpdateOperation = OperationBase<'chunk.update', ChunkUpdatePayload> & {
  expectedRevision: number;
};

export type ChunkDeleteOperation = OperationBase<'chunk.delete', ChunkDeletePayload> & {
  expectedRevision: number;
};

export type AnnotationCreateOperation = OperationBase<'annotation.create', AnnotationCreatePayload> & {
  expectedRevision: number;
};

export type Operation =
  | RoomCreateOperation
  | RoomUpdateOperation
  | RoomDeleteOperation
  | ChunkCreateOperation
  | ChunkUpdateOperation
  | ChunkDeleteOperation
  | AnnotationCreateOperation;

export type CommitResult = {
  opId: string;
  kind: OperationKind;
  entity: CommitEntity;
  id: string;
  deleted: boolean;
  /** True when the op id was already committed and nothing was written again. */
  replayed: boolean;
};

export type CommitErrorCode =
  | 'invalid_operation'
  | 'not_found'
  | 'stale_revision'
  | 'unconfirmed_ai_write';

export class CommitError extends Error {
  readonly code: CommitErrorCode;

  constructor(code: CommitErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidOperationError extends CommitError {
  constructor(message: string) {
    super('invalid_operation', message);
  }
}

export class NotFoundError extends CommitError {
  constructor(message: string) {
    super('not_found', message);
  }
}

export class StaleRevisionError extends CommitError {
  constructor(message: string) {
    super('stale_revision', message);
  }
}

export class UnconfirmedAiWriteError extends CommitError {
  constructor(message: string) {
    super('unconfirmed_ai_write', message);
  }
}

type OperationRow = {
  op_id: string;
  kind: string;
  result_json: string;
};

const SELECT_OPERATION_SQL = 'SELECT op_id, kind, result_json FROM operations WHERE op_id = ?';

const INSERT_OPERATION_SQL =
  'INSERT INTO operations (op_id, kind, source, result_json, created_at) VALUES (?, ?, ?, ?, ?)';

const SELECT_ROOM_SQL = 'SELECT id, name, stage, created_at, updated_at FROM rooms WHERE id = ?';

const INSERT_ROOM_SQL =
  'INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?)';

const UPDATE_ROOM_SQL = 'UPDATE rooms SET name = ?, stage = ?, updated_at = ? WHERE id = ?';

const DELETE_ROOM_SQL = 'DELETE FROM rooms WHERE id = ?';

const SELECT_CHUNK_SQL =
  'SELECT id, room_id, position, content, subject_tags, source_link, created_at, updated_at FROM chunks WHERE id = ?';

const INSERT_CHUNK_SQL = `INSERT INTO chunks (
  id, room_id, position, content, subject_tags, source_link, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

const UPDATE_CHUNK_SQL = `UPDATE chunks
  SET position = ?, content = ?, subject_tags = ?, source_link = ?, updated_at = ?
  WHERE id = ?`;

const DELETE_CHUNK_SQL = 'DELETE FROM chunks WHERE id = ?';

const SELECT_ANNOTATION_SQL =
  'SELECT id, chunk_id, type, payload, created_at, updated_at FROM annotations WHERE id = ?';

const INSERT_ANNOTATION_SQL = `INSERT INTO annotations (
  id, chunk_id, type, payload, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?)`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOperationKind(value: unknown): value is OperationKind {
  return OPERATION_KINDS.some((kind) => kind === value);
}

function isOperationSource(value: unknown): value is OperationSource {
  return OPERATION_SOURCES.some((source) => source === value);
}

function isRoomStage(value: unknown): value is RoomStage {
  return ROOM_STAGES.some((stage) => stage === value);
}

function isAnnotationType(value: unknown): value is AnnotationType {
  return ANNOTATION_TYPES.some((type) => type === value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidOperationError(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new InvalidOperationError(`${field} must be a string`);
  }
  return value;
}

function requireInteger(value: unknown, field: string, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new InvalidOperationError(`${field} must be an integer of at least ${minimum}`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireInteger(value, field);
}

function optionalTags(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    throw new InvalidOperationError(`${field} must be a list of strings`);
  }
  return value;
}

function optionalSourceLink(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== 'string') {
    throw new InvalidOperationError('chunk sourceLink must be a string or null');
  }
  return value;
}

function validateOperationShape(value: unknown): Operation {
  if (!isRecord(value)) {
    throw new InvalidOperationError('An operation must be an object');
  }
  requireNonEmptyString(value.opId, 'opId');
  if (!isOperationKind(value.kind)) {
    throw new InvalidOperationError('The operation kind is not supported');
  }
  if (!isOperationSource(value.source)) {
    throw new InvalidOperationError('The operation source must be human, import or ai');
  }
  if (typeof value.confirmed !== 'boolean') {
    throw new InvalidOperationError('confirmed must be a boolean');
  }
  if (!isRecord(value.payload)) {
    throw new InvalidOperationError('The operation payload must be an object');
  }
  const expectedRevision = value.expectedRevision;
  if (value.kind === 'room.create') {
    if (expectedRevision !== null) {
      throw new InvalidOperationError('room.create must have a null expected revision');
    }
  } else if (
    typeof expectedRevision !== 'number' ||
    !Number.isInteger(expectedRevision)
  ) {
    throw new InvalidOperationError(`${value.kind} must have an integer expected revision`);
  }
  return value as Operation;
}

function validateRoomCreatePayload(payload: Record<string, unknown>): RoomCreatePayload {
  const id = requireNonEmptyString(payload.id, 'room id');
  const name = requireNonEmptyString(payload.name, 'room name').trim();
  if (!isRoomStage(payload.stage)) {
    throw new InvalidOperationError('room stage must be stonehenge or brick');
  }
  return { id, name, stage: payload.stage };
}

function validateRoomUpdatePayload(payload: Record<string, unknown>): RoomUpdatePayload {
  const id = requireNonEmptyString(payload.id, 'room id');
  const name =
    payload.name === undefined
      ? undefined
      : requireNonEmptyString(payload.name, 'room name').trim();
  const stage = payload.stage === undefined ? undefined : payload.stage;
  if (stage !== undefined && !isRoomStage(stage)) {
    throw new InvalidOperationError('room stage must be stonehenge or brick');
  }
  if (name === undefined && stage === undefined) {
    throw new InvalidOperationError('room.update needs a name or a stage');
  }
  return { id, name, stage };
}

function validateChunkCreatePayload(payload: Record<string, unknown>): ChunkCreatePayload {
  const id = requireNonEmptyString(payload.id, 'chunk id');
  const roomId = requireNonEmptyString(payload.roomId, 'chunk roomId');
  const position = requireInteger(payload.position, 'chunk position', 0);
  const content = optionalString(payload.content, 'chunk content');
  if (content === undefined) {
    throw new InvalidOperationError('chunk content must be a string');
  }
  const subjectTags = optionalTags(payload.subjectTags, 'chunk subjectTags');
  const sourceLink = optionalSourceLink(payload.sourceLink);
  return { id, roomId, position, content, subjectTags, sourceLink };
}

function validateChunkUpdatePayload(payload: Record<string, unknown>): ChunkUpdatePayload {
  const id = requireNonEmptyString(payload.id, 'chunk id');
  const position =
    payload.position === undefined
      ? undefined
      : requireInteger(payload.position, 'chunk position', 0);
  const content = optionalString(payload.content, 'chunk content');
  const subjectTags = optionalTags(payload.subjectTags, 'chunk subjectTags');
  const sourceLink = optionalSourceLink(payload.sourceLink);
  if (
    position === undefined &&
    content === undefined &&
    subjectTags === undefined &&
    sourceLink === undefined
  ) {
    throw new InvalidOperationError('chunk.update needs at least one field to change');
  }
  return { id, position, content, subjectTags, sourceLink };
}

function validateAnnotationCreatePayload(
  payload: Record<string, unknown>,
): AnnotationCreatePayload {
  const chunkId = requireNonEmptyString(payload.chunkId, 'annotation chunkId');
  if (!isAnnotationType(payload.type)) {
    throw new InvalidOperationError(
      `annotation type must be one of ${ANNOTATION_TYPES.join(', ')}`,
    );
  }
  const id = payload.id === undefined ? undefined : requireNonEmptyString(payload.id, 'annotation id');
  if (payload.payload !== undefined && !isRecord(payload.payload)) {
    throw new InvalidOperationError('annotation payload must be an object');
  }
  const body = optionalString(payload.body, 'annotation body');
  const anchorStart = optionalInteger(payload.anchorStart, 'anchorStart');
  const anchorEnd = optionalInteger(payload.anchorEnd, 'anchorEnd');
  if ((anchorStart === undefined) !== (anchorEnd === undefined)) {
    throw new InvalidOperationError('annotation anchors must be supplied together');
  }
  const roomId =
    payload.roomId === undefined ? undefined : requireNonEmptyString(payload.roomId, 'annotation roomId');
  const proposalId =
    payload.proposalId === undefined
      ? undefined
      : requireNonEmptyString(payload.proposalId, 'annotation proposalId');
  const noteId =
    payload.noteId === undefined
      ? undefined
      : requireInteger(payload.noteId, 'annotation noteId', 0);
  return {
    id,
    chunkId,
    type: payload.type,
    payload: payload.payload as AnnotationPayload | undefined,
    body,
    anchorStart,
    anchorEnd,
    roomId,
    proposalId,
    noteId,
  };
}

function nextTimestamp(previous: number | undefined): number {
  return Math.max(Date.now(), (previous ?? 0) + 1);
}

function assertRevision(
  actual: number,
  expected: number,
  entity: string,
  id: string,
): void {
  if (actual !== expected) {
    throw new StaleRevisionError(
      `${entity} ${id} changed after the operation was prepared (expected revision ${expected}, found ${actual})`,
    );
  }
}

function makeResult(
  operation: Operation,
  entity: CommitEntity,
  id: string,
  deleted: boolean,
): CommitResult {
  return {
    opId: operation.opId,
    kind: operation.kind,
    entity,
    id,
    deleted,
    replayed: false,
  };
}

async function findOperation(
  db: CommitDatabase,
  opId: string,
): Promise<OperationRow | null> {
  return db.getFirstAsync<OperationRow>(SELECT_OPERATION_SQL, [opId]);
}

function replayOperation(row: OperationRow, operation: Operation): CommitResult {
  if (row.kind !== operation.kind) {
    throw new InvalidOperationError(
      `Operation ${operation.opId} was already committed with kind ${row.kind}`,
    );
  }
  const parsed: unknown = JSON.parse(row.result_json);
  if (
    !isRecord(parsed) ||
    typeof parsed.opId !== 'string' ||
    typeof parsed.kind !== 'string' ||
    typeof parsed.entity !== 'string' ||
    typeof parsed.id !== 'string' ||
    typeof parsed.deleted !== 'boolean'
  ) {
    throw new Error(`Stored result for operation ${operation.opId} is not a commit result`);
  }
  return {
    opId: parsed.opId,
    kind: parsed.kind as OperationKind,
    entity: parsed.entity as CommitEntity,
    id: parsed.id,
    deleted: parsed.deleted,
    replayed: true,
  };
}

async function getRoom(db: CommitDatabase, id: string): Promise<RoomRow | null> {
  return db.getFirstAsync<RoomRow>(SELECT_ROOM_SQL, [id]);
}

async function getChunk(db: CommitDatabase, id: string): Promise<ChunkRow | null> {
  return db.getFirstAsync<ChunkRow>(SELECT_CHUNK_SQL, [id]);
}

async function applyOperation(db: CommitDatabase, operation: Operation): Promise<CommitResult> {
  switch (operation.kind) {
    case 'room.create': {
      const payload = validateRoomCreatePayload(operation.payload);
      if (await getRoom(db, payload.id)) {
        throw new InvalidOperationError(`Room ${payload.id} already exists`);
      }
      const now = Date.now();
      await db.runAsync(INSERT_ROOM_SQL, [payload.id, payload.name, payload.stage, now, now]);
      return makeResult(operation, 'room', payload.id, false);
    }

    case 'room.update': {
      const payload = validateRoomUpdatePayload(operation.payload);
      const room = await getRoom(db, payload.id);
      if (!room) {
        throw new NotFoundError(`Room ${payload.id} does not exist`);
      }
      assertRevision(room.updated_at, operation.expectedRevision, 'Room', payload.id);
      const now = nextTimestamp(room.updated_at);
      await db.runAsync(UPDATE_ROOM_SQL, [
        payload.name ?? room.name,
        payload.stage ?? room.stage,
        now,
        payload.id,
      ]);
      return makeResult(operation, 'room', payload.id, false);
    }

    case 'room.delete': {
      const id = requireNonEmptyString(operation.payload.id, 'room id');
      const room = await getRoom(db, id);
      if (!room) {
        throw new NotFoundError(`Room ${id} does not exist`);
      }
      assertRevision(room.updated_at, operation.expectedRevision, 'Room', id);
      await db.runAsync(DELETE_ROOM_SQL, [id]);
      return makeResult(operation, 'room', id, true);
    }

    case 'chunk.create': {
      const payload = validateChunkCreatePayload(operation.payload);
      if (await getChunk(db, payload.id)) {
        throw new InvalidOperationError(`Chunk ${payload.id} already exists`);
      }
      const room = await getRoom(db, payload.roomId);
      if (!room) {
        throw new NotFoundError(`Room ${payload.roomId} does not exist`);
      }
      // A created chunk is anchored to the revision of its parent room.
      assertRevision(room.updated_at, operation.expectedRevision, 'Room', payload.roomId);
      const now = Date.now();
      await db.runAsync(INSERT_CHUNK_SQL, [
        payload.id,
        payload.roomId,
        payload.position,
        payload.content,
        JSON.stringify(payload.subjectTags ?? []),
        payload.sourceLink ?? null,
        now,
        now,
      ]);
      return makeResult(operation, 'chunk', payload.id, false);
    }

    case 'chunk.update': {
      const payload = validateChunkUpdatePayload(operation.payload);
      const chunk = await getChunk(db, payload.id);
      if (!chunk) {
        throw new NotFoundError(`Chunk ${payload.id} does not exist`);
      }
      assertRevision(chunk.updated_at, operation.expectedRevision, 'Chunk', payload.id);
      const now = nextTimestamp(chunk.updated_at);
      await db.runAsync(UPDATE_CHUNK_SQL, [
        payload.position ?? chunk.position,
        payload.content ?? chunk.content,
        payload.subjectTags === undefined
          ? chunk.subject_tags
          : JSON.stringify(payload.subjectTags),
        payload.sourceLink === undefined ? chunk.source_link : payload.sourceLink,
        now,
        payload.id,
      ]);
      return makeResult(operation, 'chunk', payload.id, false);
    }

    case 'chunk.delete': {
      const id = requireNonEmptyString(operation.payload.id, 'chunk id');
      const chunk = await getChunk(db, id);
      if (!chunk) {
        throw new NotFoundError(`Chunk ${id} does not exist`);
      }
      assertRevision(chunk.updated_at, operation.expectedRevision, 'Chunk', id);
      await db.runAsync(DELETE_CHUNK_SQL, [id]);
      return makeResult(operation, 'chunk', id, true);
    }

    case 'annotation.create': {
      const payload = validateAnnotationCreatePayload(operation.payload);
      const chunk = await getChunk(db, payload.chunkId);
      if (!chunk) {
        throw new NotFoundError(`Chunk ${payload.chunkId} does not exist`);
      }
      if (payload.roomId !== undefined && payload.roomId !== chunk.room_id) {
        throw new InvalidOperationError(
          `Chunk ${payload.chunkId} is not in room ${payload.roomId}`,
        );
      }
      assertRevision(chunk.updated_at, operation.expectedRevision, 'Chunk', payload.chunkId);
      if (payload.anchorStart !== undefined && payload.anchorEnd !== undefined) {
        if (payload.anchorStart < 0 || payload.anchorEnd <= payload.anchorStart) {
          throw new InvalidOperationError(
            'annotation anchors must satisfy 0 <= anchorStart < anchorEnd',
          );
        }
        if (payload.anchorEnd > chunk.content.length) {
          throw new InvalidOperationError(
            `annotation anchorEnd ${payload.anchorEnd} is past the end of chunk ${payload.chunkId}`,
          );
        }
      }
      const id = payload.id ?? `annotation-${operation.opId}`;
      if (await db.getFirstAsync(SELECT_ANNOTATION_SQL, [id])) {
        throw new InvalidOperationError(`Annotation ${id} already exists`);
      }
      const storedPayload: AnnotationPayload = { ...(payload.payload ?? {}) };
      if (payload.body !== undefined) {
        storedPayload.body = payload.body;
      }
      if (payload.proposalId !== undefined) {
        storedPayload.proposalId = payload.proposalId;
      }
      if (payload.noteId !== undefined) {
        storedPayload.noteId = payload.noteId;
      }
      if (payload.anchorStart !== undefined && payload.anchorEnd !== undefined) {
        storedPayload.anchorStart = payload.anchorStart;
        storedPayload.anchorEnd = payload.anchorEnd;
      }
      const now = Date.now();
      await db.runAsync(INSERT_ANNOTATION_SQL, [
        id,
        payload.chunkId,
        payload.type,
        JSON.stringify(storedPayload),
        now,
        now,
      ]);
      return makeResult(operation, 'annotation', id, false);
    }
  }
}

/**
 * One queue per database keeps commits from opening overlapping transactions.
 * Expo's `withTransactionAsync` is not exclusive, so serializing here preserves
 * the all-or-nothing guarantee without losing `PRAGMA foreign_keys = ON`.
 */
const commitQueues = new WeakMap<CommitDatabase, Promise<unknown>>();

function enqueueCommit<T>(db: CommitDatabase, task: () => Promise<T>): Promise<T> {
  const previous = commitQueues.get(db) ?? Promise.resolve();
  const run = previous.then(task, task);
  commitQueues.set(
    db,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/**
 * Validate, then atomically write an operation and its op-log row.
 *
 * - A repeated `opId` returns the originally stored result with
 *   `replayed: true` and writes nothing.
 * - An AI operation must have `confirmed: true`.
 * - Any typed validation error or unexpected failure rolls back every write.
 */
export async function commitOperation(
  db: CommitDatabase,
  operation: Operation,
): Promise<CommitResult> {
  const validated = validateOperationShape(operation);
  if (validated.source === 'ai' && validated.confirmed !== true) {
    throw new UnconfirmedAiWriteError('An AI operation must be confirmed before it is committed');
  }

  return enqueueCommit(db, async () => {
    const existing = await findOperation(db, validated.opId);
    if (existing) {
      return replayOperation(existing, validated);
    }

    let result: CommitResult | undefined;
    await db.withTransactionAsync(async () => {
      // Re-check inside the transaction so two racing commits cannot both write.
      const raced = await findOperation(db, validated.opId);
      if (raced) {
        result = replayOperation(raced, validated);
        return;
      }
      const committed = await applyOperation(db, validated);
      await db.runAsync(INSERT_OPERATION_SQL, [
        validated.opId,
        validated.kind,
        validated.source,
        JSON.stringify(committed),
        Date.now(),
      ]);
      result = committed;
    });

    if (result === undefined) {
      throw new Error('The commit transaction completed without a result');
    }
    return result;
  });
}
