import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit, type CommitDeps } from '../src/data/commit.ts';
import type { ReviewState } from '../src/db/schema.ts';
import { getChunk, latestReviewMark, listDueChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DUE_AFTER: Record<ReviewState, number> = {
  missed: 10 * MINUTE,
  unclear: DAY,
  got_it: 3 * DAY,
};

function commitAt(now: number) {
  const db = nodeDb();
  let id = 0;
  const deps: CommitDeps = { now: () => now, newId: () => `id-${++id}` };
  return { db, commit: createCommit(db, deps) };
}

async function chunk(now: number, body = 'photosynthesis makes sugar') {
  const s = commitAt(now);
  await migrateDb(s.db);
  const room = await s.commit({
    opId: 'room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  if (!room.ok) throw new Error(room.error.message);
  const created = await s.commit({
    opId: 'chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: [body] },
  });
  if (!created.ok) throw new Error(created.error.message);
  const chunkId = created.value.chunkIds[0];
  if (!chunkId) throw new Error('the chunk was not created');
  return { ...s, roomId: room.value.roomId, chunkId };
}

test('each review rating saves that state and its fixed due time', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  for (const state of ['missed', 'unclear', 'got_it'] as const) {
    const s = await chunk(now, state);
    const saved = await s.commit({
      opId: `mark-${state}`,
      kind: 'review.mark',
      source: 'human',
      confirmed: false,
      expectedRevision: 1,
      payload: { chunkId: s.chunkId ?? '', state, timeZone: 'UTC' },
    });
    assert.equal(saved.ok, true);
    if (!saved.ok || !s.chunkId) return;
    assert.equal(saved.value.state, state);
    assert.equal(saved.value.localDay, '2026-11-07');
    assert.equal(saved.value.markedAt, now);
    assert.equal(saved.value.dueAt, now + DUE_AFTER[state]);
    const stored = await latestReviewMark(s.db, s.chunkId);
    assert.equal(stored?.dueAt, now + DUE_AFTER[state]);
    const noted = await getChunk(s.db, s.chunkId);
    assert.equal(noted?.revision, 1);
    assert.equal(noted?.body, state);
    const marks = await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks');
    const annotations = await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM annotations');
    assert.equal(marks?.n, 1);
    assert.equal(annotations?.n, 0);
    s.db.close();
  }
});

test('due now returns chunks whose latest mark is due, soonest first', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const s = await chunk(now);
  assert.ok(s.chunkId && s.roomId);
  if (!s.chunkId || !s.roomId) return;
  const second = await s.commit({
    opId: 'chunk-2',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: s.roomId, bodies: ['mitochondria'] },
  });
  const third = await s.commit({
    opId: 'chunk-3',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: s.roomId, bodies: ['not reviewed'] },
  });
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  if (!second.ok || !third.ok) return;
  const missedId = s.chunkId;
  const laterId = second.value.chunkIds[0] ?? '';
  await s.commit({
    opId: 'mark-missed',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: missedId, state: 'missed', timeZone: 'UTC' },
  });
  const moved = createCommit(s.db, { now: () => now + DAY, newId: () => 'later-id' });
  await moved({
    opId: 'mark-got-it',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: laterId, state: 'got_it', timeZone: 'UTC' },
  });

  const before = await listDueChunks(s.db, now + 10 * MINUTE - 1);
  assert.deepEqual(before.map((item) => item.chunk.id), []);
  const due = await listDueChunks(s.db, now + 10 * MINUTE);
  assert.deepEqual(due.map((item) => item.chunk.id), [missedId]);
  assert.equal(due[0]?.mark.state, 'missed');
  assert.equal(due[0]?.mark.dueAt, now + 10 * MINUTE);
  const both = await listDueChunks(s.db, now + DAY + 3 * DAY);
  assert.deepEqual(both.map((item) => item.chunk.id), [missedId, laterId]);

  const replaced = createCommit(s.db, { now: () => now + 2 * DAY, newId: () => 'replace-id' });
  const again = await replaced({
    opId: 'mark-got-it-later',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: missedId, state: 'got_it', timeZone: 'UTC' },
  });
  assert.equal(again.ok, true);
  const after = await listDueChunks(s.db, now + 10 * MINUTE);
  assert.deepEqual(after.map((item) => item.chunk.id), []);
  const current = await latestReviewMark(s.db, missedId);
  assert.equal(current?.state, 'got_it');
  assert.equal(current?.dueAt, now + 2 * DAY + 3 * DAY);
  s.db.close();
});

test('the same local day replaces one row and the next day keeps the latest due', async () => {
  const evening = Date.parse('2026-11-08T06:30:00Z');
  const nextMorning = Date.parse('2026-11-08T07:30:00Z');
  const s = await chunk(evening);
  assert.ok(s.chunkId);
  if (!s.chunkId) return;
  const first = await s.commit({
    opId: 'mark-unclear',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, state: 'unclear', timeZone: 'America/Cambridge_Bay' },
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.localDay, '2026-11-07');
  const sameDay = createCommit(s.db, { now: () => evening + 10 * MINUTE, newId: () => 'same-day' });
  const second = await sameDay({
    opId: 'mark-got-it-same-day',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, state: 'got_it', timeZone: 'America/Cambridge_Bay' },
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.value.localDay, '2026-11-07');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 1);
  const nextDay = createCommit(s.db, { now: () => nextMorning, newId: () => 'next-day' });
  const third = await nextDay({
    opId: 'mark-missed-next-day',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, state: 'missed', timeZone: 'America/Cambridge_Bay' },
  });
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.equal(third.value.localDay, '2026-11-08');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 2);
  const latest = await latestReviewMark(s.db, s.chunkId);
  assert.equal(latest?.state, 'missed');
  assert.equal(latest?.dueAt, nextMorning + 10 * MINUTE);
  const replay = await nextDay({
    opId: 'mark-missed-next-day',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, state: 'got_it', timeZone: 'America/Cambridge_Bay' },
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.duplicate, true);
  assert.equal(replay.value.state, 'missed');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 2);
  s.db.close();
});

test('a stale revision or a non-human source writes no review mark', async () => {
  const now = Date.parse('2026-11-07T15:00:00Z');
  const s = await chunk(now);
  assert.ok(s.chunkId);
  if (!s.chunkId) return;
  const edited = await s.commit({
    opId: 'edit',
    kind: 'chunk.update',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, body: 'edited sugar' },
  });
  assert.equal(edited.ok, true);
  const stale = await s.commit({
    opId: 'stale-mark',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: s.chunkId, state: 'got_it', timeZone: 'UTC' },
  });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.error.code, 'stale_revision');
  const ai = await s.commit({
    opId: 'ai-mark',
    kind: 'review.mark',
    source: 'ai',
    confirmed: true,
    expectedRevision: 2,
    payload: { chunkId: s.chunkId, state: 'got_it', timeZone: 'UTC' },
  });
  const imported = await s.commit({
    opId: 'import-mark',
    kind: 'review.mark',
    source: 'import',
    confirmed: true,
    expectedRevision: 2,
    payload: { chunkId: s.chunkId, state: 'missed', timeZone: 'UTC' },
  });
  const missingRevision = await s.commit({
    opId: 'no-revision',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    payload: { chunkId: s.chunkId, state: 'unclear', timeZone: 'UTC' },
  });
  const badZone = await s.commit({
    opId: 'bad-zone',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 2,
    payload: { chunkId: s.chunkId, state: 'unclear', timeZone: 'Not/AZone' },
  });
  assert.equal(ai.ok, false);
  assert.equal(imported.ok, false);
  assert.equal(missingRevision.ok, false);
  assert.equal(badZone.ok, false);
  if (!ai.ok) assert.equal(ai.error.code, 'forbidden');
  if (!imported.ok) assert.equal(imported.error.code, 'forbidden');
  if (!missingRevision.ok) assert.equal(missingRevision.error.code, 'invalid');
  if (!badZone.ok) assert.equal(badZone.error.code, 'invalid');
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 0);
  const noted = await getChunk(s.db, s.chunkId);
  assert.equal(noted?.body, 'edited sugar');
  assert.equal(noted?.revision, 2);
  const fresh = await s.commit({
    opId: 'fresh-mark',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 2,
    payload: { chunkId: s.chunkId, state: 'unclear', timeZone: 'UTC' },
  });
  assert.equal(fresh.ok, true);
  assert.equal((await getChunk(s.db, s.chunkId))?.revision, 2);
  const removed = await s.commit({
    opId: 'delete-chunk',
    kind: 'chunk.delete',
    source: 'human',
    confirmed: false,
    expectedRevision: 2,
    payload: { chunkId: s.chunkId },
  });
  assert.equal(removed.ok, true);
  assert.equal(await s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks').then((row) => row?.n), 0);
  s.db.close();
});
