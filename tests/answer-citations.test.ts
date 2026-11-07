import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HarnessError } from '../src/harness/contract.ts';
import {
  BAD_ANCHOR_MESSAGE,
  MISSING_CHUNK_MESSAGE,
  STALE_PASSAGE_MESSAGE,
  STALE_REVISION_MESSAGE,
  UNVERIFIED_PASSAGE_MESSAGE,
  anchorQuote,
  citationFromAnnotation,
  citationsForProposal,
  visiblePinError,
  type SourceChunk,
} from '../src/features/ask/citations.ts';

const sugar: SourceChunk = { id: 'chunk-sugar', body: 'photosynthesis makes sugar', revision: 1 };
const leaf: SourceChunk = { id: 'chunk-leaf', body: 'a green leaf', revision: 1 };

test('citations quote only the selected chunks and the real anchor text', () => {
  const { citations, problems } = citationsForProposal(
    [sugar.id, leaf.id],
    [sugar, leaf, { id: 'chunk-other', body: 'not selected', revision: 1 }],
    { chunkId: sugar.id, anchorStart: 0, anchorEnd: 12, chunkRevision: 1 },
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(citations.map((citation) => citation.chunkId), [sugar.id, leaf.id]);
  const anchored = citations.find((citation) => citation.anchored);
  assert.equal(anchored?.quote, 'photosynthes');
  assert.equal(anchored?.quote, sugar.body.slice(0, 12));
  assert.equal(citations.find((citation) => citation.chunkId === leaf.id)?.anchored, false);
  assert.equal(citations.some((citation) => citation.chunkId === 'chunk-other'), false);
});

test('a bad anchor and a missing chunk are visible and are not quoted', () => {
  const { citations, problems } = citationsForProposal(
    ['gone', sugar.id],
    [sugar],
    { chunkId: sugar.id, anchorStart: 0, anchorEnd: 99, chunkRevision: 1 },
  );
  assert.deepEqual(citations, []);
  assert.deepEqual(problems.map((problem) => problem.code), ['missing_chunk', 'bad_anchor']);
  assert.equal(problems[0]?.message, MISSING_CHUNK_MESSAGE);
  assert.equal(problems[1]?.message, BAD_ANCHOR_MESSAGE);
  assert.equal(anchorQuote(sugar.body, 0, 99), null);
});

test('a newer chunk revision is a visible stale error and does not quote the current text', () => {
  const edited = { ...sugar, revision: 2 };
  const { citations, problems } = citationsForProposal(
    [sugar.id],
    [edited],
    { chunkId: sugar.id, anchorStart: 0, anchorEnd: 4, chunkRevision: 1 },
  );
  assert.equal(problems[0]?.code, 'stale_revision');
  assert.equal(problems[0]?.message, STALE_REVISION_MESSAGE);
  assert.equal(citations.some((citation) => citation.anchored || citation.quote === 'phot'), false);
});

test('a pinned annotation cites its saved passage only when that text is still there', () => {
  const saved = citationFromAnnotation(sugar.body, { start: 15, end: 20 }, { quote: 'makes', chunkRevision: 1 });
  assert.equal(saved.ok && saved.quote, 'makes');
  const broken = citationFromAnnotation(sugar.body, { start: 0, end: 400 }, { quote: 'makes' });
  assert.equal(broken.ok, false);
  if (!broken.ok) {
    assert.equal(broken.savedQuote, 'makes');
    assert.equal(broken.message.includes('photosynthesis'), false);
  }
});

test('an in-bounds edit of the same length is not attributed as the saved citation', () => {
  const original = 'photosynthesis makes sugar';
  const quote = original.slice(0, 12);
  const mutated = `${'X'.repeat(12)}${original.slice(12)}`;
  assert.equal(mutated.length, original.length);
  assert.notEqual(mutated.slice(0, 12), quote);
  const read = citationFromAnnotation(mutated, { start: 0, end: 12 }, { quote, chunkRevision: 1 });
  assert.equal(read.ok, false);
  if (!read.ok) {
    assert.equal(read.code, 'stale_passage');
    assert.equal(read.message, STALE_PASSAGE_MESSAGE);
    assert.equal(read.savedQuote, quote);
    assert.equal(read.message.includes(mutated.slice(0, 12)), false);
  }
  const oldPin = citationFromAnnotation(mutated, { start: 0, end: 12 }, { answer: 'old pin' });
  assert.equal(oldPin.ok, false);
  if (!oldPin.ok) {
    assert.equal(oldPin.code, 'unverified');
    assert.equal(oldPin.message, UNVERIFIED_PASSAGE_MESSAGE);
    assert.equal(oldPin.savedQuote, null);
    assert.equal(oldPin.message.includes(mutated.slice(0, 12)), false);
  }
});

test('pin failures name stale revision and bad anchor', () => {
  assert.match(
    visiblePinError(new HarnessError('stale_revision', 'The chunk changed after the proposal. Ask again before saving.')),
    /^Stale revision:/,
  );
  assert.match(
    visiblePinError(new HarnessError('bad_anchor', 'The answer anchor does not sit inside the note text')),
    /^Bad anchor:/,
  );
  assert.match(
    visiblePinError(new HarnessError('invalid_shape', 'ai_answer anchor must be a range inside the chunk (0–12)')),
    /^Bad anchor:/,
  );
  assert.match(
    visiblePinError(new Error('chunk changed elsewhere (now revision 2, expected 1)')),
    /^Stale revision:/,
  );
});
