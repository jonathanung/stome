/**
 * Isolated from the suite: replacing global crypto in the test process would
 * race other files. This child is the regression for issue #106.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { createCommit } from '../../src/data/commit.ts';
import { getChunk, listAnnotations } from '../../src/data/queries.ts';
import { migrateDb } from '../../src/db/migrate.ts';
import { chunkViewFromFoundation } from '../../src/harness/contract.ts';
import { createHarnessId, formatUuidV4, installHarnessRandomBytes } from '../../src/harness/ids.ts';
import { mockProvider, mockSuccessOutput } from '../../src/harness/provider.ts';
import { beginQuestion, confirmFoundationQuestion, fulfillQuestion } from '../../src/harness/runTurn.ts';
import { migrateHarness, type SqlExecutor, type SqlParams } from '../../src/harness/store.ts';
import { nodeDb } from './node-db.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function harnessDb(): SqlExecutor & { close(): void } {
  const raw = new DatabaseSync(':memory:');
  const db: SqlExecutor & { close(): void } = {
    async exec(sql: string) {
      raw.exec(sql);
    },
    async get<T>(sql: string, params: SqlParams = []) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
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

function replaceCrypto(value: Crypto | undefined): void {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

async function askConfirmReplay(label: string, issued?: { count: number }): Promise<void> {
  const app = nodeDb();
  await migrateDb(app);
  const harness = harnessDb();
  await migrateHarness(harness);
  let setup = 0;
  const commit = createCommit(app, { now: () => 5_000, newId: () => `setup-${label}-${++setup}` });
  const room = await commit({
    opId: `room-${label}`,
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: `chunk-${label}`,
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
  assert.match(prepared.sessionId, UUID_V4);
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks: [view],
    scenario: 'success',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'proposal');
  const expected = mockSuccessOutput({
    roomId: view.roomId,
    prompt: 'Why sugar?',
    chunks: [{ id: view.id, roomId: view.roomId, text: view.text }],
    priorMessages: [],
  });
  assert.equal(outcome.proposal?.body, expected.body);
  const operationId = outcome.session?.pendingOperationId ?? '';
  assert.match(operationId, UUID_V4);
  const saved = await confirmFoundationQuestion(harness, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
    now: 6_000,
  });
  assert.equal(saved.replayed, false);
  const issuedAtConfirm = issued?.count;
  const again = await confirmFoundationQuestion(harness, app, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
    now: 7_000,
  });
  assert.equal(again.replayed, true);
  assert.equal(again.annotationId, saved.annotationId);
  if (issued && issuedAtConfirm !== undefined) assert.equal(issued.count, issuedAtConfirm);
  const pins = await listAnnotations(app, savedChunk.id);
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.payload.answer, expected.body);
  harness.close();
  app.close();
}

async function main(): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  assert.ok(original);
  const web = globalThis.crypto;
  let randomUuidCalls = 0;
  try {
    const zeros = new Uint8Array(16);
    assert.equal(formatUuidV4(zeros), '00000000-0000-4000-8000-000000000000');
    const ones = new Uint8Array(16).fill(0xff);
    assert.equal(formatUuidV4(ones), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
    assert.equal(formatUuidV4(zeros), '00000000-0000-4000-8000-000000000000');

    replaceCrypto(undefined);
    installHarnessRandomBytes(null);
    assert.match(createHarnessId(), UUID_V4);

    const issued = { count: 0 };
    installHarnessRandomBytes((size) => {
      issued.count += 1;
      const bytes = new Uint8Array(size);
      bytes[0] = issued.count;
      return bytes;
    });
    await askConfirmReplay('native', issued);
    assert.ok(issued.count > 0);
    installHarnessRandomBytes(null);

    const bytesOnly = {
      getRandomValues(target: Uint8Array) {
        web.getRandomValues(target as unknown as Parameters<Crypto['getRandomValues']>[0]);
        return target;
      },
      randomUUID() {
        randomUuidCalls += 1;
        throw new Error('browser crypto.randomUUID was called');
      },
    };
    replaceCrypto(bytesOnly as unknown as Crypto);
    const seen = issued.count;
    await askConfirmReplay('web-bytes', issued);
    assert.equal(issued.count, seen);
    assert.equal(randomUuidCalls, 0);
  } finally {
    installHarnessRandomBytes(null);
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  }
  console.log('ask-without-random-uuid ok');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
