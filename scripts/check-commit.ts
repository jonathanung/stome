import { DatabaseSync } from 'node:sqlite';

import {
  InvalidOperationError,
  NotFoundError,
  StaleRevisionError,
  UnconfirmedAiWriteError,
  commitOperation,
  type CommitDatabase,
  type CommitError,
  type CommitSqlValue,
  type Operation,
} from '../src/db/commit.ts';
import {
  type AnnotationRow,
  type ChunkRow,
  type RoomRow,
} from '../src/db/models.ts';
import {
  CONNECTION_PRAGMAS,
  MIGRATIONS,
  SUPPORTED_VERSION,
  migrationsFor,
} from '../src/db/schema.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function applySchema(db: DatabaseSync): void {
  db.exec(CONNECTION_PRAGMAS);
  const pending = migrationsFor(readVersion(db));
  if (pending.length === 0) {
    return;
  }
  db.exec('BEGIN');
  try {
    for (const migration of pending) {
      db.exec(migration.sql);
    }
    db.exec(`PRAGMA user_version = ${SUPPORTED_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function readVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  if (!row || typeof row.user_version !== 'number') {
    throw new Error('Could not read the database schema version');
  }
  return row.user_version;
}

function countRows(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
    | { count: number }
    | undefined;
  if (!row || typeof row.count !== 'number') {
    throw new Error(`Could not count rows in ${table}`);
  }
  return row.count;
}

function readRoom(db: DatabaseSync, id: string): RoomRow | null {
  return (db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) ?? null) as RoomRow | null;
}

function readChunk(db: DatabaseSync, id: string): ChunkRow | null {
  return (db.prepare('SELECT * FROM chunks WHERE id = ?').get(id) ?? null) as ChunkRow | null;
}

function readAnnotation(db: DatabaseSync, id: string): AnnotationRow | null {
  return (db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) ?? null) as
    | AnnotationRow
    | null;
}

type AdapterHooks = {
  failOperationsInsert?: boolean;
};

/**
 * Test adapter over `node:sqlite`. Production passes the open expo-sqlite
 * `SQLiteDatabase` directly; it satisfies this shape structurally.
 */
function createCommitDatabase(db: DatabaseSync, hooks: AdapterHooks = {}): CommitDatabase {
  return {
    async runAsync(sql: string, params: CommitSqlValue[]) {
      if (hooks.failOperationsInsert && /INSERT INTO operations/i.test(sql)) {
        throw new Error('simulated failure after the entity write');
      }
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes) };
    },
    async getFirstAsync<T>(sql: string, params: CommitSqlValue[]) {
      return (db.prepare(sql).get(...params) ?? null) as T | null;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

async function expectError<T extends CommitError>(
  action: () => Promise<unknown>,
  Expected: new (message: string) => T,
  label: string,
): Promise<T> {
  try {
    await action();
  } catch (error) {
    assert(
      error instanceof Expected,
      `${label} (threw ${error instanceof Error ? error.name : String(error)} instead)`,
    );
    return error;
  }
  throw new Error(`${label} (no error was thrown)`);
}

async function expectAnyError(action: () => Promise<unknown>, label: string): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error(`${label} (no error was thrown)`);
}

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ROOM_ID = '44444444-4444-4444-8444-444444444444';
const CHUNK_ID = '22222222-2222-4222-8222-222222222222';
const ANNOTATION_OP_ID = 'op-ai-annotation';
const ANNOTATION_ID = `annotation-${ANNOTATION_OP_ID}`;

async function main(): Promise<void> {
  assert(SUPPORTED_VERSION === 3, 'FND.2 should raise the supported schema version to 3');

  const db = new DatabaseSync(':memory:');
  applySchema(db);
  assert(readVersion(db) === 3, 'a fresh database should migrate to version 3');
  assert(countRows(db, 'operations') === 0, 'a fresh operations log should be empty');

  const commitDb = createCommitDatabase(db);

  const createRoom = {
    opId: 'op-room-create',
    kind: 'room.create',
    source: 'human',
    confirmed: true,
    expectedRevision: null,
    payload: { id: ROOM_ID, name: 'Stonehenge', stage: 'stonehenge' },
  } satisfies Operation;

  const createdRoom = await commitOperation(commitDb, createRoom);
  assert(createdRoom.entity === 'room', 'room.create should report a room result');
  assert(createdRoom.id === ROOM_ID, 'room.create should report the created id');
  assert(createdRoom.deleted === false, 'room.create should not be deleted');
  assert(createdRoom.replayed === false, 'the first commit should not be a replay');
  assert(countRows(db, 'rooms') === 1, 'room.create should write one room');
  assert(countRows(db, 'operations') === 1, 'room.create should log its operation');

  const firstRoom = readRoom(db, ROOM_ID);
  assert(firstRoom !== null, 'the created room should be readable');
  let roomRevision = firstRoom.updated_at;

  // Repeating an op id writes nothing and returns the original result.
  const replayedRoom = await commitOperation(commitDb, createRoom);
  assert(replayedRoom.replayed === true, 'a repeated op id should report a replay');
  assert(replayedRoom.id === createdRoom.id, 'a replay should return the stored result');
  assert(replayedRoom.kind === createdRoom.kind, 'a replay should return the stored kind');
  assert(countRows(db, 'rooms') === 1, 'a replay should not write a second room');
  assert(countRows(db, 'operations') === 1, 'a replay should not write a second operation');

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...createRoom,
        kind: 'room.delete',
        expectedRevision: 0,
        payload: { id: ROOM_ID },
      } as unknown as Operation),
    InvalidOperationError,
    'reusing an op id for a different kind should be rejected',
  );
  assert(countRows(db, 'rooms') === 1, 'a mismatched replay should not delete the room');

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...createRoom,
        opId: 'op-room-duplicate',
      }),
    InvalidOperationError,
    'creating a room whose id already exists should be rejected',
  );
  assert(countRows(db, 'rooms') === 1, 'a duplicate room create should not add a row');

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...createRoom,
        opId: 'op-room-create-with-revision',
        expectedRevision: 1,
      } as unknown as Operation),
    InvalidOperationError,
    'room.create with a non-null expected revision should be rejected',
  );

  const updateRoom = {
    opId: 'op-room-update',
    kind: 'room.update',
    source: 'human',
    confirmed: false,
    expectedRevision: roomRevision,
    payload: { id: ROOM_ID, name: 'Stonehenge II' },
  } satisfies Operation;
  await commitOperation(commitDb, updateRoom);
  const updatedRoom = readRoom(db, ROOM_ID);
  assert(updatedRoom !== null, 'the updated room should be readable');
  assert(updatedRoom.name === 'Stonehenge II', 'room.update should rename the room');
  assert(
    updatedRoom.updated_at > roomRevision,
    'room.update should advance the updated_at revision',
  );
  roomRevision = updatedRoom.updated_at;
  assert(countRows(db, 'operations') === 2, 'room.update should log its operation');

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...updateRoom,
        opId: 'op-room-update-stale',
        expectedRevision: firstRoom.updated_at,
        payload: { id: ROOM_ID, name: 'Stale name' },
      }),
    StaleRevisionError,
    'a stale room revision should be rejected',
  );
  assert(
    readRoom(db, ROOM_ID)?.name === 'Stonehenge II',
    'a stale room update should not change the row',
  );
  assert(
    countRows(db, 'operations') === 2,
    'a stale room update should not log an operation',
  );

  const chunkCreate = {
    opId: 'op-chunk-create',
    kind: 'chunk.create',
    source: 'import',
    confirmed: true,
    expectedRevision: roomRevision,
    payload: {
      id: CHUNK_ID,
      roomId: ROOM_ID,
      position: 0,
      content: 'First chunk',
      subjectTags: ['biology'],
      sourceLink: 'https://example.test/source',
    },
  } satisfies Operation;

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...chunkCreate,
        opId: 'op-chunk-create-missing-room',
        expectedRevision: 1,
        payload: { ...chunkCreate.payload, roomId: '99999999-9999-4999-8999-999999999999' },
      }),
    NotFoundError,
    'creating a chunk in a missing room should be rejected',
  );

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...chunkCreate,
        opId: 'op-chunk-create-stale',
        expectedRevision: firstRoom.updated_at,
      }),
    StaleRevisionError,
    'creating a chunk under a stale room revision should be rejected',
  );
  assert(countRows(db, 'chunks') === 0, 'rejected chunk creates should not write a chunk');

  await commitOperation(commitDb, chunkCreate);
  const chunk = readChunk(db, CHUNK_ID);
  assert(chunk !== null, 'the created chunk should be readable');
  assert(chunk.content === 'First chunk', 'the chunk content should round-trip');
  assert(chunk.subject_tags === '["biology"]', 'the chunk subject tags should round-trip');
  let chunkRevision = chunk.updated_at;
  assert(countRows(db, 'chunks') === 1, 'chunk.create should write one chunk');

  const aiOperation = {
    opId: ANNOTATION_OP_ID,
    kind: 'annotation.create',
    source: 'ai',
    confirmed: true,
    expectedRevision: chunkRevision,
    payload: {
      proposalId: 'proposal-1',
      roomId: ROOM_ID,
      chunkId: CHUNK_ID,
      noteId: 7,
      type: 'ai_answer',
      body: 'The answer',
      anchorStart: 0,
      anchorEnd: 5,
    },
  } satisfies Operation;

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...aiOperation,
        opId: 'op-ai-missing-chunk',
        payload: { ...aiOperation.payload, chunkId: '99999999-9999-4999-8999-999999999999' },
      }),
    NotFoundError,
    'annotating a missing chunk should be rejected',
  );

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...aiOperation,
        opId: 'op-ai-bad-type',
        payload: { ...aiOperation.payload, type: 'not_a_type' as never },
      }),
    InvalidOperationError,
    'an invalid annotation type should be rejected',
  );

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...aiOperation,
        opId: 'op-ai-anchor-inverted',
        payload: { ...aiOperation.payload, anchorStart: 5, anchorEnd: 3 },
      }),
    InvalidOperationError,
    'an annotation whose anchorStart is after anchorEnd should be rejected',
  );

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...aiOperation,
        opId: 'op-ai-anchor-past-end',
        payload: { ...aiOperation.payload, anchorStart: 0, anchorEnd: 999 },
      }),
    InvalidOperationError,
    'an annotation anchor past the end of the chunk should be rejected',
  );

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...aiOperation,
        opId: 'op-ai-anchor-half',
        payload: { ...aiOperation.payload, anchorEnd: undefined as never },
      }),
    InvalidOperationError,
    'supplying only one anchor should be rejected',
  );

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...aiOperation,
        opId: 'op-ai-anchor-negative',
        payload: { ...aiOperation.payload, anchorStart: -1, anchorEnd: 2 },
      }),
    InvalidOperationError,
    'a negative anchorStart should be rejected',
  );

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...aiOperation,
        opId: 'op-ai-other-room',
        payload: { ...aiOperation.payload, roomId: OTHER_ROOM_ID },
      }),
    InvalidOperationError,
    'an annotation claiming a different room than its chunk should be rejected',
  );
  assert(countRows(db, 'annotations') === 0, 'rejected annotations should not be written');

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...aiOperation,
        opId: 'op-ai-unconfirmed',
        confirmed: false,
      }),
    UnconfirmedAiWriteError,
    'an unconfirmed AI operation should be rejected',
  );
  assert(countRows(db, 'annotations') === 0, 'an unconfirmed AI write should not be written');
  assert(countRows(db, 'operations') === 3, 'an unconfirmed AI write should not be logged');

  const annotationResult = await commitOperation(commitDb, aiOperation);
  assert(annotationResult.entity === 'annotation', 'annotation.create should report an annotation');
  assert(annotationResult.id === ANNOTATION_ID, 'annotation id should derive from the op id');
  const annotation = readAnnotation(db, ANNOTATION_ID);
  assert(annotation !== null, 'the confirmed annotation should be readable');
  assert(annotation.chunk_id === CHUNK_ID, 'the annotation should point at its chunk');
  assert(annotation.type === 'ai_answer', 'the annotation type should round-trip');
  const annotationPayload = JSON.parse(annotation.payload) as Record<string, unknown>;
  assert(annotationPayload.proposalId === 'proposal-1', 'the proposal id should be stored');
  assert(annotationPayload.noteId === 7, 'the adapter note id should be stored');
  assert(annotationPayload.body === 'The answer', 'the answer body should be stored');
  assert(annotationPayload.anchorStart === 0, 'anchorStart should be stored in the payload');
  assert(annotationPayload.anchorEnd === 5, 'anchorEnd should be stored in the payload');
  assert(countRows(db, 'annotations') === 1, 'annotation.create should write one annotation');

  const replayedAnnotation = await commitOperation(commitDb, aiOperation);
  assert(replayedAnnotation.replayed === true, 'a repeated annotation op should report a replay');
  assert(countRows(db, 'annotations') === 1, 'a repeated annotation op should write nothing');

  const updateChunk = {
    opId: 'op-chunk-update',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: chunkRevision,
    payload: { id: CHUNK_ID, content: 'Updated chunk' },
  } satisfies Operation;
  await commitOperation(commitDb, updateChunk);
  const updatedChunk = readChunk(db, CHUNK_ID);
  assert(updatedChunk !== null, 'the updated chunk should be readable');
  assert(updatedChunk.content === 'Updated chunk', 'chunk.update should change the content');
  assert(
    updatedChunk.updated_at > chunkRevision,
    'chunk.update should advance the updated_at revision',
  );
  assert(
    updatedChunk.subject_tags === '["biology"]',
    'chunk.update should keep fields it was not given',
  );
  chunkRevision = updatedChunk.updated_at;

  await expectError(
    () =>
      commitOperation(commitDb, {
        ...updateChunk,
        opId: 'op-chunk-update-stale',
        expectedRevision: updatedChunk.updated_at - 1,
        payload: { id: CHUNK_ID, content: 'Stale chunk' },
      }),
    StaleRevisionError,
    'a stale chunk update should be rejected',
  );
  assert(
    readChunk(db, CHUNK_ID)?.content === 'Updated chunk',
    'a stale chunk update should not change the row',
  );

  // A failure after the entity write must roll back the entity too.
  const rollbackDb = new DatabaseSync(':memory:');
  applySchema(rollbackDb);
  const rollbackCommit = createCommitDatabase(rollbackDb);
  await commitOperation(rollbackCommit, createRoom);
  const rollbackRoom = readRoom(rollbackDb, ROOM_ID);
  assert(rollbackRoom !== null, 'the rollback fixture room should exist');
  await commitOperation(rollbackCommit, {
    ...chunkCreate,
    expectedRevision: rollbackRoom.updated_at,
  });
  const rollbackChunk = readChunk(rollbackDb, CHUNK_ID);
  assert(rollbackChunk !== null, 'the rollback fixture chunk should exist');
  const rollbackOperations = countRows(rollbackDb, 'operations');

  const failingCommit = createCommitDatabase(rollbackDb, { failOperationsInsert: true });
  const failure = await expectAnyError(
    () =>
      commitOperation(failingCommit, {
        opId: 'op-rollback',
        kind: 'annotation.create',
        source: 'human',
        confirmed: true,
        expectedRevision: rollbackChunk.updated_at,
        payload: { chunkId: CHUNK_ID, type: 'highlight', body: 'partial' },
      }),
    'a failing op-log write should fail the commit',
  );
  assert(
    failure instanceof Error && failure.message.includes('simulated'),
    'the simulated failure should surface',
  );
  assert(
    countRows(rollbackDb, 'annotations') === 0,
    'a failure after the annotation write should roll back the annotation',
  );
  assert(
    countRows(rollbackDb, 'operations') === rollbackOperations,
    'a failed commit should not log an operation',
  );
  rollbackDb.close();

  await commitOperation(commitDb, {
    opId: 'op-chunk-delete',
    kind: 'chunk.delete',
    source: 'human',
    confirmed: false,
    expectedRevision: chunkRevision,
    payload: { id: CHUNK_ID },
  });
  assert(countRows(db, 'chunks') === 0, 'chunk.delete should remove the chunk');
  assert(
    countRows(db, 'annotations') === 0,
    'chunk.delete should cascade to the annotations of that chunk',
  );

  await commitOperation(commitDb, {
    opId: 'op-room-delete',
    kind: 'room.delete',
    source: 'human',
    confirmed: false,
    expectedRevision: roomRevision,
    payload: { id: ROOM_ID },
  });
  assert(countRows(db, 'rooms') === 0, 'room.delete should remove the room');

  // Concurrent commits are serialized: different op ids both land, and a
  // repeated op id still writes exactly once.
  const concurrentA = '55555555-5555-4555-8555-555555555555';
  const concurrentB = '66666666-6666-4666-8666-666666666666';
  const [roomA, roomB] = await Promise.all([
    commitOperation(commitDb, {
      ...createRoom,
      opId: 'op-concurrent-a',
      payload: { id: concurrentA, name: 'Concurrent A', stage: 'brick' },
    }),
    commitOperation(commitDb, {
      ...createRoom,
      opId: 'op-concurrent-b',
      payload: { id: concurrentB, name: 'Concurrent B', stage: 'brick' },
    }),
  ]);
  assert(roomA.replayed === false && roomB.replayed === false, 'both concurrent writes should run');
  assert(countRows(db, 'rooms') === 2, 'both concurrent rooms should be written');

  const concurrentC = '77777777-7777-4777-8777-777777777777';
  const sameOp = {
    ...createRoom,
    opId: 'op-concurrent-same',
    payload: { id: concurrentC, name: 'Concurrent C', stage: 'stonehenge' },
  } satisfies Operation;
  const [firstAttempt, secondAttempt] = await Promise.all([
    commitOperation(commitDb, sameOp),
    commitOperation(commitDb, sameOp),
  ]);
  assert(
    firstAttempt.replayed === false && secondAttempt.replayed === true,
    'the second concurrent attempt at the same op id should replay',
  );
  assert(countRows(db, 'rooms') === 3, 'the repeated concurrent op id should write one room');

  // Shape and permission validation.
  await expectError(
    () => commitOperation(commitDb, { ...createRoom, opId: '   ' }),
    InvalidOperationError,
    'an empty op id should be rejected',
  );
  await expectError(
    () =>
      commitOperation(commitDb, {
        ...createRoom,
        opId: 'op-bad-source',
        source: 'robot' as never,
      }),
    InvalidOperationError,
    'an unknown source should be rejected',
  );
  await expectError(
    () =>
      commitOperation(commitDb, {
        ...createRoom,
        opId: 'op-bad-confirmed',
        confirmed: 'yes' as never,
      }),
    InvalidOperationError,
    'a non-boolean confirmed flag should be rejected',
  );
  await expectError(
    () =>
      commitOperation(commitDb, {
        ...createRoom,
        opId: 'op-bad-kind',
        kind: 'room.explode' as never,
      } as unknown as Operation),
    InvalidOperationError,
    'an unknown operation kind should be rejected',
  );

  db.close();

  // Migration 2 -> 3 must add the operations log without altering rooms.
  const upgraded = new DatabaseSync(':memory:');
  upgraded.exec(CONNECTION_PRAGMAS);
  for (const migration of MIGRATIONS.filter((candidate) => candidate.version <= 2)) {
    upgraded.exec(migration.sql);
  }
  upgraded.prepare(
    'INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(ROOM_ID, 'Kept room', 'brick', 10, 10);
  upgraded.exec('PRAGMA user_version = 2');
  applySchema(upgraded);
  assert(readVersion(upgraded) === 3, 'upgrading version 2 should reach version 3');
  assert(
    countRows(upgraded, 'operations') === 0,
    'upgrading should create an empty operations table',
  );
  assert(
    (upgraded.prepare('SELECT name FROM rooms WHERE id = ?').get(ROOM_ID) as { name: string })
      .name === 'Kept room',
    'migration 3 should keep existing rooms',
  );
  upgraded.close();

  console.log('commit checks passed (node:sqlite, not the Expo native driver)');
}

await main();
