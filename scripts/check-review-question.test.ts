import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HarnessError } from '../src/harness/contract.ts';
import { mockProvider, type Provider } from '../src/harness/provider.ts';
import { NOT_PAIRED_NOTICE, chooseReviewQuestion, questionCacheKey, requestReviewQuestion } from '../src/features/review/question.ts';

const chunk = { id: 'c1', roomId: 'r1', body: 'Chlorophyll absorbs red and blue light.' };

test('the helper returns the mock question and answer', async () => {
  const out = await requestReviewQuestion({
    roomId: 'r1', chunk, provider: mockProvider, scenario: 'success', signal: new AbortController().signal,
  });
  assert.equal(out.source, 'companion');
  assert.equal(out.question, 'What should you remember from this note?');
  assert.equal(out.answer, chunk.body);
});

test('output naming another chunk is rejected', async () => {
  const other: Provider = {
    complete: async () => ({ chunkId: 'c2', question: 'Q?', answer: 'A' }),
  };
  await assert.rejects(
    requestReviewQuestion({ roomId: 'r1', chunk, provider: other, scenario: 'success', signal: new AbortController().signal }),
    (error) => error instanceof HarnessError && error.code === 'scope_rejected',
  );
});

test('an aborted request is cancelled', async () => {
  const controller = new AbortController();
  const pending = requestReviewQuestion({ roomId: 'r1', chunk, provider: mockProvider, scenario: 'cancel', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error instanceof HarnessError && error.code === 'cancelled');
});

test('choosing companion vs local, with the notice', () => {
  const noToken = chooseReviewQuestion({ token: '', result: null });
  assert.deepEqual(noToken, { source: 'local', notice: NOT_PAIRED_NOTICE });

  const failed = chooseReviewQuestion({ token: 't', result: { error: new HarnessError('timeout', 'The companion took too long.') } });
  assert.equal(failed.source, 'local');
  assert.match(failed.notice ?? '', /took too long/);

  const ok = chooseReviewQuestion({ token: 't', result: { source: 'companion', question: 'Q?', answer: 'A' } });
  assert.deepEqual(ok, { source: 'companion', question: 'Q?', answer: 'A', notice: null });
});

test('the cache key changes with revision and body', () => {
  const base = { id: 'c1', revision: 1, body: 'a' };
  assert.notEqual(questionCacheKey(base), questionCacheKey({ ...base, revision: 2 }));
  assert.notEqual(questionCacheKey(base), questionCacheKey({ ...base, body: 'b' }));
});
