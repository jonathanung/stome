import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { getChunk, latestReviewMark, listChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { createMarkController } from '../src/features/review/mark-attempt.ts';
import { acknowledgeDisplayedCards, reviewQueueOnOpen } from '../src/features/review/mark-progress.ts';
import { chunksReadyToReview } from '../src/features/review/session.ts';
import { nodeDb } from './support/node-db.ts';

test('recovering an earlier revision leaves the edited note on screen for a new mark', async () => {
  const db = nodeDb();
  await migrateDb(db);
  const now = Date.parse('2026-11-07T18:00:00.000Z');
  const save = createCommit(db, { now: () => now, newId: () => 'unused' });
  const room = await save({
    opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await save({
    opId: 'chunk', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['alpha'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const chunkId = created.value.chunkIds[0];
  assert.ok(chunkId);

  const marks = createMarkController();
  let ids = 0;
  const lost = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => 'UTC',
    request: { chunkId, state: 'missed', expectedRevision: 1 },
    commit: (attempt) => save(attempt),
    report: () => {
      throw new Error('response lost');
    },
  });
  assert.equal(lost.status, 'ambiguous');
  const edited = await save({
    opId: 'edit', kind: 'chunk.update', source: 'human', confirmed: false, expectedRevision: 1,
    payload: { chunkId, body: 'alpha edited' },
  });
  assert.equal(edited.ok, true);

  const chunks = await listChunks(db, room.value.roomId);
  const latest = new Map<string, { dueAt: number }>();
  for (const chunk of chunks) {
    const mark = await latestReviewMark(db, chunk.id);
    if (mark) latest.set(chunk.id, mark);
  }
  const ready = chunksReadyToReview(chunks, latest, now);
  const opened = reviewQueueOnOpen({
    ready,
    all: chunks,
    startId: undefined,
    retainedIds: [chunkId].filter((id) => marks.retained(id)),
  });
  assert.equal(opened[0]?.id, chunkId);
  assert.equal(opened[0]?.revision, 2);
  let screen = {
    cards: opened.map((chunk) => ({ id: chunk.id, revision: chunk.revision, body: chunk.body })),
    done: 0,
  };

  const recovery = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => 'Pacific/Auckland',
    request: { chunkId, state: 'missed', expectedRevision: screen.cards[0]?.revision ?? 0 },
    commit: (attempt) => save(attempt),
    report: (_result, attempt) => {
      const displayed = screen.cards[0];
      assert.ok(displayed);
      const next = acknowledgeDisplayedCards({
        cards: screen.cards,
        done: screen.done,
        displayedId: displayed.id,
        displayedRevision: displayed.revision,
        markedRevision: attempt.expectedRevision,
      });
      screen = { cards: next.cards, done: next.done };
    },
  });
  assert.equal(recovery.status, 'saved');
  if (recovery.status !== 'saved') return;
  assert.equal(recovery.result.duplicate, true);
  assert.equal(screen.done, 0);
  assert.equal(screen.cards.length, 1);
  assert.equal(screen.cards[0]?.revision, 2);
  assert.equal(screen.cards[0]?.body, 'alpha edited');
  assert.equal(await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 1);

  const deliberate = await marks.submit({
    newId: () => `mark-${++ids}`,
    timeZone: () => 'UTC',
    request: { chunkId, state: 'got_it', expectedRevision: screen.cards[0]?.revision ?? 0 },
    commit: (attempt) => save(attempt),
    report: (_result, attempt) => {
      const displayed = screen.cards[0];
      assert.ok(displayed);
      const next = acknowledgeDisplayedCards({
        cards: screen.cards,
        done: screen.done,
        displayedId: displayed.id,
        displayedRevision: displayed.revision,
        markedRevision: attempt.expectedRevision,
      });
      screen = { cards: next.cards, done: next.done };
    },
  });
  assert.equal(deliberate.status, 'saved');
  if (deliberate.status !== 'saved') return;
  assert.equal(deliberate.result.duplicate, false);
  assert.equal(deliberate.result.value.state, 'got_it');
  assert.equal(screen.done, 1);
  assert.equal(screen.cards.length, 0);
  assert.equal(ids, 2);
  assert.equal((await getChunk(db, chunkId))?.revision, 2);
  assert.equal(await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 1);
  assert.equal((await db.get<{ state: string }>('SELECT state FROM review_marks'))?.state, 'got_it');
  db.close();
});
