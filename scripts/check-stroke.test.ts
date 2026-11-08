import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { getChunk, listAnnotations } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import {
  HarnessError,
  STROKE_TOOL_NAME,
  TOOL_REGISTRY,
  isStrokeProposal,
  parseStrokeOutput,
  parseStrokePoints,
  proposalMessageBody,
  type ChunkView,
} from '../src/harness/contract.ts';
import { mockProvider, mockStrokeOutput } from '../src/harness/provider.ts';
import { beginQuestion, confirmFoundationQuestion, discardQuestion, fulfillQuestion } from '../src/harness/runTurn.ts';
import { getSession, migrateHarness, type SqlExecutor, type SqlParams } from '../src/harness/store.ts';
import { nodeDb } from '../tests/support/node-db.ts';

function harnessDb(): SqlExecutor & { close(): void } {
  const raw = new DatabaseSync(':memory:');
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

async function setupApp() {
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  const commit = createCommit(db, { newId: () => `id-${++id}`, now: () => 5_000 + id });
  const room = await commit({ opId: 'room-1', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' } });
  assert.equal(room.ok, true);
  if (!room.ok) throw new Error('room setup failed');
  const created = await commit({
    opId: 'chunk-1',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['the krebs cycle turns twice per glucose'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error('chunk setup failed');
  const chunkId = created.value.chunkIds[0] ?? '';
  const saved = await getChunk(db, chunkId);
  assert.ok(saved);
  return { db, commit, roomId: room.value.roomId, chunkId, revision: saved.revision };
}

function view(roomId: string, chunkId: string, revision: number): ChunkView {
  return {
    id: chunkId,
    roomId,
    noteId: 0,
    label: 'the krebs cycle turns twice per glucose',
    text: 'the krebs cycle turns twice per glucose',
    revision,
  };
}

async function proposeStroke(prompt = 'Underline the key step') {
  const app = await setupApp();
  const harness = harnessDb();
  await migrateHarness(harness);
  const chunks = [view(app.roomId, app.chunkId, app.revision)];
  const prepared = await beginQuestion(harness, { chunks, prompt });
  const outcome = await fulfillQuestion(harness, prepared, {
    chunks,
    scenario: 'success',
    purpose: 'stroke',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  return { app, harness, chunks, prepared, outcome };
}

test('the stroke tool contract has no shell or file access', async () => {
  assert.equal(TOOL_REGISTRY[STROKE_TOOL_NAME].name, 'whiteboard.proposeStroke');
  const contract = readFileSync(new URL('../src/harness/contract.ts', import.meta.url), 'utf8');
  assert.equal(contract.includes('child_process'), false);
  assert.equal(contract.includes('node:fs'), false);
});

test('stroke points keep the commit limits: 1 to 5000 finite pairs', async () => {
  assert.deepEqual(parseStrokePoints([[0, 0]]), [[0, 0]]);
  assert.deepEqual(parseStrokePoints([[1.5, -2.25], [3, 4]]), [[1.5, -2.25], [3, 4]]);
  assert.equal(parseStrokePoints(Array.from({ length: 5_000 }, (_, index) => [index, index])).length, 5_000);
  for (const bad of [[], 'nope', null, [[0]], [[0, 0, 0]], [['a', 0]], [[0, 'b']], [[Number.NaN, 0]], [[0, Number.POSITIVE_INFINITY]]]) {
    assert.throws(() => parseStrokePoints(bad), (error: unknown) => error instanceof HarnessError && error.code === 'invalid_shape');
  }
  assert.throws(
    () => parseStrokePoints(Array.from({ length: 5_001 }, (_, index) => [index, index])),
    (error: unknown) => error instanceof HarnessError && error.code === 'output_limit',
  );
  assert.deepEqual(parseStrokeOutput({ roomId: 'r1', chunkId: 'c1', type: 'stroke', points: [[8, 8]] }), {
    roomId: 'r1',
    chunkId: 'c1',
    type: 'stroke',
    points: [[8, 8]],
  });
  for (const bad of [
    { roomId: 'r1', chunkId: 'c1', type: 'ai_answer', points: [[0, 0]] },
    { roomId: 'r1', chunkId: 'c1', type: 'stroke' },
    { roomId: 'r1', chunkId: 'c1', type: 'stroke', points: [[0, 0]], extra: true },
  ]) {
    assert.throws(() => parseStrokeOutput(bad), (error: unknown) => error instanceof HarnessError && error.code === 'invalid_shape');
  }
});

test('the mock stroke is a small valid stroke on the first chunk', async () => {
  const out = mockStrokeOutput({
    roomId: 'r1',
    prompt: 'Circle it',
    chunks: [
      { id: 'c2', roomId: 'r1', text: 'second' },
      { id: 'c1', roomId: 'r1', text: 'first' },
    ],
    priorMessages: [],
  });
  assert.equal(out.roomId, 'r1');
  assert.equal(out.chunkId, 'c1');
  assert.equal(out.type, 'stroke');
  assert.deepEqual(parseStrokePoints(out.points), out.points);
});

test('a stroke proposal confirms into one AI stroke annotation', async () => {
  const { app, harness, prepared, outcome } = await proposeStroke();
  assert.equal(outcome.status, 'proposal');
  assert.ok(outcome.proposal && isStrokeProposal(outcome.proposal));
  assert.equal(outcome.proposal.tool, 'whiteboard.proposeStroke');
  assert.deepEqual(outcome.proposal.points, [[8, 8], [48, 32], [88, 56]]);
  const operationId = outcome.session?.pendingOperationId ?? '';
  assert.ok(operationId);
  const saved = await confirmFoundationQuestion(harness, app.db, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
    now: 6_000,
  });
  assert.equal(saved.replayed, false);
  assert.ok(saved.annotationId);
  const pins = await listAnnotations(app.db, app.chunkId);
  assert.equal(pins.length, 1);
  assert.equal(pins[0]?.type, 'stroke');
  assert.deepEqual(pins[0]?.anchor, { points: [[8, 8], [48, 32], [88, 56]] });
  assert.equal(pins[0]?.payload.proposalId, outcome.proposal.id);
  const applied = await app.db.get<{ source: string; kind: string }>('SELECT source, kind FROM applied_ops WHERE op_id = ?', [operationId]);
  assert.equal(applied?.source, 'ai');
  assert.equal(applied?.kind, 'annotation.create');
  const chunk = await getChunk(app.db, app.chunkId);
  assert.equal(chunk?.body, 'the krebs cycle turns twice per glucose');
  assert.equal(chunk?.revision, app.revision);
  const again = await confirmFoundationQuestion(harness, app.db, {
    sessionId: prepared.sessionId,
    operationId,
    confirmed: true,
    now: 7_000,
  });
  assert.equal(again.replayed, true);
  assert.equal(again.annotationId, saved.annotationId);
  assert.equal((await listAnnotations(app.db, app.chunkId)).length, 1);
  const messages = await harness.all<{ body: string }>('SELECT body FROM harness_messages WHERE session_id = ? AND role = ?', [prepared.sessionId, 'assistant']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.body, 'Stroke proposal (3 points)');
  assert.equal(proposalMessageBody(outcome.proposal), 'Stroke proposal (3 points)');
  app.db.close();
  harness.close();
});

test('declining a stroke writes nothing and clears the proposal', async () => {
  const { app, harness, prepared, outcome } = await proposeStroke();
  assert.equal(outcome.status, 'proposal');
  const operationId = outcome.session?.pendingOperationId ?? '';
  await assert.rejects(
    confirmFoundationQuestion(harness, app.db, { sessionId: prepared.sessionId, operationId, confirmed: false }),
    (error: unknown) => error instanceof HarnessError && error.code === 'confirmation_required',
  );
  assert.equal((await listAnnotations(app.db, app.chunkId)).length, 0);
  assert.equal(await app.db.get('SELECT op_id FROM applied_ops WHERE op_id = ?', [operationId]), null);
  await discardQuestion(harness, prepared.sessionId);
  assert.equal((await getSession(harness, prepared.sessionId))?.proposal, null);
  await assert.rejects(confirmFoundationQuestion(harness, app.db, { sessionId: prepared.sessionId, operationId, confirmed: true }));
  assert.equal((await listAnnotations(app.db, app.chunkId)).length, 0);
  app.db.close();
  harness.close();
});

test('a stale chunk revision refuses a stroke confirm', async () => {
  const { app, harness, prepared, outcome } = await proposeStroke();
  assert.equal(outcome.status, 'proposal');
  const operationId = outcome.session?.pendingOperationId ?? '';
  const edited = await app.commit({
    opId: 'human-edit',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: app.revision,
    payload: { chunkId: app.chunkId, body: 'a later human edit' },
  });
  assert.equal(edited.ok, true);
  await assert.rejects(
    confirmFoundationQuestion(harness, app.db, { sessionId: prepared.sessionId, operationId, confirmed: true, now: 6_000 }),
    (error: unknown) => error instanceof HarnessError && error.code === 'stale_revision',
  );
  assert.equal((await listAnnotations(app.db, app.chunkId)).length, 0);
  assert.equal(await app.db.get('SELECT op_id FROM applied_ops WHERE op_id = ?', [operationId]), null);
  app.db.close();
  harness.close();
});

test('over-limit and non-finite strokes fail the run without a proposal', async () => {
  const app = await setupApp();
  const chunks = [view(app.roomId, app.chunkId, app.revision)];
  for (const [name, points, code] of [
    ['too many points', Array.from({ length: 5_001 }, (_, index) => [index, index]), 'output_limit'],
    ['non-finite points', [[Number.NaN, 0]], 'invalid_shape'],
    ['empty points', [], 'invalid_shape'],
  ] as const) {
    const harness = harnessDb();
    await migrateHarness(harness);
    const prepared = await beginQuestion(harness, { chunks, prompt: `Stroke ${name}` });
    const outcome = await fulfillQuestion(harness, prepared, {
      chunks,
      scenario: 'success',
      purpose: 'stroke',
      provider: {
        async complete() {
          return { roomId: app.roomId, chunkId: app.chunkId, type: 'stroke', points };
        },
      },
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, 'failed', name);
    assert.equal(outcome.errorCode, code, name);
    assert.equal((await getSession(harness, prepared.sessionId))?.proposal, null);
    harness.close();
  }
  const oversize = harnessDb();
  await migrateHarness(oversize);
  const prepared = await beginQuestion(oversize, { chunks, prompt: 'Too big' });
  const outcome = await fulfillQuestion(oversize, prepared, {
    chunks,
    scenario: 'oversize',
    purpose: 'stroke',
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'output_limit');
  app.db.close();
  oversize.close();
});

test('a stroke for another room or an unselected chunk is scope_rejected', async () => {
  const app = await setupApp();
  const chunks = [view(app.roomId, app.chunkId, app.revision)];
  for (const [name, output] of [
    ['wrong room', { roomId: 'other-room', chunkId: app.chunkId, type: 'stroke', points: [[1, 1]] }],
    ['unselected chunk', { roomId: app.roomId, chunkId: 'missing-chunk', type: 'stroke', points: [[1, 1]] }],
  ] as const) {
    const harness = harnessDb();
    await migrateHarness(harness);
    const prepared = await beginQuestion(harness, { chunks, prompt: `Stroke ${name}` });
    const outcome = await fulfillQuestion(harness, prepared, {
      chunks,
      scenario: 'success',
      purpose: 'stroke',
      provider: {
        async complete() {
          return output;
        },
      },
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, 'failed', name);
    assert.equal(outcome.errorCode, 'scope_rejected', name);
    assert.equal((await listAnnotations(app.db, app.chunkId)).length, 0);
    harness.close();
  }
  app.db.close();
});

test('an unconfirmed AI stroke is rejected at the commit boundary', async () => {
  const app = await setupApp();
  const unconfirmed = await app.commit({
    opId: 'ai-stroke-open',
    kind: 'annotation.create',
    source: 'ai',
    confirmed: false,
    expectedRevision: app.revision,
    payload: { chunkId: app.chunkId, type: 'stroke', anchor: { points: [[0, 0], [4, 5]] } },
  });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.error.code, 'unconfirmed');
  assert.equal((await listAnnotations(app.db, app.chunkId)).length, 0);
  app.db.close();
});
