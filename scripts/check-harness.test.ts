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
import { companionProvider } from '../src/harness/companionClient.ts';
import { serializedExecutor, type RawSql } from '../src/harness/serialized.ts';
import {
  SCAFFOLD_ROOM_ID,
  TOOL_REGISTRY,
  noteToChunk,
  type ChunkView,
} from '../src/harness/contract.ts';
import { createProvider, mockProvider, mockSuccessOutput } from '../src/harness/provider.ts';
import {
  beginQuestion,
  confirmQuestion,
  discardQuestion,
  fulfillQuestion,
} from '../src/harness/runTurn.ts';
import {
  HARNESS_MIGRATION_SQL,
  HARNESS_SCHEMA_VERSION,
  cancelRun,
  commitStubAnnotation,
  completeRun,
  createSession,
  failInterruptedSessions,
  getSession,
  listStubAnnotations,
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

function noteFor(view: ChunkView) {
  return {
    id: view.noteId,
    title: view.label,
    body: view.text,
    updatedAt: view.revision,
  };
}

test('registry is only notes.proposeAnnotation and rejects a foreign room', async () => {
  assert.deepEqual(Object.keys(TOOL_REGISTRY), ['notes.proposeAnnotation']);
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

test('migration preserves an existing scaffold note and does not create foundation tables', async () => {
  assert.ok(SUPPORTED_VERSION >= 2);
  assert.equal(migrationsFor(SUPPORTED_VERSION).length, 0);
  assert.equal(migrationsFor(1).length, MIGRATIONS.length - 1);
  assert.equal(HARNESS_MIGRATION_SQL.includes('CREATE TABLE rooms'), false);
  assert.equal(HARNESS_MIGRATION_SQL.includes('CREATE TABLE chunks'), false);
  assert.equal(HARNESS_MIGRATION_SQL.includes('CREATE TABLE annotations'), false);
  assert.equal(HARNESS_MIGRATION_SQL.includes('CREATE TABLE notes'), false);
  assert.equal(HARNESS_MIGRATION_SQL.includes('harness_stub_annotations'), true);

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
  await confirmQuestion(harness, {
    sessionId: prepared.sessionId,
    note: { id: 1, title, body: 'quotes "stay"', updatedAt: 10 },
    operationId: 'op-keep-note',
    confirmed: true,
  });

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
  assert.match(outcome.proposal?.body ?? '', /messages=1/);
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
    messageId: 'late-message',
    now: 80,
  });
  assert.equal(stored, 'discarded');
  assert.equal((await listStubAnnotations(db)).length, 0);
  db.close();
});

test('rejects unselected chunks, bad anchors, missing confirmation, and a stale revision', async () => {
  const db = await harnessDb();
  const selected = chunk(1);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Explain' });
  const outsider = await fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: {
      async complete() {
        return {
          roomId: SCAFFOLD_ROOM_ID,
          chunkId: 'note:2',
          type: 'ai_answer',
          body: 'wrong note',
          anchorStart: 0,
          anchorEnd: 4,
        };
      },
    },
    signal: new AbortController().signal,
  });
  assert.equal(outsider.status, 'failed');
  assert.equal(outsider.errorCode, 'scope_rejected');
  assert.equal((await listStubAnnotations(db)).length, 0);

  const second = await beginQuestion(db, { chunks: [selected], prompt: 'Again' });
  const malformed = await fulfillQuestion(db, second, {
    chunks: [selected],
    scenario: 'success',
    provider: {
      async complete() {
        return {
          roomId: SCAFFOLD_ROOM_ID,
          chunkId: 'note:1',
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
  await assert.rejects(
    () =>
      confirmQuestion(db, {
        sessionId: third.sessionId,
        note: noteFor(selected),
        operationId: 'op-no',
        confirmed: false,
      }),
    /confirm/,
  );
  await assert.rejects(
    () =>
      confirmQuestion(db, {
        sessionId: third.sessionId,
        note: noteFor({ ...selected, revision: selected.revision + 1 }),
        operationId: 'op-stale',
        confirmed: true,
      }),
    /changed/,
  );
  assert.equal((await listStubAnnotations(db)).length, 0);
  assert.equal((await getSession(db, third.sessionId))?.confirmedOperationId, null);
  db.close();
});

test('operation id dedupe returns the first write and a partial failure rolls back', async () => {
  const db = await harnessDb();
  const selected = chunk(1);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Save this' });
  const proposed = await fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.ok(proposed.proposal);
  const first = await confirmQuestion(db, {
    sessionId: prepared.sessionId,
    note: noteFor(selected),
    operationId: 'op-1',
    confirmed: true,
  });
  assert.equal(first.replayed, false);
  const replay = await confirmQuestion(db, {
    sessionId: prepared.sessionId,
    note: noteFor(selected),
    operationId: 'op-1',
    confirmed: true,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.annotationId, first.annotationId);
  const rows = await listStubAnnotations(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.body, proposed.proposal?.body);

  const session = await getSession(db, prepared.sessionId);
  assert.ok(session?.proposal);
  await assert.rejects(
    () =>
      commitStubAnnotation(
        db,
        {
          opId: 'op-2',
          kind: 'annotation.create',
          source: 'ai',
          confirmed: true,
          expectedRevision: selected.revision,
          payload: {
            proposalId: session.proposal?.id ?? '',
            roomId: session.roomId,
            chunkId: 'note:1',
            noteId: 1,
            type: 'ai_answer',
            body: 'a different body that must not land',
            anchorStart: 0,
            anchorEnd: 4,
          },
        },
        prepared.sessionId,
        90,
      ),
    /already saved/,
  );
  assert.equal((await listStubAnnotations(db)).length, 1);
  assert.equal((await listStubAnnotations(db))[0]?.body, proposed.proposal?.body);

  const rollback = await harnessDb();
  const other = chunk(4, 'rollback text');
  const started = await beginQuestion(rollback, { chunks: [other], prompt: 'Roll back' });
  const ready = await fulfillQuestion(rollback, started, {
    chunks: [other],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(ready.status, 'proposal');
  await rollback.exec(`
    CREATE TRIGGER abort_operation BEFORE INSERT ON harness_operations
    BEGIN
      SELECT RAISE(ABORT, 'injected failure');
    END;
  `);
  await assert.rejects(
    () =>
      confirmQuestion(rollback, {
        sessionId: started.sessionId,
        note: noteFor(other),
        operationId: 'op-rollback',
        confirmed: true,
      }),
    /injected failure/,
  );
  assert.equal((await listStubAnnotations(rollback)).length, 0);
  const operations = await rollback.get<{ count: number }>('SELECT COUNT(*) AS count FROM harness_operations');
  assert.equal(operations?.count, 0);
  assert.equal((await getSession(rollback, started.sessionId))?.confirmedOperationId, null);
  db.close();
  rollback.close();
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
    assert.equal((await listStubAnnotations(db)).length, 0);
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
  const path = join(dir, 'harness.db');
  const firstDb = openMemory(path);
  await migrateHarness(firstDb);
  const selected = chunk(1);
  const prepared = await beginQuestion(firstDb, { chunks: [selected], prompt: 'First question' });
  const proposed = await fulfillQuestion(firstDb, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(proposed.status, 'proposal');
  const saved = await confirmQuestion(firstDb, {
    sessionId: prepared.sessionId,
    note: noteFor(selected),
    operationId: 'op-first',
    confirmed: true,
  });
  assert.equal(saved.replayed, false);
  firstDb.close();

  const reopened = openMemory(path);
  await migrateHarness(reopened);
  const interrupted = await failInterruptedSessions(reopened, 50);
  assert.equal(interrupted, 0);
  const session = await getSession(reopened, prepared.sessionId);
  assert.equal(session?.state, 'completed');
  assert.equal(session?.confirmedOperationId, 'op-first');
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
  assert.match(second.proposal?.body ?? '', /Second question/);
  const savedAgain = await confirmQuestion(reopened, {
    sessionId: continued.sessionId,
    note: noteFor(selected),
    operationId: 'op-second',
    confirmed: true,
  });
  assert.equal(savedAgain.replayed, false);
  const rows = await listStubAnnotations(reopened);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.operationId),
    ['op-first', 'op-second'],
  );
  const replay = await confirmQuestion(reopened, {
    sessionId: continued.sessionId,
    note: noteFor(selected),
    operationId: 'op-first',
    confirmed: true,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.annotationId, saved.annotationId);
  await assert.rejects(
    () =>
      confirmQuestion(reopened, {
        sessionId: continued.sessionId,
        note: noteFor(selected),
        operationId: 'op-third',
        confirmed: true,
      }),
    /already saved/,
  );
  assert.equal((await listStubAnnotations(reopened)).length, 2);
  reopened.close();
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
  const selected = chunk(1);
  const prepared = await beginQuestion(db, { chunks: [selected], prompt: 'Race' });
  const proposed = await fulfillQuestion(db, prepared, {
    chunks: [selected],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(proposed.status, 'proposal');
  const confirmation = confirmQuestion(db, {
    sessionId: prepared.sessionId,
    note: noteFor(selected),
    operationId: 'op-race',
    confirmed: true,
  });
  const duplicate = confirmQuestion(db, {
    sessionId: prepared.sessionId,
    note: noteFor(selected),
    operationId: 'op-race',
    confirmed: true,
  });
  const discard = discardQuestion(db, prepared.sessionId, 80);
  const settled = await Promise.allSettled([confirmation, duplicate, discard]);
  const rows = await listStubAnnotations(db);
  const session = await getSession(db, prepared.sessionId);
  const operations = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM harness_operations');
  assert.ok(rows.length <= 1);
  assert.equal(operations?.count, rows.length);
  if (rows.length === 1) {
    assert.equal(rows[0]?.operationId, 'op-race');
    assert.equal(session?.confirmedOperationId, 'op-race');
    assert.equal(session?.proposal?.id, proposed.proposal?.id);
    const writes = settled.filter((item) => item.status === 'fulfilled' && item.value && typeof item.value === 'object' && 'annotationId' in item.value);
    assert.equal(writes.length, 2);
  } else {
    assert.equal(session?.proposal, null);
    assert.equal(session?.confirmedOperationId, null);
  }
  for (const item of settled) {
    if (item.status === 'rejected') {
      assert.match(String(item.reason), /proposal|already saved/);
    }
  }

  const other = await harnessDb();
  const again = chunk(2, 'other note text');
  const started = await beginQuestion(other, { chunks: [again], prompt: 'Discard wins' });
  const ready = await fulfillQuestion(other, started, {
    chunks: [again],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(ready.status, 'proposal');
  await discardQuestion(other, started.sessionId, 90);
  await assert.rejects(
    () =>
      confirmQuestion(other, {
        sessionId: started.sessionId,
        note: noteFor(again),
        operationId: 'op-after-discard',
        confirmed: true,
      }),
    /proposal/,
  );
  assert.equal((await listStubAnnotations(other)).length, 0);
  other.close();
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
  assert.equal((await listStubAnnotations(db)).length, 0);
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
