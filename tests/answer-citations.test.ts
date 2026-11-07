import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HarnessError } from '../src/harness/contract.ts';
import {
  BAD_ANCHOR_MESSAGE,
  MISSING_CHUNK_MESSAGE,
  STALE_REVISION_MESSAGE,
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

test('a newer chunk revision is a visible stale error and the passage still cites', () => {
  const edited = { ...sugar, revision: 2 };
  const { citations, problems } = citationsForProposal(
    [sugar.id],
    [edited],
    { chunkId: sugar.id, anchorStart: 0, anchorEnd: 4, chunkRevision: 1 },
  );
  assert.equal(problems[0]?.code, 'stale_revision');
  assert.equal(problems[0]?.message, STALE_REVISION_MESSAGE);
  assert.equal(citations[0]?.quote, 'phot');
});

test('a pinned annotation cites its saved range or shows a bad anchor', () => {
  const saved = citationFromAnnotation(sugar.body, { start: 15, end: 20 });
  assert.equal(saved.ok && saved.quote, 'makes');
  const broken = citationFromAnnotation(sugar.body, { start: 0, end: 400 });
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.message, BAD_ANCHOR_MESSAGE);
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
