import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createCommit, type CommitDeps } from '../src/data/commit.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import { listSlideOutlines, listStudyAttempts, listStudyCards, listStudyDecks, listStudyQuestions, listStudyQuizzes } from '../src/data/queries.ts';
import {
  GENERATOR_LIMITS,
  StudyGeneratorError,
  generateDeck,
  generateQuiz,
  generateSlideOutline,
  type StudySourceChunk,
} from '../src/features/study/generator.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

/** One room, two subjects, four chunks (mirrors the epic verification setup). */
function fixtureChunks(): StudySourceChunk[] {
  return [
    {
      id: 'chunk-acid',
      roomId: 'room-biology',
      revision: 1,
      body: 'Acids donate protons in aqueous solution. A lower pH means a stronger acid concentration.',
      subjects: ['Chemistry'],
    },
    {
      id: 'chunk-atp',
      roomId: 'room-biology',
      revision: 3,
      body: 'Mitochondria produce ATP through cellular respiration. Glucose breaks down in the cytoplasm first.',
      subjects: ['Biology'],
    },
    {
      id: 'chunk-mitosis',
      roomId: 'room-biology',
      revision: 2,
      body: 'Mitosis splits one cell into two identical daughter cells. The stages are prophase, metaphase, anaphase, and telophase.',
      subjects: ['Biology'],
    },
    {
      id: 'chunk-photosyn',
      roomId: 'room-biology',
      revision: 5,
      body: 'Photosynthesis converts sunlight into chemical energy. Chlorophyll captures light inside chloroplasts.',
      subjects: ['Chemistry'],
    },
  ];
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof StudyGeneratorError, `expected a StudyGeneratorError, got ${String(error)}`);
    return error.code;
  }
  assert.fail('expected the generator to throw');
}

const generators = {
  generateDeck,
  generateQuiz,
  generateSlideOutline,
} as const;

/* ---------------------------------------------------------- determinism */

test('same chunks always produce byte-identical deck, quiz, and outline', () => {
  const first = fixtureChunks();
  const clone = structuredClone(first).reverse();
  // Reversed input still sorts by chunk id, so selection order cannot fork output.
  assert.equal(JSON.stringify(generateDeck(first)), JSON.stringify(generateDeck(clone)));
  assert.equal(JSON.stringify(generateQuiz(first)), JSON.stringify(generateQuiz(clone)));
  assert.equal(JSON.stringify(generateSlideOutline(first)), JSON.stringify(generateSlideOutline(clone)));

  // Four chunks yield an overview plus one item per chunk.
  assert.equal(generateDeck(first).cards.length, 5);
  assert.equal(generateQuiz(first).questions.length, 5);
  assert.equal(generateSlideOutline(first).slides.length, 5);

  // The quiz cycles the fixed shapes after its overview MCQ.
  assert.deepEqual(
    generateQuiz(first).questions.map((question) => question.kind),
    ['mcq', 'mcq', 'true_false', 'fill', 'mcq'],
  );
});

test('harness text chunks generate the same output as foundation body chunks', () => {
  const bodies = fixtureChunks();
  const texts = bodies.map(({ id, roomId, revision, subjects, ...rest }) => ({
    id,
    roomId,
    revision,
    subjects,
    text: 'body' in rest ? rest.body : '',
  }));
  assert.equal(JSON.stringify(generateDeck(bodies)), JSON.stringify(generateDeck(texts)));
  assert.equal(JSON.stringify(generateQuiz(bodies)), JSON.stringify(generateQuiz(texts)));
});

/* ------------------------------------------------------------ rejections */

test('empty selection is rejected by every generator', () => {
  for (const generate of Object.values(generators)) {
    assert.equal(codeOf(() => generate([])), 'empty_selection');
  }
});

test('cross-room input is rejected as scope_rejected', () => {
  const chunks = fixtureChunks();
  const foreign = { ...chunks[0]!, id: 'chunk-foreign', roomId: 'room-chemistry' };
  for (const generate of Object.values(generators)) {
    assert.equal(codeOf(() => generate([chunks[0]!, foreign])), 'scope_rejected');
  }
});

test('selections over 200 chunks or 1MiB are rejected with no partial output', () => {
  const oneChunk = fixtureChunks()[0]!;
  const tooMany = Array.from({ length: GENERATOR_LIMITS.maxChunks + 1 }, (_, index) => ({
    ...oneChunk,
    id: `chunk-${String(index).padStart(4, '0')}`,
  }));
  for (const generate of Object.values(generators)) {
    assert.equal(codeOf(() => generate(tooMany)), 'too_many_chunks');
  }

  const big = 'x'.repeat(600 * 1024);
  const tooBig = [
    { ...oneChunk, id: 'chunk-big-a', body: big },
    { ...oneChunk, id: 'chunk-big-b', body: big },
  ];
  for (const generate of Object.values(generators)) {
    assert.equal(codeOf(() => generate(tooBig)), 'input_too_large');
  }

  // Boundary selections still succeed: exactly 200 chunks and exactly 1MiB.
  const boundary = Array.from({ length: GENERATOR_LIMITS.maxChunks }, (_, index) => ({
    ...oneChunk,
    id: `chunk-${String(index).padStart(4, '0')}`,
  }));
  assert.equal(generateDeck(boundary).cards.length, GENERATOR_LIMITS.maxChunks + 1);
  const exactBytes = [{ ...oneChunk, id: 'chunk-exact', body: 'y'.repeat(GENERATOR_LIMITS.maxInputBytes) }];
  assert.equal(generateQuiz(exactBytes).questions.length, 2);
});

/* -------------------------------------------------------------- provenance */

test('every card, question, and slide carries source refs and the revision snapshot', () => {
  const chunks = fixtureChunks();
  const deck = generateDeck(chunks);
  const quiz = generateQuiz(chunks);
  const outline = generateSlideOutline(chunks);

  assert.deepEqual(deck.sourceChunkIds, ['chunk-acid', 'chunk-atp', 'chunk-mitosis', 'chunk-photosyn']);
  assert.equal(deck.sourceRevision, 5);
  for (const card of deck.cards) {
    assert.ok(card.sourceChunkIds.length > 0);
    assert.equal(card.sourceRevision, 5);
  }
  // Overview items reference the whole selection; per-chunk items reference one chunk.
  assert.deepEqual(deck.cards[0]!.sourceChunkIds, deck.sourceChunkIds);
  assert.deepEqual(deck.cards[1]!.sourceChunkIds, ['chunk-acid']);

  for (const question of quiz.questions) {
    assert.ok(question.sourceChunkIds.length > 0);
    assert.equal(question.sourceRevision, 5);
  }
  assert.deepEqual(quiz.questions[0]!.sourceChunkIds, quiz.sourceChunkIds);

  for (const slide of outline.slides) {
    assert.ok(slide.sourceChunkIds.length > 0);
    assert.equal(slide.sourceRevision, 5);
  }
  assert.deepEqual(outline.slides[0]!.sourceChunkIds, outline.sourceChunkIds);
});

test('malformed chunks fail closed with no output', () => {
  const good = fixtureChunks()[0]!;
  const malformed: unknown[] = [
    {},
    { roomId: good.roomId, revision: 1, body: 'text' },
    { id: good.id, revision: 1, body: 'text' },
    { id: good.id, roomId: good.roomId, body: 'text' },
    { id: good.id, roomId: good.roomId, revision: 0, body: 'text' },
    { id: good.id, roomId: good.roomId, revision: 1.5, body: 'text' },
    { id: good.id, roomId: good.roomId, revision: 1, body: '   ' },
    { id: '', roomId: good.roomId, revision: 1, body: 'text' },
    { id: 'x'.repeat(65), roomId: good.roomId, revision: 1, body: 'text' },
  ];
  for (const bad of malformed) {
    for (const generate of Object.values(generators)) {
      assert.equal(codeOf(() => generate([bad as StudySourceChunk])), 'invalid_chunk', JSON.stringify(bad));
    }
  }
  const duplicated = [good, { ...good }];
  for (const generate of Object.values(generators)) {
    assert.equal(codeOf(() => generate(duplicated)), 'invalid_chunk');
  }
});

/* ----------------------------------------------------------- mock scenarios */

test('mock error, timeout, and oversize scenarios surface as typed errors', () => {
  const chunks = fixtureChunks();
  const expectations = { timeout: 'timeout', error: 'provider_error', oversize: 'oversize' } as const;
  for (const [scenario, code] of Object.entries(expectations)) {
    for (const generate of Object.values(generators)) {
      assert.equal(
        codeOf(() => generate(chunks, { scenario: scenario as 'timeout' })),
        code,
      );
    }
  }
  // The default scenario succeeds, and unknown options fail closed.
  assert.equal(generateDeck(chunks).cards.length, 5);
  assert.equal(codeOf(() => generateDeck(chunks, { scenario: 'cancel' as never })), 'invalid_options');
  assert.equal(codeOf(() => generateDeck(chunks, { difficulty: 'extreme' as never })), 'invalid_options');
  assert.equal(codeOf(() => generateDeck(chunks, { title: '   ' })), 'invalid_options');
});

test('difficulty passes through onto every item and explanation', () => {
  const chunks = fixtureChunks();
  const quiz = generateQuiz(chunks, { difficulty: 'hard' });
  for (const question of quiz.questions) {
    assert.equal(question.difficulty, 'hard');
    assert.match(question.explanation, /\(hard\)/);
  }
  const deck = generateDeck(chunks);
  for (const card of deck.cards) {
    assert.equal(card.difficulty, 'medium');
  }
  const outline = generateSlideOutline(chunks, { difficulty: 'easy' });
  for (const slide of outline.slides) {
    assert.equal(slide.difficulty, 'easy');
  }
  assert.equal(
    JSON.stringify(generateQuiz(chunks, { difficulty: 'hard' })),
    JSON.stringify(generateQuiz(structuredClone(chunks), { difficulty: 'hard' })),
  );
});

/* ------------------------------------------------------------------- purity */

test('the generator stays dependency-free: no runtime imports, clock, or I/O', () => {
  const path = fileURLToPath(new URL('../src/features/study/generator.ts', import.meta.url));
  const source = readFileSync(path, 'utf8');
  const runtimeImports = [...source.matchAll(/^import(?!\s+type)[^;]+from\s+'([^']+)'/gm)].map((match) => match[1]);
  assert.deepEqual(runtimeImports, []);
  for (const token of ['Math.random', 'Date.now', 'new Date(', 'crypto.', 'fetch(', 'INSERT', 'UPDATE', 'DELETE FROM']) {
    assert.ok(!source.includes(token), `generator must not contain ${token}`);
  }
});

/* ------------------------------------------- commit boundary compatibility */

function testDeps(): CommitDeps {
  let id = 0;
  let clock = 1_000;
  return { newId: () => `id-${++id}`, now: () => (clock += 10) };
}

test('generated drafts commit through FND.2 unchanged, including long bodies', async () => {
  const db = nodeDb();
  try {
    await migrateDb(db);
    const commit = createCommit(db, testDeps());
    let op = 0;
    const op$ = <K extends OpKind>(kind: K, payload: Payloads[K], extra: Partial<Operation<K>> = {}): Operation<K> =>
      ({ opId: `op-${++op}`, kind, payload, source: 'human', confirmed: false, ...extra }) as Operation<K>;

    const room = await commit(op$('room.create', { name: 'biology' }));
    assert.ok(room.ok);
    const roomId = room.value.roomId;
    const longBody = `Stored note body. ${'Long sentence about cells. '.repeat(800)}`;
    const created = await commit(
      op$('chunk.create', { roomId, bodies: ['Mitochondria produce ATP.', longBody] }),
    );
    assert.ok(created.ok);
    const [firstId, secondId] = created.value.chunkIds;
    const chunks: StudySourceChunk[] = [
      { id: firstId!, roomId, revision: 1, body: 'Mitochondria produce ATP.' },
      { id: secondId!, roomId, revision: 1, body: longBody },
    ];

    const deck = generateDeck(chunks);
    const deckResult = await commit(
      op$('study.deck.create', {
        roomId: deck.roomId,
        title: deck.title,
        sourceChunkIds: deck.sourceChunkIds,
        sourceRevision: deck.sourceRevision,
      }, { confirmed: true }),
    );
    assert.ok(deckResult.ok);
    for (const card of deck.cards) {
      const cardOp: Operation<'study.card.create'> = op$('study.card.create', {
        deckId: deckResult.value.deckId,
        roomId,
        front: card.front,
        back: card.back,
        position: card.position,
        sourceChunkIds: card.sourceChunkIds,
        sourceRevision: card.sourceRevision,
      }, { confirmed: true });
      const saved = await commit(cardOp);
      assert.ok(saved.ok, JSON.stringify(card.front));
    }

    const quiz = generateQuiz(chunks);
    const quizResult = await commit(
      op$('study.quiz.create', {
        roomId: quiz.roomId,
        title: quiz.title,
        sourceChunkIds: quiz.sourceChunkIds,
        sourceRevision: quiz.sourceRevision,
      }, { confirmed: true }),
    );
    assert.ok(quizResult.ok);
    for (const question of quiz.questions) {
      const questionOp: Operation<'study.question.create'> = op$('study.question.create', {
        quizId: quizResult.value.quizId,
        roomId,
        kind: question.kind,
        stem: question.stem,
        ...(question.kind === 'mcq' ? { choices: question.choices } : {}),
        answer: question.answer,
        explanation: question.explanation,
        position: question.position,
        sourceChunkIds: question.sourceChunkIds,
        sourceRevision: question.sourceRevision,
      }, { confirmed: true });
      const saved = await commit(questionOp);
      assert.ok(saved.ok, JSON.stringify(question));
    }

    const outline = generateSlideOutline(chunks);
    const outlineResult = await commit(
      op$('study.slide-outline.create', {
        roomId: outline.roomId,
        title: outline.title,
        slides: outline.slides.map(({ title, bullets, notes, sourceChunkIds, sourceRevision }) => ({
          title,
          bullets,
          notes,
          sourceChunkIds,
          sourceRevision,
        })),
        sourceChunkIds: outline.sourceChunkIds,
        sourceRevision: outline.sourceRevision,
      }, { confirmed: true }),
    );
    assert.ok(outlineResult.ok, JSON.stringify(outlineResult));

    assert.equal((await listStudyDecks(db, roomId)).length, 1);
    assert.equal((await listStudyCards(db, deckResult.value.deckId)).length, 3);
    assert.equal((await listStudyQuizzes(db, roomId)).length, 1);
    assert.equal((await listStudyQuestions(db, quizResult.value.quizId)).length, 3);
    assert.equal((await listSlideOutlines(db, roomId)).length, 1);
    assert.equal((await listStudyAttempts(db, quizResult.value.quizId)).length, 0);
  } finally {
    db.close();
  }
});
