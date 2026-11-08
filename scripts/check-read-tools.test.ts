import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HarnessError } from '../src/harness/contract.ts';
import { completeReadTool, mockProvider } from '../src/harness/provider.ts';
import {
  BOARD_TOOL_NAME,
  IMPORT_TOOL_NAME,
  REVIEW_TOOL_NAME,
  parseImportSuggestOutput,
  parseReviewQuestionOutput,
  type BoardStickiesOutput,
  type ImportSuggestOutput,
  type ReviewQuestionOutput,
} from '../src/harness/tools.ts';

const reviewInput = { roomId: 'r1', chunk: { id: 'c1', roomId: 'r1', text: 'Chlorophyll absorbs red and blue light.' } };

test('the mock answers a review question for the chunk it was given', async () => {
  const out = await completeReadTool<ReviewQuestionOutput>(
    mockProvider,
    { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario: 'success' },
    new AbortController().signal,
  );
  assert.equal(out.chunkId, 'c1');
  assert.match(out.answer, /Chlorophyll/);
});

test('a review question about another chunk is rejected', () => {
  assert.throws(
    () => parseReviewQuestionOutput({ chunkId: 'other', question: 'q', answer: 'a' }, reviewInput),
    (error: unknown) => error instanceof HarnessError && error.code === 'scope_rejected',
  );
});

test('a chunk from another room is rejected before the provider runs', async () => {
  await assert.rejects(
    completeReadTool(
      mockProvider,
      { tool: REVIEW_TOOL_NAME, input: { roomId: 'r1', chunk: { id: 'c1', roomId: 'r2', text: 'x' } }, scenario: 'success' },
      new AbortController().signal,
    ),
    (error: unknown) => error instanceof HarnessError && error.code === 'scope_rejected',
  );
});

test('the mock proposes stickies for selected board items', async () => {
  const out = await completeReadTool<BoardStickiesOutput>(
    mockProvider,
    {
      tool: BOARD_TOOL_NAME,
      input: { roomId: 'r1', prompt: 'What comes next?', items: [{ id: 'n1', kind: 'shape', text: 'citrate' }] },
      scenario: 'success',
    },
    new AbortController().signal,
  );
  assert.equal(out.stickies.length, 1);
  assert.match(out.stickies[0]!.text, /citrate/);
});

test('import suggestions match an existing room by name and never invent a room id', async () => {
  const input = {
    notes: [
      { id: 'a', title: 'Biology week 1', text: 'cells' },
      { id: 'b', title: 'Untitled', text: 'misc' },
    ],
    rooms: [{ id: 'room-bio', name: 'Biology' }],
  };
  const out = await completeReadTool<ImportSuggestOutput>(
    mockProvider,
    { tool: IMPORT_TOOL_NAME, input, scenario: 'success' },
    new AbortController().signal,
  );
  assert.deepEqual(out.suggestions.map((s) => s.roomId), ['room-bio', null]);
  assert.throws(
    () => parseImportSuggestOutput({ suggestions: [{ noteId: 'a', roomId: 'made-up', newRoomName: null, subjects: [] }] }, input),
    (error: unknown) => error instanceof HarnessError && error.code === 'scope_rejected',
  );
});

test('mock timeout and error scenarios normalize for read tools', async () => {
  for (const [scenario, code] of [['timeout', 'timeout'], ['error', 'provider_error'], ['oversize', 'output_limit']] as const) {
    await assert.rejects(
      completeReadTool(mockProvider, { tool: REVIEW_TOOL_NAME, input: reviewInput, scenario }, new AbortController().signal),
      (error: unknown) => error instanceof HarnessError && error.code === code,
    );
  }
});
