import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { MIGRATIONS, SUPPORTED_VERSION } from '../src/db/schema.ts';
import { nodeDb } from './support/node-db.ts';

/**
 * The SQL #79 published as version 5, before #123 reused that version for
 * whiteboards. Kept here so the upgrade test builds that database on purpose.
 */
const REVIEW_MARKS_V5 = `
  CREATE TABLE review_marks (
    chunk_id TEXT NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
    local_day TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    state TEXT NOT NULL CHECK (state IN ('missed', 'unclear', 'got_it')),
    marked_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
    PRIMARY KEY (chunk_id, local_day)
  );
`;

async function applyThrough(db: ReturnType<typeof nodeDb>, version: number, extraSql = ''): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON');
  for (const migration of MIGRATIONS.filter((item) => item.version <= version && item.version < 5)) {
    await db.exec(migration.sql);
  }
  if (version >= 5 && extraSql) await db.exec(extraSql);
  if (version >= 5 && !extraSql) {
    const shipped = MIGRATIONS.find((item) => item.version === 5);
    assert.ok(shipped);
    await db.exec(shipped.sql);
  }
  await db.exec(`PRAGMA user_version = ${version}`);
}

test('version 5 stays the shipped whiteboard migration and version 6 repairs both histories', async () => {
  assert.equal(MIGRATIONS.map((item) => item.version).join(','), '1,2,3,4,5,6');
  assert.equal(SUPPORTED_VERSION, 6);
  const shipped = MIGRATIONS.find((item) => item.version === 5);
  assert.equal(shipped?.name, 'room whiteboards');
  assert.match(shipped?.sql ?? '', /CREATE TABLE whiteboards/);
  assert.equal((shipped?.sql ?? '').includes('review_marks'), false);
  assert.equal((shipped?.sql ?? '').includes('IF NOT EXISTS'), false);
  const repair = MIGRATIONS.find((item) => item.version === 6);
  assert.match(repair?.sql ?? '', /CREATE TABLE IF NOT EXISTS review_marks/);
  assert.match(repair?.sql ?? '', /CREATE TABLE IF NOT EXISTS whiteboards/);

  const reviewed = nodeDb();
  await applyThrough(reviewed, 5, REVIEW_MARKS_V5);
  await reviewed.run(
    "INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES ('r1', 'bio', 'stonehenge', 1, 1)",
  );
  await reviewed.run(
    "INSERT INTO chunks (id, room_id, position, content, created_at, updated_at) VALUES ('c1', 'r1', 0, 'alpha', 1, 1)",
  );
  await reviewed.run(
    "INSERT INTO review_marks (chunk_id, local_day, state, marked_at, due_at, time_zone) VALUES ('c1', '2026-11-07', 'missed', 10, 20, 'UTC')",
  );
  await migrateDb(reviewed);
  assert.equal((await reviewed.get<{ user_version: number }>('PRAGMA user_version'))?.user_version, 6);
  const kept = await reviewed.get<{ local_day: string; state: string; marked_at: number; due_at: number; time_zone: string }>(
    'SELECT local_day, state, marked_at, due_at, time_zone FROM review_marks WHERE chunk_id = ?',
    ['c1'],
  );
  assert.equal(kept?.local_day, '2026-11-07');
  assert.equal(kept?.state, 'missed');
  assert.equal(kept?.marked_at, 10);
  assert.equal(kept?.due_at, 20);
  assert.equal(kept?.time_zone, 'UTC');
  assert.equal((await reviewed.get<{ n: number }>('SELECT COUNT(*) AS n FROM whiteboards'))?.n, 0);

  const boarded = nodeDb();
  await applyThrough(boarded, 5);
  await boarded.run(
    "INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES ('r1', 'bio', 'stonehenge', 1, 1)",
  );
  await boarded.run(
    "INSERT INTO whiteboards (room_id, revision, items, updated_at) VALUES ('r1', 4, ?, 9)",
    ['[{"id":"t1","kind":"text","x":1,"y":2,"text":"keep"}]'],
  );
  await migrateDb(boarded);
  assert.equal((await boarded.get<{ user_version: number }>('PRAGMA user_version'))?.user_version, 6);
  const board = await boarded.get<{ revision: number; items: string; updated_at: number }>(
    'SELECT revision, items, updated_at FROM whiteboards WHERE room_id = ?',
    ['r1'],
  );
  assert.equal(board?.revision, 4);
  assert.equal(board?.items, '[{"id":"t1","kind":"text","x":1,"y":2,"text":"keep"}]');
  assert.equal(board?.updated_at, 9);
  assert.equal((await boarded.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks'))?.n, 0);

  const commit = createCommit(boarded, { now: () => Date.parse('2026-11-07T12:00:00Z'), newId: () => 'new-1' });
  const marked = await commit({
    opId: 'mark-1',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: 'c1', state: 'got_it', timeZone: 'UTC' },
  });
  assert.equal(marked.ok, false);
  await boarded.run(
    "INSERT INTO chunks (id, room_id, position, content, created_at, updated_at) VALUES ('c1', 'r1', 0, 'alpha', 1, 1)",
  );
  const saved = await commit({
    opId: 'mark-1',
    kind: 'review.mark',
    source: 'human',
    confirmed: false,
    expectedRevision: 1,
    payload: { chunkId: 'c1', state: 'got_it', timeZone: 'UTC' },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.value.state, 'got_it');
  const drawn = await commit({
    opId: 'board-1',
    kind: 'board.save',
    source: 'human',
    confirmed: true,
    expectedRevision: 4,
    payload: { roomId: 'r1', items: [{ id: 't1', kind: 'text', x: 1, y: 2, text: 'keep' }] },
  });
  assert.equal(drawn.ok, true);
  if (!drawn.ok) return;
  assert.equal(drawn.value.revision, 5);
  assert.equal((await boarded.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks'))?.n, 1);
  assert.match((await boarded.get<{ items: string }>('SELECT items FROM whiteboards WHERE room_id = ?', ['r1']))?.items ?? '', /keep/);

  await migrateDb(reviewed);
  await migrateDb(boarded);
  assert.equal((await reviewed.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks'))?.n, 1);
  assert.equal((await boarded.get<{ revision: number }>('SELECT revision FROM whiteboards WHERE room_id = ?', ['r1']))?.revision, 5);
  reviewed.close();
  boarded.close();
});
