import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkAnswer,
  hashString,
  inStudyOrder,
  isStale,
  mockCardForChunk,
  mockDeckForChunks,
  mockQuestionForChunk,
  mockQuizForChunks,
  normalizeTrueFalse,
  ratingToMark,
} from '../src/features/study/session.ts';

test('ratings collapse onto the three review states', () => {
  assert.equal(ratingToMark('again'), 'missed');
  assert.equal(ratingToMark('hard'), 'unclear');
  assert.equal(ratingToMark('good'), 'got_it');
  assert.equal(ratingToMark('easy'), 'got_it');
});

test('hashing is deterministic', () => {
  assert.equal(hashString('cells make energy'), hashString('cells make energy'));
  assert.notEqual(hashString('cells make energy'), hashString('mitosis splits cells'));
});

test('same chunk always yields the same mock card', () => {
  const chunk = { id: 'c1', body: 'Mitochondria make ATP for the cell.', revision: 3 };
  assert.deepEqual(mockCardForChunk(chunk, 0), mockCardForChunk(chunk, 0));
  const other = mockCardForChunk({ ...chunk, body: 'Mitosis splits one cell into two.' }, 0);
  assert.notDeepEqual(mockCardForChunk(chunk, 0), other);
});

test('mock deck keeps input order with one card per chunk', () => {
  const chunks = [
    { id: 'a', body: 'first note body', revision: 1 },
    { id: 'b', body: 'second note body', revision: 2 },
  ];
  const deck = mockDeckForChunks(chunks);
  assert.equal(deck.length, 2);
  assert.deepEqual(deck.map((card) => card.sourceChunkIds), [['a'], ['b']]);
  assert.deepEqual(deck.map((card) => card.position), [0, 1]);
});

test('same chunk always yields the same mock question', () => {
  const chunk = { id: 'c1', body: 'Mitochondria make ATP for the cell.', revision: 1 };
  assert.deepEqual(mockQuestionForChunk(chunk, 0), mockQuestionForChunk(chunk, 0));
  const quiz = mockQuizForChunks([chunk, { id: 'c2', body: 'Mitosis makes two cells.', revision: 1 }]);
  assert.equal(quiz.length, 2);
  // Fixture covers every runner shape across ids.
  const kinds = new Set(
    ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'].map(
      (id) => mockQuestionForChunk({ id, body: `note ${id}`, revision: 1 }, 0).kind,
    ),
  );
  assert.ok(kinds.has('mcq') && kinds.has('true_false') && kinds.has('fill'));
});

test('answer checking: mcq exact, t/f spellings, fill case-insensitive, empty never passes', () => {
  assert.ok(checkAnswer({ kind: 'mcq', answer: 'Mitochondrion', choices: [] }, 'mitochondrion').correct);
  assert.ok(!checkAnswer({ kind: 'mcq', answer: 'Mitochondrion', choices: [] }, 'Nucleus').correct);
  assert.ok(!checkAnswer({ kind: 'mcq', answer: 'Mitochondrion', choices: [] }, '  ').correct);
  assert.ok(checkAnswer({ kind: 'true_false', answer: 'true', choices: [] }, 'T').correct);
  assert.ok(checkAnswer({ kind: 'true_false', answer: 'false', choices: [] }, 'no').correct);
  assert.ok(!checkAnswer({ kind: 'true_false', answer: 'true', choices: [] }, 'maybe').correct);
  assert.ok(checkAnswer({ kind: 'fill', answer: 'mitochondrion', choices: [] }, '  MITOCHONDRION ').correct);
  assert.ok(!checkAnswer({ kind: 'fill', answer: 'mitochondrion', choices: [] }, '').correct);
  assert.equal(normalizeTrueFalse('Yes'), 'true');
  assert.equal(normalizeTrueFalse('0'), 'false');
  assert.equal(normalizeTrueFalse('maybe'), null);
});

test('staleness trips on revision change or missing source', () => {
  const revisions = new Map([['a', 1], ['b', 2]]);
  assert.equal(isStale(1, ['a'], revisions), false);
  assert.equal(isStale(1, ['a', 'b'], revisions), true);
  assert.equal(isStale(9, ['a'], revisions), true);
  assert.equal(isStale(1, ['ghost'], revisions), true);
});

test('study order sorts by position then id without mutating', () => {
  const rows = [
    { id: 'b', position: 0 },
    { id: 'a', position: 0 },
    { id: 'c', position: 1 },
  ];
  const ordered = inStudyOrder(rows);
  assert.deepEqual(ordered.map((row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(rows.map((row) => row.id), ['b', 'a', 'c']);
});
