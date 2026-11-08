import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dueItemReviewId, planToday, TODAY_LIMIT } from '../src/data/today.ts';
import type { DueAnswer, DueChunk } from '../src/data/models.ts';
import type { ReviewState } from '../src/db/schema.ts';

function due(id: string, state: ReviewState, dueAt: number): DueChunk {
  return {
    chunk: {
      id,
      roomId: 'room-1',
      position: 0,
      body: id,
      subjects: [],
      sourceLink: null,
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
    },
    mark: {
      chunkId: id,
      state,
      localDay: '2026-11-07',
      markedAt: dueAt,
      dueAt,
      timeZone: 'UTC',
    },
  };
}

test('a due answer opens by its annotation id and a due note by its chunk id', () => {
  const note = due('chunk-1', 'missed', 5);
  const answer: DueAnswer = {
    chunk: { ...note.chunk, id: 'chunk-1' },
    annotation: {
      id: 'ann-1',
      chunkId: 'chunk-1',
      type: 'ai_answer',
      anchor: { start: 0, end: 4 },
      payload: { answer: 'saved' },
      createdAt: 1,
      updatedAt: 1,
    },
    mark: null,
  };
  assert.equal(dueItemReviewId(note), 'chunk-1');
  assert.equal(dueItemReviewId(answer), 'ann-1');
  assert.notEqual(dueItemReviewId(answer), answer.chunk.id);
});

test('Today orders missed, then unclear, then got it, longest due first', () => {
  const input = [
    due('got-late', 'got_it', 50),
    due('missed-newer', 'missed', 40),
    due('unclear', 'unclear', 10),
    due('missed-older', 'missed', 5),
    due('got-early', 'got_it', 1),
  ];
  const planned = planToday(input);
  assert.deepEqual(planned.map((item) => item.chunk.id), [
    'missed-older',
    'missed-newer',
    'unclear',
    'got-early',
    'got-late',
  ]);
  assert.deepEqual(input.map((item) => item.chunk.id), [
    'got-late',
    'missed-newer',
    'unclear',
    'missed-older',
    'got-early',
  ]);
});

test('the same due time keeps a stable chunk id order and the list stops at ten', () => {
  const input = Array.from({ length: 12 }, (_, index) => due(`chunk-${String(index).padStart(2, '0')}`, 'missed', 20));
  input.push(due('chunk-00-tie', 'missed', 20));
  const planned = planToday(input);
  assert.equal(planned.length, TODAY_LIMIT);
  assert.equal(TODAY_LIMIT, 10);
  assert.deepEqual(planned.map((item) => item.chunk.id), [
    'chunk-00',
    'chunk-00-tie',
    'chunk-01',
    'chunk-02',
    'chunk-03',
    'chunk-04',
    'chunk-05',
    'chunk-06',
    'chunk-07',
    'chunk-08',
  ]);
  assert.equal(planToday([]).length, 0);
});
