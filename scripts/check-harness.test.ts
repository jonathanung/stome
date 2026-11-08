import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { pairingTtlMs, startCompanion } from '../companion/server.ts';
import { createCommit } from '../src/data/commit.ts';
import { getChunk, listAnnotations } from '../src/data/queries.ts';
import { citationFromAnnotation } from '../src/features/ask/citations.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { companionProvider } from '../src/harness/companionClient.ts';
import { nodeDb } from '../tests/support/node-db.ts';
import { serializedExecutor, type RawSql } from '../src/harness/serialized.ts';
import {
  SCAFFOLD_ROOM_ID,
  TOOL_REGISTRY,
  chunkViewFromFoundation,
  isStudyProposal,
  noteToChunk,
  type ChunkView,
  type StoredProposal,
} from '../src/harness/contract.ts';
import { createProvider, mockEditOutput, mockProvider, mockSuccessOutput } from '../src/harness/provider.ts';
import {
  beginQuestion,
  confirmFoundationQuestion,
  discardQuestion,
  fulfillQuestion,
} from '../src/harness/runTurn.ts';
import {
  HARNESS_MIGRATION_SQL,
  HARNESS_SCHEMA_VERSION,
  cancelRun,
  ensurePendingOperationId,
  repairOperationId,
  completeRun,
  createSession,
  failInterruptedSessions,
  getSession,
  migrateHarness,
  type SqlExecutor,
  type SqlParams,
} from '../src/harness/store.ts';
import {
  INSERT_NOTE_SQL,
  LIST_NOTES_SQL,
  MIGRATIONS,
  SUPPORTED_VERSION,
  migrationsFor,
} from '../src/db/schema.ts';

const SECRET = 'sk-test-do-not-leak-stome';

/** Notes-test helper: these sessions only ever propose notes answers or edits. */
function notesBody(proposal: StoredProposal | null | undefined): string | undefined {
  return proposal && !isStudyProposal(proposal) ? proposal.body : undefined;
}

/** Notes-test helper: the revision a notes proposal was grounded on. */
function notesRevision(proposal: StoredProposal | null | undefined): number | undefined {
  return proposal && !isStudyProposal(proposal) ? proposal.chunkRevision : undefined;
}

function openMemory(file = ':memory:'): SqlExecutor & { close(): void } {
  const raw = new DatabaseSync(file);
  const db: SqlExecutor & { close(): void } = {
    async exec(sql: string) {
      raw.exec(sql);
    },
    async get<T>(sql: string, params: SqlParams = []) {
      const row = raw.prepare(sql).get(...params);
      return (row as T | undefined) ?? null;
    },
    async all<T>(sql: string, params: SqlParams = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: SqlParams = []) {
      raw.prepare(sql).run(...params);
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const value = await fn(db);
        raw.exec('COMMIT');
        return value;
      } catch (error) {
        try {
          raw.exec('ROLLBACK');
        } catch {
          // SQLite may already have rolled the transaction back.
        }
        throw error;
      }
    },
    close() {
      raw.close();
    },
  };
  return db;
}

async function harnessDb(): Promise<SqlExecutor & { close(): void }> {
  const db = openMemory();
  await migrateHarness(db);
  return db;
}

function chunk(id: number, text = 'photosynthesis makes sugar', revision = 100, roomId = SCAFFOLD_ROOM_ID): ChunkView {
  return {
    id: `note:${id}`,
    roomId,
    noteId: id,
    label: `Note ${id}`,
    text,
    revision,
  };
}

test('registry is only the notes tools and rejects a foreign room', async () => {
  assert.deepEqual(Object.keys(TOOL_REGISTRY).sort(), ['notes.proposeAnnotation', 'notes.proposeChunkEdit'].sort());
  const harness = readFileSync(new URL('../src/harness/contract.ts', import.meta.url), 'utf8');
  assert.equal(harness.includes('child_process'), false);
  assert.equal(harness.includes('node:fs'), false);
  const db = await harnessDb();
  await assert.rejects(
    () => beginQuestion(db, { chunks: [chunk(1), chunk(2, 'other', 100, 'other-room')], prompt: 'Why?' }),
    /one room/,
  );
  const sessions = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM harness_sessions');
  assert.equal(sessions?.count, 0);
  db.close();
});

test('migration keeps the scaffold database untouched and creates no foundation tables', async () => {
  assert.ok(SUPPORTED_VERSION >= 2);
  assert.equal(migrationsFor(SUPPORTED_VERSION).length, 0);
  assert.equal(migrationsFor(1).length, MIGRATIONS.length - 1);
  assert.equal(HARNESS_MIGRATION_SQL.includes('CREATE TABLE rooms'), false);
  assert.equal(HARNESS_MIGRATION_SQL.includes('CREATE TABLE chunks'), false);
  assert.equal(HARNESS_MIGRATION_SQL.includes('CREATE TABLE annotations'), false);
  assert.equal(HARNESS_MIGRATION_SQL.includes('CREATE TABLE notes'), false);
  assert.equal(HARNESS_MIGRATION_SQL.includes('harness_stub_annotations'), false);

  const notes = openMemory();
  await notes.exec(MIGRATIONS[0]?.sql ?? '');
  await notes.exec('PRAGMA user_version = 1');
  const title = "Ada's note'); DROP TABLE notes; --";
  await notes.run(INSERT_NOTE_SQL, [title, 'quotes "stay"', 10, 10]);

  const harness = await harnessDb();
  await migrateHarness(harness);
  const version = await harness.get<{ user_version: number }>('PRAGMA user_version');
  assert.equal(version?.user_version, HARNESS_SCHEMA_VERSION);

  const selected = chunk(1, 'quotes "stay"', 10);
  const prepared = await beginQuestion(harness, { chunks: [selected], prompt: 'Summarize' });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'proposal');
  await discardQuestion(harness, prepared.sessionId);

  const rows = (await notes.all<{ title: string; body: string; updated_at: number }>(LIST_NOTES_SQL)) ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, title);
  assert.equal(rows[0]?.body, 'quotes "stay"');
  assert.equal(rows[0]?.updated_at, 10);
  const notesVersion = await notes.get<{ user_version: number }>('PRAGMA user_version');
  assert.equal(notesVersion?.user_version, 1);
  notes.close();
  harness.close();
});

test('the v3 harness migration drops legacy stub annotations and their cached operations', async () => {
  const db = openMemory();
  await db.exec(HARNESS_MIGRATION_SQL);
  await db.exec(`
    CREATE TABLE harness_stub_annotations (
      id TEXT PRIMARY KEY NOT NULL,
      proposal_id TEXT NOT NULL UNIQUE,
      operation_id TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      note_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type = 'ai_answer'),
      body TEXT NOT NULL,
      anchor_start INTEGER NOT NULL,
      anchor_end INTEGER NOT NULL,
      chunk_revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO harness_stub_annotations VALUES
      ('stub-legacy', 'proposal-legacy', 'legacy-op', 'room', 'note:1', 1, 'ai_answer', 'old mock', 0, 3, 1, 1);
    INSERT INTO harness_operations VALUES
      ('legacy-op', '{"replayed":false,"annotationId":"stub-legacy","operationId":"legacy-op"}', 1);
    INSERT INTO harness_operations VALUES
      ('real-op', '{"replayed":false,"annotationId":"ann-real","operationId":"real-op"}', 2);
    PRAGMA user_version = 2;
  `);

  await migrateHarness(db);
  const version = await db.get<{ user_version: number }>('PRAGMA user_version');
  assert.equal(version?.user_version, 3);
  const legacy = await db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'harness_stub_annotations'",
  );
  assert.equal(legacy, null);
  const stale = await db.get<{ id: string }>('SELECT id FROM harness_operations WHERE id = ?', ['legacy-op']);
  assert.equal(stale, null);
  const kept = await db.get<{ id: string }>('SELECT id FROM harness_operations WHERE id = ?', ['real-op']);
  assert.equal(kept?.id, 'real-op');
  db.close();
});

test('restart fails a running session, continuation uses saved context, and late results are discarded', async () => {
  const db = await harnessDb();
  const selected = chunk(1);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'First question' });
  const running = await getSession(db, prepared.sessionId);
  assert.equal(running?.state, 'running');
  const interrupted = await failInterruptedSessions(db, 500);
  assert.equal(interrupted, 1);
  const failed = await getSession(db, prepared.sessionId);
  assert.equal(failed?.state, 'failed');
  assert.equal(failed?.errorCode, 'interrupted');
  const late = await fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(late.status, 'discarded');
  assert.equal((await getSession(db, prepared.sessionId))?.proposal, null);

  const idle = await createSession(db, {
    id: 'idle-1',
    roomId: SCAFFOLD_ROOM_ID,
    selectedChunkIds: ['note:1'],
    now: 1,
  });
  assert.equal(idle.state, 'idle');
  await failInterruptedSessions(db, 2);
  assert.equal((await getSession(db, 'idle-1'))?.state, 'idle');

  const again = await beginQuestion(db, {
    chunks: [selected, chunk(9, 'not selected')],
    prompt: 'Continue please',
    continueSessionId: prepared.sessionId,
  });
  let seen = 0;
  const outcome = await fulfillQuestion(db, again, {
    chunks: [selected, chunk(9, 'not selected')],
    scenario: 'success',
    provider: {
      async complete(request) {
        const input = request.input as { chunks: { id: string }[]; priorMessages: unknown[] };
        seen = input.priorMessages.length;
        assert.deepEqual(input.chunks.map((item) => item.id), ['note:1']);
        return mockProvider.complete(request, new AbortController().signal);
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'proposal');
  assert.ok(seen >= 1);
  assert.match(notesBody(outcome.proposal) ?? '', /messages=1/);
  db.close();
});

test('cancellation discards a late success and leaves no annotation', async () => {
  const db = await harnessDb();
  const selected = chunk(1);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Wait' });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const signal = new AbortController();
  const pending = fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: {
      async complete(request, inner) {
        await gate;
        if (inner.aborted) {
          throw new Error('should be discarded by session state');
        }
        return mockSuccessOutput(request.input as never);
      },
    },
    signal: signal.signal,
  });
  const cancelled = await cancelRun(db, { sessionId: prepared.sessionId, runToken: prepared.runToken, now: 50 });
  assert.equal(cancelled, true);
  signal.abort();
  release?.();
  const outcome = await pending;
  assert.notEqual(outcome.status, 'proposal');
  assert.equal((await getSession(db, prepared.sessionId))?.state, 'cancelled');
  assert.equal((await getSession(db, prepared.sessionId))?.proposal, null);
  const stored = await completeRun(db, {
    sessionId: prepared.sessionId,
    runToken: prepared.runToken,
    proposal: {
      id: 'late',
      tool: 'notes.proposeAnnotation',
      roomId: SCAFFOLD_ROOM_ID,
      chunkId: 'note:1',
      noteId: 1,
      type: 'ai_answer',
      body: 'too late',
      anchorStart: 0,
      anchorEnd: 4,
      chunkRevision: 100,
    },
    operationId: 'late-op',
    messageId: 'late-message',
    now: 80,
  });
  assert.equal(stored, 'discarded');
  assert.equal((await getSession(db, prepared.sessionId))?.confirmedOperationId, null);
  db.close();
});

test('rejects unselected chunks, bad anchors, missing confirmation, and a stale revision', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const db = await harnessDb();
  let seed = 0;
  const commit = createCommit(app, { now: () => 100, newId: () => `id-${++seed}` });
  const room = await commit({
    opId: 'gate-room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'gate-chunks',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar', 'a second chunk'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const first = await getChunk(app, created.value.chunkIds[0] ?? '');
  const second = await getChunk(app, created.value.chunkIds[1] ?? '');
  assert.ok(first && second);
  if (!first || !second) return;
  const selected = chunkViewFromFoundation(first);

  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Explain' });
  const outsider = await fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: {
      async complete() {
        return {
          roomId: second.roomId,
          chunkId: second.id,
          type: 'ai_answer',
          body: 'wrong chunk',
          anchorStart: 0,
          anchorEnd: 4,
        };
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(outsider.status, 'failed');
  assert.equal(outsider.errorCode, 'scope_rejected');

  const next = await beginQuestion(db, { chunks: [selected], prompt: 'Again' });
  const malformed = await fulfillQuestion(db, next, {
    chunks: [selected],
    scenario: 'success',
    provider: {
      async complete() {
        return {
          roomId: first.roomId,
          chunkId: first.id,
          type: 'ai_answer',
          body: 'bad anchor',
          anchorStart: 0,
          anchorEnd: 999,
        };
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(malformed.status, 'failed');
  assert.equal(malformed.errorCode, 'bad_anchor');

  const third = await beginQuestion(db, { chunks: [selected], prompt: 'Third' });
  const proposed = await fulfillQuestion(db, third, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(proposed.status, 'proposal');
  const operationId = proposed.session?.pendingOperationId ?? '';
  await assert.rejects(
    () =>
      confirmFoundationQuestion(db, app, {
        sessionId: third.sessionId,
        operationId,
        confirmed: false,
      }),
    /confirm/,
  );
  const edited = await commit({
    opId: 'gate-edit',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: first.revision,
    payload: { chunkId: first.id, body: 'a newer version of the chunk' },
  });
  assert.equal(edited.ok, true);
  await assert.rejects(
    () =>
      confirmFoundationQuestion(db, app, {
        sessionId: third.sessionId,
        operationId,
        confirmed: true,
      }),
    /changed/,
  );
  assert.equal((await listAnnotations(app, first.id)).length, 0);
  assert.equal((await getSession(db, third.sessionId))?.confirmedOperationId, null);
  db.close();
  app.close();
});

test('operation id dedupe returns the first annotation and a failed commit rolls back', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const db = await harnessDb();
  let seed = 0;
  const commit = createCommit(app, { now: () => 100, newId: () => `dedupe-${++seed}` });
  const room = await commit({
    opId: 'dedupe-room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'dedupe-chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  assert.ok(savedChunk);
  if (!savedChunk) return;
  const selected = chunkViewFromFoundation(savedChunk);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Save this' });
  const proposed = await fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.ok(proposed.proposal);
  const operationId = proposed.session?.pendingOperationId ?? '';
  const first = await confirmFoundationQuestion(db, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
  });
  assert.equal(first.replayed, false);
  const replay = await confirmFoundationQuestion(db, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.annotationId, first.annotationId);
  const rows = await listAnnotations(app, savedChunk.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.payload.answer, notesBody(proposed.proposal));
  assert.equal((await getSession(db, prepared.sessionId))?.confirmedOperationId, operationId);

  await assert.rejects(
    () =>
      confirmFoundationQuestion(db, app, {
        sessionId: prepared.sessionId,
        operationId: 'op-other',
        confirmed: true,
      }),
    /matches|saved/,
  );
  assert.equal((await listAnnotations(app, savedChunk.id)).length, 1);

  const rollbackApp = nodeDb();
  await migrateDb(rollbackApp);
  const rollbackHarness = await harnessDb();
  const rollbackSetup = createCommit(rollbackApp, { now: () => 100, newId: () => `rollback-${++seed}` });
  const rollbackRoom = await rollbackSetup({
    opId: 'rollback-room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(rollbackRoom.ok, true);
  if (!rollbackRoom.ok) return;
  const rollbackCreated = await rollbackSetup({
    opId: 'rollback-chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: rollbackRoom.value.roomId, bodies: ['rollback text'] },
  });
  assert.equal(rollbackCreated.ok, true);
  if (!rollbackCreated.ok) return;
  const rollbackChunk = await getChunk(rollbackApp, rollbackCreated.value.chunkIds[0] ?? '');
  assert.ok(rollbackChunk);
  if (!rollbackChunk) return;
  const other = chunkViewFromFoundation(rollbackChunk);
  const started = await beginQuestion(rollbackHarness, { chunks: [other], prompt: 'Roll back' });
  const ready = await fulfillQuestion(rollbackHarness, started, {
    chunks: [other],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(ready.status, 'proposal');
  const rollbackId = ready.session?.pendingOperationId ?? '';
  await rollbackApp.exec(`
    CREATE TRIGGER abort_operation BEFORE INSERT ON applied_ops
    BEGIN
      SELECT RAISE(ABORT, 'injected failure');
    END;
  `);
  await assert.rejects(
    () =>
      confirmFoundationQuestion(rollbackHarness, rollbackApp, {
        sessionId: started.sessionId,
        operationId: rollbackId,
        confirmed: true,
      }),
    /injected failure/,
  );
  assert.equal((await listAnnotations(rollbackApp, rollbackChunk.id)).length, 0);
  const applied = await rollbackApp.get<{ count: number }>('SELECT COUNT(*) AS count FROM applied_ops WHERE op_id = ?', [
    rollbackId,
  ]);
  assert.equal(applied?.count, 0);
  const operations = await rollbackHarness.get<{ count: number }>('SELECT COUNT(*) AS count FROM harness_operations');
  assert.equal(operations?.count, 0);
  assert.equal((await getSession(rollbackHarness, started.sessionId))?.confirmedOperationId, null);
  db.close();
  app.close();
  rollbackHarness.close();
  rollbackApp.close();
});

test('mock scenarios, timeout, output limit, and the disabled api-key provider', async () => {
  const input = {
    roomId: SCAFFOLD_ROOM_ID,
    prompt: 'Why?',
    chunks: [{ id: 'note:1', roomId: SCAFFOLD_ROOM_ID, text: 'photosynthesis makes sugar' }],
    priorMessages: [],
  };
  const success = mockSuccessOutput(input);
  assert.equal(success.body, 'Mock answer (note:1; messages=0): Why?');
  assert.equal(success.anchorEnd, 12);

  const db = await harnessDb();
  for (const scenario of ['timeout', 'error', 'oversize'] as const) {
    const prepared = await beginQuestion(db, { chunks: [chunk(1)], prompt: 'Why?' });
    const outcome = await fulfillQuestion(db, prepared, {
      chunks: [chunk(1)],
      scenario,
      provider: mockProvider,
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, 'failed', scenario);
    assert.equal((await getSession(db, prepared.sessionId))?.confirmedOperationId, null);
  }

  const hung = await beginQuestion(db, { chunks: [chunk(1)], prompt: 'Hang' });
  const timed = await fulfillQuestion(db, hung, {
    chunks: [chunk(1)],
    scenario: 'success',
    provider: {
      complete(_request, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    },
    signal: new AbortController().signal,
    timeoutMs: 20,
  });
  assert.equal(timed.status, 'failed');
  assert.equal(timed.errorCode, 'timeout');

  const huge = chunk(1, 'x'.repeat(8_001));
  const limited = await beginQuestion(db, { chunks: [huge], prompt: 'Too big' });
  const rejected = await fulfillQuestion(db, limited, {
    chunks: [huge],
    scenario: 'success',
    provider: {
      async complete() {
        throw new Error('provider should not run');
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(rejected.errorCode, 'request_limit');

  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error('live fetch');
  }) as typeof fetch;
  try {
    await assert.rejects(() => createProvider('api-key').complete({ tool: 'notes.proposeAnnotation', input, scenario: 'success' }, new AbortController().signal), /disabled/);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetches, 0);
  await discardQuestion(db, limited.sessionId);
  db.close();
});

test('a second confirmed turn survives reopen and the first operation id still replays', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stome-harness-'));
  const appPath = join(dir, 'app.db');
  const path = join(dir, 'harness.db');
  const app = nodeDb(appPath);
  await migrateDb(app);
  const firstDb = openMemory(path);
  await migrateHarness(firstDb);
  let seed = 0;
  const commit = createCommit(app, { now: () => 1_000, newId: () => `reopen-${++seed}` });
  const room = await commit({
    opId: 'reopen-room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'reopen-chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  assert.ok(savedChunk);
  if (!savedChunk) return;
  const selected = chunkViewFromFoundation(savedChunk);
  const prepared = await beginQuestion(firstDb, { chunks: [selected], prompt: 'First question' });
  const proposed = await fulfillQuestion(firstDb, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(proposed.status, 'proposal');
  const firstId = proposed.session?.pendingOperationId ?? '';
  const saved = await confirmFoundationQuestion(firstDb, app, {
    sessionId: prepared.sessionId,
    operationId: firstId,
    confirmed: true,
    now: 2_000,
  });
  assert.equal(saved.replayed, false);
  firstDb.close();
  app.close();

  const reopenedApp = nodeDb(appPath);
  const reopened = openMemory(path);
  await migrateHarness(reopened);
  const interrupted = await failInterruptedSessions(reopened, 50);
  assert.equal(interrupted, 0);
  const session = await getSession(reopened, prepared.sessionId);
  assert.equal(session?.state, 'completed');
  assert.equal(session?.confirmedOperationId, firstId);
  const continued = await beginQuestion(reopened, {
    chunks: [selected],
    prompt: 'Second question',
    continueSessionId: prepared.sessionId,
  });
  const second = await fulfillQuestion(reopened, continued, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(second.status, 'proposal');
  assert.notEqual(second.proposal?.id, proposed.proposal?.id);
  assert.match(notesBody(second.proposal) ?? '', /Second question/);
  const secondId = second.session?.pendingOperationId ?? '';
  const savedAgain = await confirmFoundationQuestion(reopened, reopenedApp, {
    sessionId: continued.sessionId,
    operationId: secondId,
    confirmed: true,
    now: 3_000,
  });
  assert.equal(savedAgain.replayed, false);
  const rows = await listAnnotations(reopenedApp, savedChunk.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.payload.answer),
    [notesBody(proposed.proposal), notesBody(second.proposal)],
  );
  const replay = await confirmFoundationQuestion(reopened, reopenedApp, {
    sessionId: continued.sessionId,
    operationId: firstId,
    confirmed: true,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.annotationId, saved.annotationId);
  await assert.rejects(
    () =>
      confirmFoundationQuestion(reopened, reopenedApp, {
        sessionId: continued.sessionId,
        operationId: 'op-third',
        confirmed: true,
      }),
    /operation id|saved/,
  );
  assert.equal((await listAnnotations(reopenedApp, savedChunk.id)).length, 2);
  reopened.close();
  reopenedApp.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a missing saved note fails the run instead of leaving it running', async () => {
  const db = await harnessDb();
  const selected = chunk(1);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Where is it' });
  let called = 0;
  const outcome = await fulfillQuestion(db, prepared, {
    chunks: [],
    scenario: 'success',
    provider: {
      async complete() {
        called += 1;
        throw new Error('the provider must not run');
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(called, 0);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'not_found');
  assert.equal((await getSession(db, prepared.sessionId))?.state, 'failed');
  db.close();
});

test('one queue per database keeps unrelated work out of an open transaction', async () => {
  const rawDb = new DatabaseSync(':memory:');
  const raw: RawSql = {
    async exec(sql) {
      rawDb.exec(sql);
    },
    async get<T>(sql: string, params: SqlParams = []) {
      return (rawDb.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async all<T>(sql: string, params: SqlParams = []) {
      return rawDb.prepare(sql).all(...params) as T[];
    },
    async run(sql, params = []) {
      rawDb.prepare(sql).run(...params);
    },
  };
  const first = serializedExecutor(raw);
  const second = serializedExecutor(raw);
  assert.equal(first, second);
  await migrateHarness(first);
  await createSession(first, {
    id: 'queue-1',
    roomId: SCAFFOLD_ROOM_ID,
    selectedChunkIds: ['note:1'],
    now: 1,
  });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  const held = first.transaction(async (tx) => {
    await tx.run("UPDATE harness_sessions SET error_message = 'inside' WHERE id = ?", ['queue-1']);
    started = true;
    await gate;
    const row = await tx.get<{ error_message: string | null }>(
      'SELECT error_message FROM harness_sessions WHERE id = ?',
      ['queue-1'],
    );
    assert.equal(row?.error_message, 'inside');
  });
  while (!started) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  let outsiderDone = false;
  const outsider = second
    .run("UPDATE harness_sessions SET error_message = 'outside' WHERE id = ?", ['queue-1'])
    .then(() => {
      outsiderDone = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(outsiderDone, false);
  release?.();
  await held;
  await outsider;
  const after = await first.get<{ error_message: string | null }>(
    'SELECT error_message FROM harness_sessions WHERE id = ?',
    ['queue-1'],
  );
  assert.equal(after?.error_message, 'outside');
  const expo = readFileSync(new URL('../src/harness/expoDb.ts', import.meta.url), 'utf8');
  assert.equal(expo.includes('depth'), false);
  assert.match(expo, /serializedExecutor/);
  rawDb.close();
});

test('confirm, discard, and a duplicate operation stay atomic on the shared queue', async () => {
  const rawDb = new DatabaseSync(':memory:');
  const db = serializedExecutor({
    async exec(sql) {
      rawDb.exec(sql);
    },
    async get<T>(sql: string, params: SqlParams = []) {
      return (rawDb.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async all<T>(sql: string, params: SqlParams = []) {
      return rawDb.prepare(sql).all(...params) as T[];
    },
    async run(sql, params = []) {
      rawDb.prepare(sql).run(...params);
    },
  });
  await migrateHarness(db);
  const app = nodeDb();
  await migrateDb(app);
  let seed = 0;
  const setup = createCommit(app, { now: () => 100, newId: () => `race-${++seed}` });
  const room = await setup({
    opId: 'race-room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await setup({
    opId: 'race-chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar', 'other note text'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const raceChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  const secondChunk = await getChunk(app, created.value.chunkIds[1] ?? '');
  assert.ok(raceChunk && secondChunk);
  if (!raceChunk || !secondChunk) return;

  const selected = chunkViewFromFoundation(raceChunk);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Race' });
  const proposed = await fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(proposed.status, 'proposal');
  const operationId = proposed.session?.pendingOperationId ?? '';
  const confirmation = confirmFoundationQuestion(db, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
  });
  const duplicate = confirmFoundationQuestion(db, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
  });
  const discard = discardQuestion(db, prepared.sessionId, 80);
  const settled = await Promise.allSettled([confirmation, duplicate, discard]);
  const rows = await listAnnotations(app, raceChunk.id);
  const session = await getSession(db, prepared.sessionId);
  const operations = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM harness_operations');
  assert.ok(rows.length <= 1);
  assert.equal(operations?.count, rows.length);
  if (rows.length === 1) {
    assert.equal(session?.confirmedOperationId, operationId);
    const writes = settled.filter(
      (item) => item.status === 'fulfilled' && item.value && typeof item.value === 'object' && 'annotationId' in item.value,
    );
    assert.equal(writes.length, 2);
  } else {
    assert.equal(session?.confirmedOperationId, null);
  }
  for (const item of settled) {
    if (item.status === 'rejected') {
      assert.match(String(item.reason), /proposal|operation id|already saved/);
    }
  }

  const other = await harnessDb();
  const otherApp = nodeDb();
  await migrateDb(otherApp);
  const otherSetup = createCommit(otherApp, { now: () => 100, newId: () => `other-${++seed}` });
  const otherRoom = await otherSetup({
    opId: 'other-room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(otherRoom.ok, true);
  if (!otherRoom.ok) return;
  const otherCreated = await otherSetup({
    opId: 'other-chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: otherRoom.value.roomId, bodies: ['other note text'] },
  });
  assert.equal(otherCreated.ok, true);
  if (!otherCreated.ok) return;
  const otherChunk = await getChunk(otherApp, otherCreated.value.chunkIds[0] ?? '');
  assert.ok(otherChunk);
  if (!otherChunk) return;
  const again = chunkViewFromFoundation(otherChunk);
  const started = await beginQuestion(other, { chunks: [again], prompt: 'Discard wins' });
  const ready = await fulfillQuestion(other, started, {
    chunks: [again],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(ready.status, 'proposal');
  const discardId = ready.session?.pendingOperationId ?? '';
  await discardQuestion(other, started.sessionId, 90);
  await assert.rejects(
    () =>
      confirmFoundationQuestion(other, otherApp, {
        sessionId: started.sessionId,
        operationId: discardId,
        confirmed: true,
      }),
    /proposal|operation id/,
  );
  assert.equal((await listAnnotations(otherApp, otherChunk.id)).length, 0);
  other.close();
  otherApp.close();
  app.close();
  rawDb.close();
});

test('completion and cancel on the shared queue leave no annotation', async () => {
  const rawDb = new DatabaseSync(':memory:');
  const db = serializedExecutor({
    async exec(sql) {
      rawDb.exec(sql);
    },
    async get<T>(sql: string, params: SqlParams = []) {
      return (rawDb.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async all<T>(sql: string, params: SqlParams = []) {
      return rawDb.prepare(sql).all(...params) as T[];
    },
    async run(sql, params = []) {
      rawDb.prepare(sql).run(...params);
    },
  });
  await migrateHarness(db);
  const selected = chunk(1);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Overlap' });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const signal = new AbortController();
  const pending = fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: {
      async complete(request, inner) {
        await gate;
        if (inner.aborted) {
          throw new Error('aborted');
        }
        return mockSuccessOutput(request.input as never);
      },
    },
    signal: signal.signal,
  });
  const cancelled = cancelRun(db, { sessionId: prepared.sessionId, runToken: prepared.runToken, now: 60 });
  signal.abort();
  release?.();
  const [didCancel, outcome] = await Promise.all([cancelled, pending]);
  assert.equal(didCancel, true);
  assert.notEqual(outcome.status, 'proposal');
  assert.equal((await getSession(db, prepared.sessionId))?.state, 'cancelled');
  assert.equal((await getSession(db, prepared.sessionId))?.proposal, null);
  assert.equal((await getSession(db, prepared.sessionId))?.confirmedOperationId, null);
  rawDb.close();
});

test('the companion client sends the token only to loopback http', async () => {
  let fetches = 0;
  let seenUrl = '';
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    fetches += 1;
    seenUrl = String(url);
    return new Response(JSON.stringify({ ok: true, output: { roomId: 'x' } }), { status: 200 });
  }) as typeof fetch;
  const input = {
    tool: 'notes.proposeAnnotation' as const,
    input: { roomId: SCAFFOLD_ROOM_ID, prompt: 'x', chunks: [], priorMessages: [] },
    scenario: 'success' as const,
  };
  try {
    for (const baseUrl of [
      'https://127.0.0.1:8787',
      'https://[::1]:8787',
      'http://evil.example:8787',
      'http://user:pass@127.0.0.1:8787',
      'http://user:pass@[::1]:8787',
      'http://127.0.0.1.evil.example:8787',
      'http://[2001:db8::1]:8787',
      'http://[::ffff:127.0.0.1]:8787',
      'http://[::ffff:7f00:1]:8787',
      'http://[::2]:8787',
      'file:///tmp/stome',
      'not a url',
    ]) {
      await assert.rejects(
        () => companionProvider({ baseUrl, token: 'secret-token' }).complete(input, new AbortController().signal),
        /companion/,
      );
    }
    assert.equal(fetches, 0);
    await companionProvider({ baseUrl: 'http://127.0.0.1:8787/ignored', token: 'secret-token' }).complete(
      input,
      new AbortController().signal,
    );
    assert.equal(fetches, 1);
    assert.equal(seenUrl, 'http://127.0.0.1:8787/v1/tool');
    await companionProvider({ baseUrl: 'http://localhost:8787', token: 'secret-token' }).complete(
      input,
      new AbortController().signal,
    );
    assert.equal(fetches, 2);
    assert.equal(seenUrl, 'http://localhost:8787/v1/tool');
    await companionProvider({ baseUrl: 'http://[::1]:8787/ignored', token: 'secret-token' }).complete(
      input,
      new AbortController().signal,
    );
    assert.equal(fetches, 3);
    assert.equal(seenUrl, 'http://[::1]:8787/v1/tool');
    await companionProvider({ baseUrl: 'http://[0:0:0:0:0:0:0:1]:8787', token: 'secret-token' }).complete(
      input,
      new AbortController().signal,
    );
    assert.equal(fetches, 4);
    assert.equal(seenUrl, 'http://[::1]:8787/v1/tool');
  } finally {
    globalThis.fetch = original;
  }
});

test('the CLI pairing deadline is fixed at startup and a bad ttl does not listen', async () => {
  assert.equal(pairingTtlMs(undefined), 2 * 60 * 60 * 1000);
  assert.throws(() => pairingTtlMs('0'), /STOME_PAIRING_TTL_MS/);
  assert.throws(() => pairingTtlMs('-5'), /STOME_PAIRING_TTL_MS/);
  assert.throws(() => pairingTtlMs('nope'), /STOME_PAIRING_TTL_MS/);
  assert.throws(() => pairingTtlMs('Infinity'), /STOME_PAIRING_TTL_MS/);

  const rejected = await runCli({
    STOME_PAIRING_TTL_MS: '0',
    STOME_PAIRING_TOKEN: 'should-not-listen',
    STOME_COMPANION_PORT: '0',
  });
  assert.notEqual(rejected.code, 0);
  assert.equal(rejected.stdout.includes('listening'), false);

  const ttl = 700;
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--import', './scripts/register-harness.mjs', 'companion/server.ts'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        STOME_PAIRING_TTL_MS: String(ttl),
        STOME_PAIRING_TOKEN: 'cli-pair-token',
        STOME_COMPANION_PORT: '0',
        STOME_APP_ORIGIN: 'http://localhost:8081',
        STOME_PROVIDER: 'mock',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const listening = await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CLI did not listen\n${stdout}\n${stderr}`)), 8000);
    const poll = setInterval(() => {
      if (stdout.includes('listening')) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }
    }, 20);
    child.once('exit', (code) => {
      clearTimeout(timer);
      clearInterval(poll);
      reject(new Error(`CLI exited ${code} before listening\n${stdout}\n${stderr}`));
    });
  });
  assert.equal(listening, undefined);
  const port = Number(stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1]);
  const deadline = Number(stdout.match(/Pairing deadline: (\d+)/)?.[1]);
  assert.ok(port > 0);
  assert.ok(deadline > 0);
  const body = JSON.stringify({
    tool: 'notes.proposeAnnotation',
    scenario: 'success',
    input: {
      roomId: SCAFFOLD_ROOM_ID,
      prompt: 'Why?',
      chunks: [{ id: 'note:1', roomId: SCAFFOLD_ROOM_ID, text: 'photosynthesis makes sugar' }],
      priorMessages: [],
    },
  });
  try {
    const fresh = await post(`http://127.0.0.1:${port}`, {
      origin: 'http://localhost:8081',
      token: 'cli-pair-token',
      body,
    });
    assert.equal(fresh.status, 200);
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, remaining) + 150));
    const stale = await post(`http://127.0.0.1:${port}`, {
      origin: 'http://localhost:8081',
      token: 'cli-pair-token',
      body,
    });
    assert.equal(stale.status, 401);
    assert.match(stale.text, /expired/);
    assert.equal(stale.text.includes('cli-pair-token'), false);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});

test('companion allows only the configured origin, token, and loopback host', async () => {
  process.env.STOME_PROVIDER_API_KEY = SECRET;
  const companion = await startCompanion({
    origin: 'http://localhost:8081',
    token: 'pair-token-secret-value',
    expiresAt: Date.now() + 60_000,
    provider: mockProvider,
  });
  assert.equal(new URL(companion.url).hostname, '127.0.0.1');
  const body = JSON.stringify({
    tool: 'notes.proposeAnnotation',
    scenario: 'success',
    input: {
      roomId: SCAFFOLD_ROOM_ID,
      prompt: 'Why?',
      chunks: [{ id: 'note:1', roomId: SCAFFOLD_ROOM_ID, text: 'photosynthesis makes sugar' }],
      priorMessages: [],
    },
  });
  const ok = await post(companion.url, {
    origin: 'http://localhost:8081',
    token: companion.token,
    body,
  });
  assert.equal(ok.status, 200);
  assert.match(ok.text, /Mock answer/);
  assert.equal(ok.text.includes(SECRET), false);
  assert.equal(ok.text.includes(companion.token), false);

  const wrongOrigin = await post(companion.url, { origin: 'http://evil.example', token: companion.token, body });
  assert.equal(wrongOrigin.status, 403);
  const noOrigin = await post(companion.url, { token: companion.token, body });
  assert.equal(noOrigin.status, 200);
  assert.match(noOrigin.text, /Mock answer/);
  const suffix = await post(companion.url, {
    origin: 'http://localhost:8081.evil.example',
    token: companion.token,
    body,
  });
  assert.equal(suffix.status, 403);
  const wrongToken = await post(companion.url, {
    origin: 'http://localhost:8081',
    token: 'nope',
    body,
  });
  assert.equal(wrongToken.status, 401);
  assert.equal(wrongToken.text.includes(companion.token), false);

  const badHost = await rawPost(companion.port, {
    host: 'evil.example',
    origin: 'http://localhost:8081',
    token: companion.token,
    body,
  });
  assert.equal(badHost.status, 403);

  const expired = await startCompanion({
    origin: 'http://localhost:8081',
    token: 'expired-token',
    expiresAt: Date.now() - 1,
    provider: mockProvider,
  });
  const stale = await post(expired.url, { origin: 'http://localhost:8081', token: expired.token, body });
  assert.equal(stale.status, 401);
  assert.match(stale.text, /expired/);

  const screens = readFileSync(new URL('../src/screens/HarnessPanel.tsx', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/harness/companionClient.ts', import.meta.url), 'utf8');
  assert.equal(screens.includes('localStorage'), false);
  assert.equal(screens.includes('sessionStorage'), false);
  assert.equal(client.includes('STOME_PROVIDER_API_KEY'), false);
  assert.equal(noteToChunk({ id: 3, title: 'T', body: 'body', updatedAt: 4 }).id, 'note:3');
  assert.equal(randomUUID().length > 0, true);

  await companion.close();
  await expired.close();
});

function runCli(env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--import', './scripts/register-harness.mjs', 'companion/server.ts'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, STOME_PROVIDER: 'mock', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 4000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test('a confirmed chunk answer is one ai annotation and the same operation id adds nothing', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  const commit = createCommit(app, {
    now: () => 5_000,
    newId: () => 'room-or-chunk',
  });
  const room = await commit({
    opId: 'room-1',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk-1',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  assert.ok(savedChunk);
  if (!savedChunk) return;
  const view = chunkViewFromFoundation(savedChunk);
  const prepared = await beginQuestion(harness, { chunks: [view], prompt: 'Why sugar?' });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [view],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'proposal');
  const operationId = outcome.session?.pendingOperationId ?? '';
  assert.ok(operationId);
  const saved = await confirmFoundationQuestion(harness, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
    now: 6_000,
  });
  assert.equal(saved.replayed, false);
  const again = await confirmFoundationQuestion(harness, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
    now: 7_000,
  });
  assert.equal(again.replayed, true);
  assert.equal(again.annotationId, saved.annotationId);
  const pins = await listAnnotations(app, savedChunk.id);
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.type, 'ai_answer');
  assert.deepEqual(pins[0]?.anchor, { start: 0, end: 12 });
  assert.equal(pins[0]?.payload.answer, notesBody(outcome.proposal));
  assert.equal(pins[0]?.payload.quote, 'photosynthes');
  assert.equal(pins[0]?.payload.chunkRevision, savedChunk.revision);
  const after = await getChunk(app, savedChunk.id);
  assert.equal(after?.body, 'photosynthesis makes sugar');
  assert.equal(after?.revision, savedChunk.revision);
  assert.equal(await harness.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'harness_stub_annotations'"), null);
  const applied = await app.get<{ source: string }>('SELECT source FROM applied_ops WHERE op_id = ?', [operationId]);
  assert.equal(applied?.source, 'ai');

  const edited = await commit({
    opId: 'edit-1',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: savedChunk.revision,
    payload: { chunkId: savedChunk.id, body: 'photosynthesis makes sugar now' },
  });
  assert.equal(edited.ok, true);
  const continued = await beginQuestion(harness, {
    chunks: [chunkViewFromFoundation((await getChunk(app, savedChunk.id))!)],
    prompt: 'Say more',
    continueSessionId: prepared.sessionId,
  });
  const second = await fulfillQuestion(harness, continued, {
    chunks: [chunkViewFromFoundation((await getChunk(app, savedChunk.id))!)],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(second.status, 'proposal');
  const secondId = second.session?.pendingOperationId ?? '';
  const pinned = await confirmFoundationQuestion(harness, app, {
    sessionId: prepared.sessionId,
    operationId: secondId,
    confirmed: true,
    now: 8_000,
  });
  assert.equal(pinned.replayed, false);
  assert.equal((await listAnnotations(app, savedChunk.id)).length, 2);
  const firstAgain = await confirmFoundationQuestion(harness, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
    now: 9_000,
  });
  assert.equal(firstAgain.replayed, true);
  assert.equal((await listAnnotations(app, savedChunk.id)).length, 2);

  const demo = await beginQuestion(harness, { chunks: [chunk(1)], prompt: 'Old demo' });
  const demoRun = await fulfillQuestion(harness, demo, {
    chunks: [chunk(1)],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(demoRun.status, 'proposal');
  await assert.rejects(
    () =>
      confirmFoundationQuestion(harness, app, {
        sessionId: demo.sessionId,
        operationId: demoRun.session?.pendingOperationId ?? '',
        confirmed: true,
      }),
    /demo note/,
  );
  assert.equal((await listAnnotations(app, savedChunk.id)).length, 2);
  app.close();
  harness.close();
});

test('a same-length edit after pin is not reloaded as the original citation', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  let groundId = 0;
  const commit = createCommit(app, { now: () => 5_000, newId: () => `ground-${++groundId}` });
  const room = await commit({ opId: 'ground-room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' } });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const original = 'photosynthesis makes sugar';
  const created = await commit({
    opId: 'ground-chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: [original] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  assert.ok(savedChunk);
  if (!savedChunk) return;
  const prepared = await beginQuestion(harness, { chunks: [chunkViewFromFoundation(savedChunk)], prompt: 'Why sugar?' });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [chunkViewFromFoundation(savedChunk)],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'proposal');
  await confirmFoundationQuestion(harness, app, {
    sessionId: prepared.sessionId,
    operationId: outcome.session?.pendingOperationId ?? '',
    confirmed: true,
    now: 6_000,
  });
  const pinned = (await listAnnotations(app, savedChunk.id))[0];
  assert.equal(pinned?.payload.quote, original.slice(0, 12));
  const mutated = `${'X'.repeat(12)}${original.slice(12)}`;
  const edited = await commit({
    opId: 'ground-edit',
    kind: 'chunk.update',
    source: 'ai',
    confirmed: true,
    expectedRevision: savedChunk.revision,
    payload: { chunkId: savedChunk.id, body: mutated },
  });
  assert.equal(edited.ok, true);
  const reloadedChunk = await getChunk(app, savedChunk.id);
  const reloadedPin = (await listAnnotations(app, savedChunk.id))[0];
  const read = citationFromAnnotation(reloadedChunk?.body ?? '', reloadedPin?.anchor, reloadedPin?.payload);
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.equal(read.savedQuote, 'photosynthes');
    assert.equal(read.message.includes(mutated.slice(0, 12)), false);
  }
  app.close();
  harness.close();
});

test('the mock can cite a deep marker and rewrite a same-length opening', () => {
  const text = `Note 02 open${'y'.repeat(40)}\nDEEP-ANCHOR.\n`;
  const chunk = { id: 'chunk-deep', roomId: 'room-1', text };
  const deep = mockSuccessOutput({
    roomId: 'room-1',
    prompt: 'Cite the deep passage.',
    chunks: [chunk],
    priorMessages: [],
  });
  assert.equal(text.slice(deep.anchorStart, deep.anchorEnd), 'DEEP-ANCHOR.');
  assert.ok(deep.anchorStart > 12);
  const ordinary = mockSuccessOutput({
    roomId: 'room-1',
    prompt: 'Why sugar?',
    chunks: [chunk],
    priorMessages: [],
  });
  assert.equal(ordinary.anchorStart, 0);
  assert.equal(ordinary.anchorEnd, 12);
  const rewritten = mockEditOutput({
    roomId: 'room-1',
    prompt: 'Replace the first 12 characters with XXXXXXXXXXXX.',
    chunks: [chunk],
    priorMessages: [],
  });
  assert.equal(rewritten.body.slice(0, 12), 'XXXXXXXXXXXX');
  assert.equal(rewritten.body.slice(12), text.slice(12));
  const appended = mockEditOutput({
    roomId: 'room-1',
    prompt: 'Make it clearer',
    chunks: [chunk],
    priorMessages: [],
  });
  assert.equal(appended.body.startsWith(text), true);
});

test('confirm keeps the proposal revision and does not adopt a newer chunk revision', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  const commit = createCommit(app, { now: () => 5_000, newId: () => 'id-1' });
  const room = await commit({
    opId: 'room-stale',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk-stale',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  assert.ok(savedChunk);
  if (!savedChunk) return;
  const view = chunkViewFromFoundation(savedChunk);
  const prepared = await beginQuestion(harness, { chunks: [view], prompt: 'Why sugar?' });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [view],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(notesRevision(outcome.proposal), savedChunk.revision);
  const operationId = outcome.session?.pendingOperationId ?? '';
  const edited = await commit({
    opId: 'edit-stale',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: savedChunk.revision,
    payload: { chunkId: savedChunk.id, body: 'a later edit' },
  });
  assert.equal(edited.ok, true);
  await assert.rejects(
    () =>
      confirmFoundationQuestion(harness, app, {
        sessionId: prepared.sessionId,
        operationId,
        confirmed: true,
        now: 6_000,
      }),
    /changed/,
  );
  assert.equal((await listAnnotations(app, savedChunk.id)).length, 0);
  const applied = await app.get<{ op_id: string }>('SELECT op_id FROM applied_ops WHERE op_id = ?', [operationId]);
  assert.equal(applied, null);
  const current = await getChunk(app, savedChunk.id);
  assert.equal(current?.body, 'a later edit');
  assert.equal(current?.revision, savedChunk.revision + 1);
  app.close();
  harness.close();
});

test('a committed pin repairs its session after reopen and a later chunk edit or delete', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stome-pin-repair-'));
  const appPath = join(dir, 'app.db');
  const harnessPath = join(dir, 'harness.db');
  const app = nodeDb(appPath);
  const harness = openMemory(harnessPath);
  await migrateDb(app);
  await migrateHarness(harness);
  let nextId = 0;
  const commit = createCommit(app, { now: () => 4_000, newId: () => `setup-${nextId++}` });
  const room = await commit({
    opId: 'room-repair',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk-repair',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar', 'a second chunk'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const first = await getChunk(app, created.value.chunkIds[0] ?? '');
  const second = await getChunk(app, created.value.chunkIds[1] ?? '');
  assert.ok(first && second);
  if (!first || !second) return;

  function failingSession(inner: SqlExecutor): { db: SqlExecutor; arm(): void } {
    let failRecord = false;
    return {
      arm() {
        failRecord = true;
      },
      db: {
        exec: (sql) => inner.exec(sql),
        get: (sql, params) => inner.get(sql, params),
        all: (sql, params) => inner.all(sql, params),
        run: (sql, params) => inner.run(sql, params),
        async transaction(fn) {
          if (failRecord) {
            failRecord = false;
            throw new Error('injected session failure');
          }
          return inner.transaction(fn);
        },
      },
    };
  }

  async function propose(sessionDb: SqlExecutor, appDb: Db, chunkId: string, prompt: string) {
    const chunk = await getChunk(appDb, chunkId);
    assert.ok(chunk);
    if (!chunk) throw new Error('missing chunk');
    const view = chunkViewFromFoundation(chunk);
    const prepared = await beginQuestion(sessionDb, { chunks: [view], prompt });
    const outcome = await fulfillQuestion(sessionDb, prepared, {
      chunks: [view],
      scenario: 'success',
      provider: mockProvider,
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, 'proposal');
    return { prepared, operationId: outcome.session?.pendingOperationId ?? '', revision: chunk.revision };
  }

  const editCase = await propose(harness, app, first.id, 'Why sugar?');
  const firstFailure = failingSession(harness);
  firstFailure.arm();
  await assert.rejects(
    () =>
      confirmFoundationQuestion(firstFailure.db, app, {
        sessionId: editCase.prepared.sessionId,
        operationId: editCase.operationId,
        confirmed: true,
        now: 5_000,
      }),
    /injected session failure/,
  );
  app.close();
  harness.close();

  const reopenedApp = nodeDb(appPath);
  const reopenedHarness = openMemory(harnessPath);
  const edited = await createCommit(reopenedApp, { now: () => 6_000, newId: () => 'edit-id' })({
    opId: 'edit-after-pin',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: editCase.revision,
    payload: { chunkId: first.id, body: 'edited after the pin' },
  });
  assert.equal(edited.ok, true);
  const repaired = await confirmFoundationQuestion(reopenedHarness, reopenedApp, {
    sessionId: editCase.prepared.sessionId,
    operationId: editCase.operationId,
    confirmed: true,
    now: 7_000,
  });
  assert.equal(repaired.replayed, true);
  assert.equal((await listAnnotations(reopenedApp, first.id)).length, 1);
  const pinRows = await reopenedApp.get<{ n: number }>('SELECT COUNT(*) AS n FROM applied_ops WHERE op_id = ?', [
    editCase.operationId,
  ]);
  assert.equal(pinRows?.n, 1);
  const session = await getSession(reopenedHarness, editCase.prepared.sessionId);
  assert.equal(session?.confirmedOperationId, editCase.operationId);

  const deleteCase = await propose(reopenedHarness, reopenedApp, second.id, 'And this?');
  const secondFailure = failingSession(reopenedHarness);
  secondFailure.arm();
  await assert.rejects(
    () =>
      confirmFoundationQuestion(secondFailure.db, reopenedApp, {
        sessionId: deleteCase.prepared.sessionId,
        operationId: deleteCase.operationId,
        confirmed: true,
      }),
    /injected session failure/,
  );
  const removed = await createCommit(reopenedApp, { now: () => 8_000, newId: () => 'delete-id' })({
    opId: 'delete-after-pin',
    kind: 'chunk.delete',
    source: 'human',
    confirmed: false,
    expectedRevision: deleteCase.revision,
    payload: { chunkId: second.id },
  });
  assert.equal(removed.ok, true);
  const afterDelete = await confirmFoundationQuestion(reopenedHarness, reopenedApp, {
    sessionId: deleteCase.prepared.sessionId,
    operationId: deleteCase.operationId,
    confirmed: true,
    now: 9_000,
  });
  assert.equal(afterDelete.replayed, true);
  assert.equal(await getChunk(reopenedApp, second.id), null);
  assert.equal((await listAnnotations(reopenedApp, second.id)).length, 0);
  const deletePin = await reopenedApp.get<{ n: number }>('SELECT COUNT(*) AS n FROM applied_ops WHERE op_id = ?', [
    deleteCase.operationId,
  ]);
  assert.equal(deletePin?.n, 1);
  reopenedApp.close();
  reopenedHarness.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a completed proposal and its operation id reopen together', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stome-pin-id-'));
  const app = nodeDb();
  await migrateDb(app);
  const path = join(dir, 'harness.db');
  const harness = openMemory(path);
  await migrateHarness(harness);
  const commit = createCommit(app, { now: () => 3_000, newId: () => 'setup' });
  const room = await commit({
    opId: 'room-id',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk-id',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  assert.ok(savedChunk);
  if (!savedChunk) return;
  const view = chunkViewFromFoundation(savedChunk);
  const prepared = await beginQuestion(harness, { chunks: [view], prompt: 'Why sugar?' });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [view],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  const operationId = outcome.session?.pendingOperationId ?? '';
  assert.ok(operationId);
  assert.equal(notesRevision(outcome.proposal), savedChunk.revision);
  harness.close();
  const reopened = openMemory(path);
  const session = await getSession(reopened, prepared.sessionId);
  assert.equal(session?.pendingOperationId, operationId);
  assert.equal(session?.proposal?.id, outcome.proposal?.id);
  await reopened.run('UPDATE harness_sessions SET pending_operation_id = NULL WHERE id = ?', [prepared.sessionId]);
  const repaired = await ensurePendingOperationId(reopened, prepared.sessionId, 4_000);
  const stable = repairOperationId(prepared.sessionId, outcome.proposal?.id ?? '');
  assert.equal(repaired.pendingOperationId, stable);
  reopened.close();
  const persistedDb = openMemory(path);
  const persisted = await getSession(persistedDb, prepared.sessionId);
  assert.equal(persisted?.pendingOperationId, stable);
  assert.equal(notesRevision(persisted?.proposal), savedChunk.revision);
  persistedDb.close();
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a confirmed note edit replaces the chunk once and stays source ai', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  let nextId = 0;
  const commit = createCommit(app, { now: () => 5_000, newId: () => `setup-${nextId++}` });
  const room = await commit({
    opId: 'room-edit',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk-edit',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar', 'a second chunk'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  const other = await getChunk(app, created.value.chunkIds[1] ?? '');
  assert.ok(savedChunk && other);
  if (!savedChunk || !other) return;
  const view = chunkViewFromFoundation(savedChunk);

  const cancelPrepared = await beginQuestion(harness, { chunks: [view], prompt: 'Stop this' });
  const cancelSignal = new AbortController();
  const cancelling = fulfillQuestion(harness, cancelPrepared, {
    chunks: [view],
    scenario: 'cancel',
    purpose: 'edit',
    provider: mockProvider,
    signal: cancelSignal.signal,
  });
  cancelSignal.abort();
  const cancelled = await cancelling;
  assert.notEqual(cancelled.status, 'proposal');
  assert.equal((await getChunk(app, savedChunk.id))?.body, savedChunk.body);

  const prepared = await beginQuestion(harness, { chunks: [view], prompt: 'Make it clearer' });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [view],
    scenario: 'success',
    purpose: 'edit',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'proposal');
  assert.equal(outcome.proposal?.tool, 'notes.proposeChunkEdit');
  assert.equal(outcome.proposal?.type, 'chunk_edit');
  if (outcome.proposal?.tool !== 'notes.proposeChunkEdit') return;
  assert.equal(outcome.proposal.previousBody, savedChunk.body);
  assert.equal(outcome.proposal.chunkRevision, savedChunk.revision);
  assert.equal(
    outcome.proposal.body,
    `${savedChunk.body}\n\nMock edit (${savedChunk.id}; messages=0): Make it clearer`,
  );
  const operationId = outcome.session?.pendingOperationId ?? '';
  assert.ok(operationId);
  await discardQuestion(harness, prepared.sessionId);
  const discarded = await getChunk(app, savedChunk.id);
  assert.equal(discarded?.body, savedChunk.body);
  assert.equal(discarded?.revision, savedChunk.revision);
  assert.equal(await app.get('SELECT op_id FROM applied_ops WHERE op_id = ?', [operationId]), null);

  const againPrepared = await beginQuestion(harness, { chunks: [view], prompt: 'Make it clearer' });
  const againOutcome = await fulfillQuestion(harness, againPrepared, {
    chunks: [view],
    scenario: 'success',
    purpose: 'edit',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(againOutcome.status, 'proposal');
  const againId = againOutcome.session?.pendingOperationId ?? '';
  await assert.rejects(
    () =>
      confirmFoundationQuestion(harness, app, {
        sessionId: againPrepared.sessionId,
        operationId: againId,
        confirmed: false,
        now: 6_000,
      }),
    /confirm/,
  );
  assert.equal((await getChunk(app, savedChunk.id))?.body, savedChunk.body);
  const saved = await confirmFoundationQuestion(harness, app, {
    sessionId: againPrepared.sessionId,
    operationId: againId,
    confirmed: true,
    now: 6_000,
  });
  assert.equal(saved.replayed, false);
  assert.equal(saved.revision, savedChunk.revision + 1);
  const edited = await getChunk(app, savedChunk.id);
  assert.equal(edited?.body, notesBody(againOutcome.proposal));
  assert.equal(edited?.revision, savedChunk.revision + 1);
  const applied = await app.get<{ source: string; kind: string }>('SELECT source, kind FROM applied_ops WHERE op_id = ?', [
    againId,
  ]);
  assert.equal(applied?.source, 'ai');
  assert.equal(applied?.kind, 'chunk.update');
  const replayed = await confirmFoundationQuestion(harness, app, {
    sessionId: againPrepared.sessionId,
    operationId: againId,
    confirmed: true,
    now: 7_000,
  });
  assert.equal(replayed.replayed, true);
  assert.equal((await getChunk(app, savedChunk.id))?.revision, savedChunk.revision + 1);
  assert.equal((await getChunk(app, savedChunk.id))?.body, notesBody(againOutcome.proposal));

  const both = await beginQuestion(harness, {
    chunks: [view, chunkViewFromFoundation(other)],
    prompt: 'Change both',
  });
  const rejected = await fulfillQuestion(harness, both, {
    chunks: [view, chunkViewFromFoundation(other)],
    scenario: 'success',
    purpose: 'edit',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(rejected.status, 'failed');
  assert.match(rejected.errorMessage ?? '', /one chunk/);
  assert.equal((await getChunk(app, other.id))?.body, other.body);

  const demo = await beginQuestion(harness, { chunks: [chunk(1)], prompt: 'Edit the demo' });
  const demoRun = await fulfillQuestion(harness, demo, {
    chunks: [chunk(1)],
    scenario: 'success',
    purpose: 'edit',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(demoRun.status, 'proposal');
  await assert.rejects(
    () =>
      confirmFoundationQuestion(harness, app, {
        sessionId: demo.sessionId,
        operationId: demoRun.session?.pendingOperationId ?? '',
        confirmed: true,
      }),
    /demo note/,
  );
  assert.equal((await getChunk(app, savedChunk.id))?.body, notesBody(againOutcome.proposal));
  app.close();
  harness.close();
});

test('a stale note edit writes nothing and keeps the newer text', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  const commit = createCommit(app, { now: () => 5_000, newId: () => 'stale-setup' });
  const room = await commit({
    opId: 'room-stale-edit',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk-stale-edit',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  assert.ok(savedChunk);
  if (!savedChunk) return;
  const view = chunkViewFromFoundation(savedChunk);
  const prepared = await beginQuestion(harness, { chunks: [view], prompt: 'Make it clearer' });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [view],
    scenario: 'success',
    purpose: 'edit',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'proposal');
  assert.equal(notesRevision(outcome.proposal), savedChunk.revision);
  const operationId = outcome.session?.pendingOperationId ?? '';
  const human = await commit({
    opId: 'human-before-confirm',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: savedChunk.revision,
    payload: { chunkId: savedChunk.id, body: 'a later human edit' },
  });
  assert.equal(human.ok, true);
  await assert.rejects(
    () =>
      confirmFoundationQuestion(harness, app, {
        sessionId: prepared.sessionId,
        operationId,
        confirmed: true,
        now: 6_000,
      }),
    /changed/,
  );
  const current = await getChunk(app, savedChunk.id);
  assert.equal(current?.body, 'a later human edit');
  assert.equal(current?.revision, savedChunk.revision + 1);
  assert.equal(await app.get('SELECT op_id FROM applied_ops WHERE op_id = ?', [operationId]), null);
  const removed = await commit({
    opId: 'human-delete',
    kind: 'chunk.delete',
    source: 'human',
    confirmed: false,
    expectedRevision: savedChunk.revision + 1,
    payload: { chunkId: savedChunk.id },
  });
  assert.equal(removed.ok, true);
  await assert.rejects(
    () =>
      confirmFoundationQuestion(harness, app, {
        sessionId: prepared.sessionId,
        operationId,
        confirmed: true,
        now: 7_000,
      }),
    /not in the library/,
  );
  assert.equal(await getChunk(app, savedChunk.id), null);
  assert.equal(await app.get('SELECT op_id FROM applied_ops WHERE op_id = ?', [operationId]), null);
  app.close();
  harness.close();
});

test('a committed note edit repairs its session after a later human edit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stome-edit-repair-'));
  const appPath = join(dir, 'app.db');
  const harnessPath = join(dir, 'harness.db');
  const app = nodeDb(appPath);
  const harness = openMemory(harnessPath);
  await migrateDb(app);
  await migrateHarness(harness);
  let nextId = 0;
  const commit = createCommit(app, { now: () => 4_000, newId: () => `setup-${nextId++}` });
  const room = await commit({
    opId: 'room-repair-edit',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk-repair-edit',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const savedChunk = await getChunk(app, created.value.chunkIds[0] ?? '');
  assert.ok(savedChunk);
  if (!savedChunk) return;
  const view = chunkViewFromFoundation(savedChunk);
  const prepared = await beginQuestion(harness, { chunks: [view], prompt: 'Make it clearer' });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [view],
    scenario: 'success',
    purpose: 'edit',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'proposal');
  const operationId = outcome.session?.pendingOperationId ?? '';
  const proposedBody = notesBody(outcome.proposal) ?? '';
  let failRecord = false;
  const failing: SqlExecutor = {
    exec: (sql) => harness.exec(sql),
    get: (sql, params) => harness.get(sql, params),
    all: (sql, params) => harness.all(sql, params),
    run: (sql, params) => harness.run(sql, params),
    transaction(fn) {
      if (failRecord) {
        failRecord = false;
        throw new Error('injected session failure');
      }
      return harness.transaction(fn);
    },
  };
  failRecord = true;
  await assert.rejects(
    () =>
      confirmFoundationQuestion(failing, app, {
        sessionId: prepared.sessionId,
        operationId,
        confirmed: true,
        now: 5_000,
      }),
    /injected session failure/,
  );
  assert.equal((await getChunk(app, savedChunk.id))?.body, proposedBody);
  app.close();
  harness.close();

  const reopenedApp = nodeDb(appPath);
  const reopenedHarness = openMemory(harnessPath);
  const human = await createCommit(reopenedApp, { now: () => 6_000, newId: () => 'human-id' })({
    opId: 'human-after-edit',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: savedChunk.revision + 1,
    payload: { chunkId: savedChunk.id, body: 'human rewrite after the edit' },
  });
  assert.equal(human.ok, true);
  const repaired = await confirmFoundationQuestion(reopenedHarness, reopenedApp, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
    now: 7_000,
  });
  assert.equal(repaired.replayed, true);
  const current = await getChunk(reopenedApp, savedChunk.id);
  assert.equal(current?.body, 'human rewrite after the edit');
  assert.equal(current?.revision, savedChunk.revision + 2);
  const aiRows = await reopenedApp.get<{ n: number; source: string }>(
    'SELECT COUNT(*) AS n, source FROM applied_ops WHERE op_id = ?',
    [operationId],
  );
  assert.equal(aiRows?.n, 1);
  assert.equal(aiRows?.source, 'ai');
  const session = await getSession(reopenedHarness, prepared.sessionId);
  assert.equal(session?.confirmedOperationId, operationId);
  reopenedApp.close();
  reopenedHarness.close();
  rmSync(dir, { recursive: true, force: true });
});

function post(
  url: string,
  input: { origin?: string; token?: string; body: string },
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: '/v1/tool',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: input.origin ?? '',
          'x-stome-token': input.token ?? '',
          'content-length': Buffer.byteLength(input.body),
        },
      },
      (response) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end(input.body);
  });
}

function rawPost(
  port: number,
  input: { host: string; origin: string; token: string; body: string },
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/tool',
        method: 'POST',
        headers: {
          host: input.host,
          origin: input.origin,
          'content-type': 'application/json',
          'x-stome-token': input.token,
          'content-length': Buffer.byteLength(input.body),
        },
      },
      (response) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.end(input.body);
  });
}

