/**
 * STUDY.5 (#135) harness coverage: study propose/confirm on the mock
 * provider. Selected-scope, late-result discard, stale-revision reject,
 * timeout/cancel/error/oversize mapping, confirm/replay idempotency.
 * Runs against in-memory app + harness databases; no UI, no network.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import {
  getChunk,
  getSlideOutline,
  getStudyDeck,
  getStudyQuiz,
  listStudyCards,
  listStudyQuestions,
} from '../src/data/queries.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import {
  ALLOWED_TOOL_NAMES,
  STUDY_DECK_TOOL_NAME,
  STUDY_OUTLINE_TOOL_NAME,
  STUDY_QUIZ_TOOL_NAME,
  STUDY_TOOL_NAMES,
  STUDY_TOOL_REGISTRY,
  TOOL_REGISTRY,
  assertRegistryIsNotesOnly,
  assertStudyRegistry,
  chunkViewFromFoundation,
  isStudyDeckProposal,
  isStudyProposal,
  parseStudyProposeInput,
  type ChunkView,
  type StoredProposal,
  type StudyDeckDraft,
  type StudyQuizDraft,
  type StudySlideOutlineDraft,
} from '../src/harness/contract.ts';
import {
  completeStudyWithLimits,
  createProvider,
  mockComplete,
  mockProvider,
  mockStudyComplete,
  type StudyProvider,
} from '../src/harness/provider.ts';
import {
  beginQuestion,
  confirmFoundationQuestion,
  confirmStudyProposal,
  discardQuestion,
  fulfillStudyProposal,
  type PreparedRun,
} from '../src/harness/runTurn.ts';
import {
  cancelRun,
  getSession,
  migrateHarness,
  type SqlExecutor,
  type SqlParams,
} from '../src/harness/store.ts';
import { nodeDb } from '../tests/support/node-db.ts';

function openMemory(): SqlExecutor & { close(): void } {
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

async function harnessDb(): Promise<SqlExecutor & { close(): void }> {
  const db = openMemory();
  await migrateHarness(db);
  return db;
}

function view(id: string, roomId = 'room-1', text = `study body of ${id}`, revision = 1): ChunkView {
  return { id, roomId, noteId: 0, label: id, text, revision };
}

function studyInput(roomId: string, ids: readonly string[]) {
  return {
    roomId,
    prompt: 'Propose study material',
    chunks: ids.map((id) => ({ id, roomId, text: `study body of ${id}`, revision: 3 })),
    priorMessages: [],
  };
}

async function seedRoom(app: Db, name: string, bodies: string[]): Promise<{ roomId: string; chunkIds: string[] }> {
  const commit = createCommit(app, { now: () => 1_000, newId: () => globalThis.crypto.randomUUID() });
  const room = await commit({
    opId: globalThis.crypto.randomUUID(),
    kind: 'room.create',
    payload: { name },
    source: 'human',
    confirmed: false,
  });
  assert.ok(room.ok);
  const chunks = await commit({
    opId: globalThis.crypto.randomUUID(),
    kind: 'chunk.create',
    payload: { roomId: room.value.roomId, bodies },
    source: 'human',
    confirmed: false,
  });
  assert.ok(chunks.ok);
  return { roomId: room.value.roomId, chunkIds: chunks.value.chunkIds };
}

async function chunkViews(app: Db, chunkIds: readonly string[]): Promise<ChunkView[]> {
  const views: ChunkView[] = [];
  for (const id of chunkIds) {
    const chunk = await getChunk(app, id);
    assert.ok(chunk);
    views.push(chunkViewFromFoundation(chunk));
  }
  return views;
}

async function proposeKind(
  harness: SqlExecutor,
  chunks: readonly ChunkView[],
  kind: 'deck' | 'quiz' | 'outline',
  scenario: 'success' | 'timeout' | 'error' | 'cancel' | 'oversize' = 'success',
): Promise<{ prepared: PreparedRun; outcome: Awaited<ReturnType<typeof fulfillStudyProposal>> }> {
  const prepared = await beginQuestion(harness, { chunks, prompt: 'Propose study material' });
  const outcome = await fulfillStudyProposal(harness, prepared, {
    chunks,
    kind,
    scenario,
    provider: mockProvider,
    signal: new AbortController().signal,
  });
  return { prepared, outcome };
}

async function appliedOpCount(app: Db): Promise<number> {
  return (await app.get<{ n: number }>('SELECT COUNT(*) AS n FROM applied_ops'))?.n ?? -1;
}

async function appliedOpsSince(app: Db, before: number): Promise<{ kind: string; source: string }[]> {
  return app.all<{ kind: string; source: string }>('SELECT kind, source FROM applied_ops ORDER BY rowid LIMIT -1 OFFSET ?', [before]);
}

async function tableCount(app: Db, table: string): Promise<number> {
  return (await app.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? -1;
}

async function confirmCurrent(
  harness: SqlExecutor,
  app: Db,
  sessionId: string,
  confirmed = true,
) {
  const session = await getSession(harness, sessionId);
  assert.ok(session?.pendingOperationId);
  return confirmStudyProposal(harness, app, {
    sessionId,
    operationId: session.pendingOperationId,
    confirmed,
  });
}

/* ---------------------------------------------------------- registries */

test('study tools have their own registry and never join the live set', () => {
  assert.deepEqual(Object.keys(TOOL_REGISTRY).sort(), ['notes.proposeAnnotation', 'notes.proposeChunkEdit'].sort());
  assertRegistryIsNotesOnly();
  assert.deepEqual(Object.keys(STUDY_TOOL_REGISTRY).sort(), [...STUDY_TOOL_NAMES].sort());
  assertStudyRegistry();
  for (const tool of STUDY_TOOL_NAMES) {
    assert.ok(!(ALLOWED_TOOL_NAMES as readonly string[]).includes(tool));
  }
});

test('the notes tool registry still rejects a study tool name', () => {
  assert.throws(() => parseStudyProposeInput({}), /unexpected or missing fields/);
  assert.ok(!('study.proposeDeck' in TOOL_REGISTRY));
});

/* ---------------------------------------------------------- determinism */

test('same selection and prompt always yield the same mock proposal', async () => {
  for (const tool of STUDY_TOOL_NAMES) {
    const input = studyInput('room-1', ['chunk-b', 'chunk-a']);
    const first = await mockComplete({ tool, input, scenario: 'success' }, new AbortController().signal);
    const second = await mockComplete({ tool, input, scenario: 'success' }, new AbortController().signal);
    assert.deepEqual(second, first);
  }
  const deck = (await mockComplete(
    { tool: STUDY_DECK_TOOL_NAME, input: studyInput('room-1', ['chunk-a', 'chunk-b']), scenario: 'success' },
    new AbortController().signal,
  )) as StudyDeckDraft;
  assert.deepEqual(
    deck.cards.map((card) => card.front),
    ['What are the main ideas across 2 notes?', 'Recall: study body of chunk-a', 'Recall: study body of chunk-b'],
  );
  // Chunk order does not matter: the generator sorts by id.
  const reordered = (await mockComplete(
    { tool: STUDY_DECK_TOOL_NAME, input: studyInput('room-1', ['chunk-b', 'chunk-a']), scenario: 'success' },
    new AbortController().signal,
  )) as StudyDeckDraft;
  assert.deepEqual(reordered, deck);
});

/* ---------------------------------------------------------- mock mapping */

test('mock study scenarios map onto the shared harness codes', async () => {
  const input = studyInput('room-1', ['chunk-a']);
  await assert.rejects(
    mockStudyComplete({ tool: STUDY_DECK_TOOL_NAME, input, scenario: 'timeout' }, new AbortController().signal),
    /timed out/,
  );
  await assert.rejects(
    mockStudyComplete({ tool: STUDY_QUIZ_TOOL_NAME, input, scenario: 'error' }, new AbortController().signal),
    /failed before answering/,
  );
  await assert.rejects(
    mockStudyComplete({ tool: STUDY_OUTLINE_TOOL_NAME, input, scenario: 'oversize' }, new AbortController().signal),
    /output limit|oversize/i,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    mockStudyComplete({ tool: STUDY_DECK_TOOL_NAME, input, scenario: 'success' }, cancelled.signal),
    /cancelled/i,
  );
  await assert.rejects(
    // @ts-expect-error unknown scenario on purpose
    mockStudyComplete({ tool: STUDY_DECK_TOOL_NAME, input, scenario: 'nope' }, new AbortController().signal),
    /scenario is unknown/,
  );
});

test('mock study input bounds reject without output', async () => {
  const many = Array.from({ length: 201 }, (_, index) => ({
    id: `chunk-${index}`,
    roomId: 'room-1',
    text: 'body',
    revision: 1,
  }));
  await assert.rejects(
    mockStudyComplete(
      { tool: STUDY_DECK_TOOL_NAME, input: { roomId: 'room-1', prompt: 'p', chunks: many, priorMessages: [] }, scenario: 'success' },
      new AbortController().signal,
    ),
    /at most 200|request limit/i,
  );
  const huge = {
    roomId: 'room-1',
    prompt: 'p',
    chunks: [{ id: 'chunk-big', roomId: 'room-1', text: 'x'.repeat(1024 * 1024 + 1), revision: 1 }],
    priorMessages: [],
  };
  await assert.rejects(
    mockStudyComplete({ tool: STUDY_QUIZ_TOOL_NAME, input: huge, scenario: 'success' }, new AbortController().signal),
    /exceed|request limit/i,
  );
  const foreign = {
    roomId: 'room-1',
    prompt: 'p',
    chunks: [
      { id: 'chunk-a', roomId: 'room-1', text: 'body', revision: 1 },
      { id: 'chunk-b', roomId: 'room-2', text: 'body', revision: 1 },
    ],
    priorMessages: [],
  };
  await assert.rejects(
    mockStudyComplete({ tool: STUDY_OUTLINE_TOOL_NAME, input: foreign, scenario: 'success' }, new AbortController().signal),
    /outside the session room/,
  );
  const loud = {
    roomId: 'room-1',
    prompt: 'x'.repeat(8_001),
    chunks: [{ id: 'chunk-a', roomId: 'room-1', text: 'body', revision: 1 }],
    priorMessages: [],
  };
  await assert.rejects(
    mockStudyComplete({ tool: STUDY_DECK_TOOL_NAME, input: loud, scenario: 'success' }, new AbortController().signal),
    /request limit/i,
  );
  const empty = { roomId: 'room-1', prompt: 'p', chunks: [], priorMessages: [] };
  await assert.rejects(
    mockStudyComplete({ tool: STUDY_DECK_TOOL_NAME, input: empty, scenario: 'success' }, new AbortController().signal),
    /at least one chunk/,
  );
});

test('the api-key provider stays disabled for study proposals', async () => {
  const live = createProvider('api-key');
  await assert.rejects(
    completeStudyWithLimits(live as unknown as StudyProvider, {
      tool: STUDY_DECK_TOOL_NAME,
      input: studyInput('room-1', ['chunk-a']),
      scenario: 'success',
    }, new AbortController().signal),
    /disabled/,
  );
});

test('a provider timeout surfaces as a timeout', async () => {
  const hanging: StudyProvider = {
    complete: () => new Promise<unknown>(() => undefined),
  };
  await assert.rejects(
    completeStudyWithLimits(hanging, {
      tool: STUDY_DECK_TOOL_NAME,
      input: studyInput('room-1', ['chunk-a']),
      scenario: 'success',
    }, new AbortController().signal, 5),
    /time limit|timeout/i,
  );
});

/* ---------------------------------------------------------- deck confirm */

test('confirming a deck proposal writes deck and card rows as ai with provenance', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { roomId, chunkIds } = await seedRoom(app, 'biology', ['cells make energy', 'mitosis splits cells']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const { prepared, outcome } = await proposeKind(harness, chunks, 'deck');
    assert.equal(outcome.status, 'proposal');
    const proposal = outcome.proposal;
    assert.ok(proposal && isStudyDeckProposal(proposal));
    assert.equal(proposal.cards.length, 3);
    assert.deepEqual([...proposal.sourceChunkIds].sort(), [...chunkIds].sort());

    const saved = await confirmCurrent(harness, app, prepared.sessionId);
    assert.equal(saved.replayed, false);
    assert.equal(saved.kind, 'deck');
    assert.ok(saved.deckId);
    assert.equal(saved.cardIds?.length, 3);

    const deck = await getStudyDeck(app, saved.deckId ?? '');
    assert.ok(deck);
    assert.equal(deck.roomId, roomId);
    assert.deepEqual([...deck.sourceChunkIds].sort(), [...chunkIds].sort());
    assert.equal(deck.sourceRevision, Math.max(...chunks.map((chunk) => chunk.revision)));
    const cards = await listStudyCards(app, saved.deckId ?? '');
    assert.equal(cards.length, 3);
    for (const card of cards) {
      assert.ok(card.sourceChunkIds.length >= 1);
      assert.ok(card.sourceRevision >= 1);
    }
    const fresh = await appliedOpsSince(app, opsBefore);
    assert.deepEqual(
      fresh.map((op) => op.kind),
      ['study.deck.create', 'study.card.create', 'study.card.create', 'study.card.create'],
    );
    assert.ok(fresh.every((op) => op.source === 'ai'));

    const replay = await confirmStudyProposal(harness, app, {
      sessionId: prepared.sessionId,
      operationId: saved.operationId,
      confirmed: true,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.deckId, saved.deckId);
    assert.equal(await tableCount(app, 'study_decks'), 1);
  } finally {
    app.close();
    harness.close();
  }
});

test('confirming a quiz proposal writes quiz and question rows with kinds and provenance', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'physics', ['force moves mass', 'energy is conserved']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const { prepared, outcome } = await proposeKind(harness, chunks, 'quiz');
    assert.equal(outcome.status, 'proposal');
    assert.ok(outcome.proposal && outcome.proposal.type === 'study_quiz');

    const saved = await confirmCurrent(harness, app, prepared.sessionId);
    assert.equal(saved.kind, 'quiz');
    assert.ok(saved.quizId);
    const quiz = await getStudyQuiz(app, saved.quizId ?? '');
    assert.ok(quiz);
    assert.deepEqual([...quiz.sourceChunkIds].sort(), [...chunkIds].sort());
    const questions = await listStudyQuestions(app, saved.quizId ?? '');
    assert.equal(questions.length, 3);
    assert.deepEqual(
      questions.map((question) => question.kind),
      ['mcq', 'mcq', 'true_false'],
    );
    const mcq = questions[0];
    assert.ok(mcq && mcq.choices.length === 4 && mcq.choices.includes(mcq.answer));
    assert.equal(saved.questionIds?.length, 3);
    const fresh = await appliedOpsSince(app, opsBefore);
    assert.deepEqual(
      fresh.map((op) => op.kind),
      ['study.quiz.create', 'study.question.create', 'study.question.create', 'study.question.create'],
    );
    assert.ok(fresh.every((op) => op.source === 'ai'));
  } finally {
    app.close();
    harness.close();
  }
});

test('confirming an outline proposal writes one outline row with slides', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'history', ['rome fell slowly', 'grain fed the city', 'roads carried news']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const { prepared, outcome } = await proposeKind(harness, chunks, 'outline');
    assert.equal(outcome.status, 'proposal');
    assert.ok(outcome.proposal && outcome.proposal.type === 'study_outline');

    const saved = await confirmCurrent(harness, app, prepared.sessionId);
    assert.equal(saved.kind, 'outline');
    assert.ok(saved.outlineId);
    const outline = await getSlideOutline(app, saved.outlineId ?? '');
    assert.ok(outline);
    assert.equal(outline.slides.length, 4);
    assert.deepEqual([...outline.sourceChunkIds].sort(), [...chunkIds].sort());
    const fresh = await appliedOpsSince(app, opsBefore);
    assert.deepEqual(
      fresh.map((op) => op.kind),
      ['study.slide-outline.create'],
    );
    assert.ok(fresh.every((op) => op.source === 'ai'));
  } finally {
    app.close();
    harness.close();
  }
});

test('title and difficulty options pass through to the draft', async () => {
  const harness = await harnessDb();
  try {
    const chunks = [view('chunk-a'), view('chunk-b')];
    const prepared = await beginQuestion(harness, { chunks, prompt: 'Make a deck' });
    const outcome = await fulfillStudyProposal(harness, prepared, {
      chunks,
      kind: 'deck',
      scenario: 'success',
      provider: mockProvider,
      signal: new AbortController().signal,
      title: 'Cell basics',
      difficulty: 'easy',
    });
    assert.equal(outcome.status, 'proposal');
    const proposal = outcome.proposal;
    assert.ok(proposal && isStudyDeckProposal(proposal));
    assert.equal(proposal.title, 'Cell basics');
    assert.ok(proposal.cards.every((card) => card.difficulty === 'easy'));
  } finally {
    harness.close();
  }
});

/* ---------------------------------------------------------- scope */

test('a foreign selection is rejected before any session exists', async () => {
  const harness = await harnessDb();
  try {
    await assert.rejects(
      beginQuestion(harness, { chunks: [view('chunk-a', 'room-1'), view('chunk-b', 'room-2')], prompt: 'Why?' }),
      /one room/,
    );
    const sessions = await harness.get<{ count: number }>('SELECT COUNT(*) AS count FROM harness_sessions');
    assert.equal(sessions?.count, 0);
  } finally {
    harness.close();
  }
});

test('a draft grounded on unselected chunks is rejected and writes nothing', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'scope', ['alpha note', 'beta note']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const prepared = await beginQuestion(harness, { chunks, prompt: 'Propose' });
    const tampered: StudyProvider = {
      async complete() {
        const good = (await mockStudyComplete(
          { tool: STUDY_DECK_TOOL_NAME, input: studyInput(chunks[0]?.roomId ?? '', chunkIds), scenario: 'success' },
          new AbortController().signal,
        )) as StudyDeckDraft;
        return {
          ...good,
          sourceChunkIds: [...good.sourceChunkIds, 'chunk:foreign'],
          cards: [
            ...good.cards,
            {
              front: 'Foreign',
              back: 'Not selected',
              position: good.cards.length,
              difficulty: 'medium',
              sourceChunkIds: ['chunk:foreign'],
              sourceRevision: 1,
            },
          ],
        };
      },
    };
    const outcome = await fulfillStudyProposal(harness, prepared, {
      chunks,
      kind: 'deck',
      scenario: 'success',
      provider: tampered,
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.errorCode, 'scope_rejected');
    assert.equal(outcome.proposal, null);
    assert.equal(await appliedOpCount(app), opsBefore);
    assert.equal(await tableCount(app, 'study_decks'), 0);
    // The session stays usable: a fresh proposal on the same selection works.
    const retry = await fulfillStudyProposal(
      harness,
      await beginQuestion(harness, { chunks, prompt: 'Propose again', continueSessionId: prepared.sessionId }),
      { chunks, kind: 'deck', scenario: 'success', provider: mockProvider, signal: new AbortController().signal },
    );
    assert.equal(retry.status, 'proposal');
  } finally {
    app.close();
    harness.close();
  }
});

test('the notes confirm path rejects a study proposal', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'guard', ['guarded note']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const { prepared, outcome } = await proposeKind(harness, chunks, 'deck');
    assert.equal(outcome.status, 'proposal');
    const session = await getSession(harness, prepared.sessionId);
    await assert.rejects(
      confirmFoundationQuestion(harness, app, {
        sessionId: prepared.sessionId,
        operationId: session?.pendingOperationId ?? '',
        confirmed: true,
      }),
      /study path/,
    );
    assert.equal(await appliedOpCount(app), opsBefore);
  } finally {
    app.close();
    harness.close();
  }
});

/* ---------------------------------------------------------- decline / cancel / late */

test('declining a study proposal writes nothing and keeps the session usable', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'decline', ['declined note']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const { prepared, outcome } = await proposeKind(harness, chunks, 'quiz');
    assert.equal(outcome.status, 'proposal');
    await discardQuestion(harness, prepared.sessionId);
    const session = await getSession(harness, prepared.sessionId);
    assert.equal(session?.proposal, null);
    await assert.rejects(
      confirmStudyProposal(harness, app, {
        sessionId: prepared.sessionId,
        operationId: outcome.session?.pendingOperationId ?? 'missing',
        confirmed: true,
      }),
      /no saved operation id|no study proposal/,
    );
    assert.equal(await appliedOpCount(app), opsBefore);
    assert.equal(await tableCount(app, 'study_quizzes'), 0);
    const again = await beginQuestion(harness, { chunks, prompt: 'Ask again', continueSessionId: prepared.sessionId });
    assert.ok(again.sessionId);
  } finally {
    app.close();
    harness.close();
  }
});

test('cancelling a study run writes nothing and keeps the session usable', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'cancel', ['cancelled note']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const prepared = await beginQuestion(harness, { chunks, prompt: 'Propose' });
    const controller = new AbortController();
    controller.abort();
    const outcome = await fulfillStudyProposal(harness, prepared, {
      chunks,
      kind: 'outline',
      scenario: 'success',
      provider: mockProvider,
      signal: controller.signal,
    });
    assert.equal(outcome.status, 'cancelled');
    assert.equal(outcome.proposal, null);
    assert.equal(await appliedOpCount(app), opsBefore);
    const again = await beginQuestion(harness, { chunks, prompt: 'Ask again', continueSessionId: prepared.sessionId });
    assert.ok(again.sessionId);
  } finally {
    app.close();
    harness.close();
  }
});

test('a late study result is discarded and writes nothing', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'late', ['late note']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const prepared = await beginQuestion(harness, { chunks, prompt: 'Propose' });
    await cancelRun(harness, { sessionId: prepared.sessionId, runToken: prepared.runToken, now: 2_000 });
    const outcome = await fulfillStudyProposal(harness, prepared, {
      chunks,
      kind: 'deck',
      scenario: 'success',
      provider: mockProvider,
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, 'discarded');
    assert.equal(outcome.proposal, null);
    assert.equal(await appliedOpCount(app), opsBefore);
    assert.equal(await tableCount(app, 'study_decks'), 0);
  } finally {
    app.close();
    harness.close();
  }
});

test('an unconfirmed study save is rejected and writes nothing', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'unconfirmed', ['patient note']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    const { prepared, outcome } = await proposeKind(harness, chunks, 'deck');
    assert.equal(outcome.status, 'proposal');
    await assert.rejects(confirmCurrent(harness, app, prepared.sessionId, false), /confirmation_required|only after you confirm/);
    assert.equal(await appliedOpCount(app), opsBefore);
    assert.equal(await tableCount(app, 'study_decks'), 0);
  } finally {
    app.close();
    harness.close();
  }
});

/* ---------------------------------------------------------- stale / limits */

test('a source edit between propose and confirm rejects as stale, then a retry saves', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'stale', ['fresh note', 'steady note']);
    const chunks = await chunkViews(app, chunkIds);
    const { prepared, outcome } = await proposeKind(harness, chunks, 'deck');
    assert.equal(outcome.status, 'proposal');

    const before = await getChunk(app, chunkIds[0] ?? '');
    assert.ok(before);
    const commit = createCommit(app, { now: () => 2_000, newId: () => globalThis.crypto.randomUUID() });
    const edited = await commit({
      opId: globalThis.crypto.randomUUID(),
      kind: 'chunk.update',
      payload: { chunkId: chunkIds[0] ?? '', body: 'fresh note, rewritten' },
      source: 'human',
      confirmed: false,
      expectedRevision: before.revision,
    });
    assert.ok(edited.ok);

    await assert.rejects(confirmCurrent(harness, app, prepared.sessionId), /stale_revision|changed after the proposal/);
    assert.equal(await tableCount(app, 'study_decks'), 0);

    // Retry with fresh chunks: the stale draft is discarded first, then a
    // new run replaces it and confirms cleanly.
    await discardQuestion(harness, prepared.sessionId);
    const fresh = await chunkViews(app, chunkIds);
    const again = await beginQuestion(harness, { chunks: fresh, prompt: 'Propose again', continueSessionId: prepared.sessionId });
    const retry = await fulfillStudyProposal(harness, again, {
      chunks: fresh,
      kind: 'deck',
      scenario: 'success',
      provider: mockProvider,
      signal: new AbortController().signal,
    });
    assert.equal(retry.status, 'proposal');
    const saved = await confirmCurrent(harness, app, prepared.sessionId);
    assert.equal(saved.kind, 'deck');
    assert.ok(saved.deckId);
    assert.equal(await tableCount(app, 'study_decks'), 1);
  } finally {
    app.close();
    harness.close();
  }
});

test('study error paths fail the run without writing and keep the session usable', async () => {
  const app = nodeDb();
  await migrateDb(app);
  const harness = await harnessDb();
  try {
    const { chunkIds } = await seedRoom(app, 'errors', ['error note']);
    const opsBefore = await appliedOpCount(app);
    const chunks = await chunkViews(app, chunkIds);
    for (const [scenario, code] of [['timeout', 'timeout'], ['error', 'provider_error'], ['oversize', 'output_limit']] as const) {
      const prepared = await beginQuestion(harness, { chunks, prompt: `Propose ${scenario}` });
      const outcome = await fulfillStudyProposal(harness, prepared, {
        chunks,
        kind: 'quiz',
        scenario,
        provider: mockProvider,
        signal: new AbortController().signal,
      });
      assert.equal(outcome.status, 'failed');
      assert.equal(outcome.errorCode, code);
      assert.equal(outcome.proposal, null);
      const continued = await beginQuestion(harness, { chunks, prompt: 'Ask again', continueSessionId: prepared.sessionId });
      assert.ok(continued.sessionId);
    }
    assert.equal(await appliedOpCount(app), opsBefore);
    assert.equal(await tableCount(app, 'study_quizzes'), 0);
  } finally {
    app.close();
    harness.close();
  }
});

test('an outline over the commit slide cap fails at propose time', async () => {
  const harness = await harnessDb();
  try {
    const chunks = Array.from({ length: 60 }, (_, index) => view(`chunk-${index}`, 'room-cap', `body ${index}`));
    const prepared = await beginQuestion(harness, { chunks, prompt: 'Outline everything' });
    const outcome = await fulfillStudyProposal(harness, prepared, {
      chunks,
      kind: 'outline',
      scenario: 'success',
      provider: mockProvider,
      signal: new AbortController().signal,
    });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.errorCode, 'output_limit');
    assert.equal(outcome.proposal, null);
  } finally {
    harness.close();
  }
});

test('study ops need an explicit confirmation at the commit boundary', async () => {
  const app = nodeDb();
  await migrateDb(app);
  try {
    const commit = createCommit(app, { now: () => 1_000, newId: () => globalThis.crypto.randomUUID() });
    const room = await commit({
      opId: globalThis.crypto.randomUUID(),
      kind: 'room.create',
      payload: { name: 'gate' },
      source: 'human',
      confirmed: false,
    });
    assert.ok(room.ok);
    const denied = await commit({
      opId: globalThis.crypto.randomUUID(),
      kind: 'study.deck.create',
      payload: { roomId: room.value.roomId, title: 'Nope', sourceChunkIds: ['chunk-a'], sourceRevision: 1 },
      source: 'ai',
      confirmed: false,
    });
    assert.ok(!denied.ok);
    assert.equal(denied.error.code, 'unconfirmed');
  } finally {
    app.close();
  }
});

/* ---------------------------------------------------------- cross-checks */

test('study proposals serialize through the session row and read back intact', async () => {
  const harness = await harnessDb();
  try {
    const chunks = [view('chunk-a'), view('chunk-b', 'room-1', 'second body', 4)];
    for (const kind of ['deck', 'quiz', 'outline'] as const) {
      const prepared = await beginQuestion(harness, { chunks, prompt: `Propose ${kind}` });
      const outcome = await fulfillStudyProposal(harness, prepared, {
        chunks,
        kind,
        scenario: 'success',
        provider: mockProvider,
        signal: new AbortController().signal,
      });
      assert.equal(outcome.status, 'proposal');
      const stored = await getSession(harness, prepared.sessionId);
      assert.ok(stored?.proposal && isStudyProposal(stored.proposal));
      const proposal: StoredProposal = stored.proposal;
      assert.deepEqual([...proposal.sourceChunkIds].sort(), ['chunk-a', 'chunk-b']);
      assert.deepEqual(proposal.chunkRevisions, { 'chunk-a': 1, 'chunk-b': 4 });
      assert.equal(proposal.sourceRevision, 4);
    }
  } finally {
    harness.close();
  }
});

test('draft and input parsers reject unknown tools and shapes', async () => {
  const input = studyInput('room-1', ['chunk-a']);
  const deck = (await mockStudyComplete(
    { tool: STUDY_DECK_TOOL_NAME, input, scenario: 'success' },
    new AbortController().signal,
  )) as StudyDeckDraft;
  assert.equal(deck.roomId, 'room-1');
  const quiz = (await mockStudyComplete(
    { tool: STUDY_QUIZ_TOOL_NAME, input, scenario: 'success' },
    new AbortController().signal,
  )) as StudyQuizDraft;
  assert.ok(quiz.questions.length >= 2);
  const outline = (await mockStudyComplete(
    { tool: STUDY_OUTLINE_TOOL_NAME, input, scenario: 'success' },
    new AbortController().signal,
  )) as StudySlideOutlineDraft;
  assert.ok(outline.slides.length >= 2);
  assert.throws(() => parseStudyProposeInput({ ...input, roomId: 7 }), /roomId/);
});
