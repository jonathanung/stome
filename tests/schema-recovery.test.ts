import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { MIGRATIONS, SUPPORTED_VERSION } from '../src/db/schema.ts';
import { nodeDb } from './support/node-db.ts';

/**
 * SQL #123 published as user_version 5, replacing the review_marks migration
 * from #79. #145 reverted that merge, so current version 5 is review marks
 * again. This string is the historical whiteboard statement, not the SQL a
 * fresh database runs.
 */
const WHITEBOARDS_V5 = `
  CREATE TABLE whiteboards (
    room_id TEXT PRIMARY KEY NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 1,
    items TEXT NOT NULL CHECK (json_valid(items)),
    updated_at INTEGER NOT NULL
  );
`;

async function applyBase(db: ReturnType<typeof nodeDb>): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON');
  for (const migration of MIGRATIONS.filter((item) => item.version < 5)) await db.exec(migration.sql);
}

test('version 5 and 6 stay as shipped on main, and version 7 adds the missing table', async () => {
  assert.equal(MIGRATIONS.map((item) => item.version).join(','), '1,2,3,4,5,6,7');
  assert.equal(SUPPORTED_VERSION, 7);
  const review = MIGRATIONS.find((item) => item.version === 5);
  assert.equal(review?.name, 'human review marks');
  assert.match(review?.sql ?? '', /CREATE TABLE review_marks/);
  assert.equal((review?.sql ?? '').includes('whiteboards'), false);
  assert.equal((review?.sql ?? '').includes('IF NOT EXISTS'), false);
  const study = MIGRATIONS.find((item) => item.version === 6);
  assert.equal(study?.name, 'study materials grounded in room notes');
  assert.match(study?.sql ?? '', /CREATE TABLE study_decks/);
  assert.equal((study?.sql ?? '').includes('whiteboards'), false);
  const repair = MIGRATIONS.find((item) => item.version === 7);
  assert.match(repair?.sql ?? '', /CREATE TABLE IF NOT EXISTS review_marks/);
  assert.match(repair?.sql ?? '', /CREATE TABLE IF NOT EXISTS whiteboards/);

  const reviewed = nodeDb();
  await applyBase(reviewed);
  await reviewed.exec(review!.sql);
  await reviewed.exec('PRAGMA user_version = 5');
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
  assert.equal((await reviewed.get<{ user_version: number }>('PRAGMA user_version'))?.user_version, 7);
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
  assert.equal((await reviewed.get<{ n: number }>('SELECT COUNT(*) AS n FROM study_decks'))?.n, 0);

  const boarded = nodeDb();
  await applyBase(boarded);
  await boarded.exec(WHITEBOARDS_V5);
  await boarded.exec('PRAGMA user_version = 5');
  await boarded.run(
    "INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES ('r1', 'bio', 'stonehenge', 1, 1)",
  );
  await boarded.run(
    "INSERT INTO whiteboards (room_id, revision, items, updated_at) VALUES ('r1', 4, ?, 9)",
    ['[{"id":"t1","kind":"text","x":1,"y":2,"text":"keep"}]'],
  );
  await migrateDb(boarded);
  assert.equal((await boarded.get<{ user_version: number }>('PRAGMA user_version'))?.user_version, 7);
  const board = await boarded.get<{ revision: number; items: string; updated_at: number }>(
    'SELECT revision, items, updated_at FROM whiteboards WHERE room_id = ?',
    ['r1'],
  );
  assert.equal(board?.revision, 4);
  assert.equal(board?.items, '[{"id":"t1","kind":"text","x":1,"y":2,"text":"keep"}]');
  assert.equal(board?.updated_at, 9);
  assert.equal((await boarded.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks'))?.n, 0);
  assert.equal((await boarded.get<{ n: number }>('SELECT COUNT(*) AS n FROM study_decks'))?.n, 0);

  const studied = nodeDb();
  await applyBase(studied);
  await studied.exec(WHITEBOARDS_V5);
  await studied.exec(study!.sql);
  await studied.exec('PRAGMA user_version = 6');
  await studied.run(
    "INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES ('r1', 'bio', 'stonehenge', 1, 1)",
  );
  await studied.run(
    "INSERT INTO whiteboards (room_id, revision, items, updated_at) VALUES ('r1', 2, ?, 8)",
    ['[{"id":"t1","kind":"text","x":1,"y":2,"text":"kept"}]'],
  );
  await studied.run(
    "INSERT INTO study_decks (id, room_id, title, source_chunk_ids, source_revision, created_at, updated_at) VALUES ('d1', 'r1', 'deck', '[]', 1, 3, 3)",
  );
  await migrateDb(studied);
  assert.equal((await studied.get<{ user_version: number }>('PRAGMA user_version'))?.user_version, 7);
  assert.equal((await studied.get<{ revision: number }>('SELECT revision FROM whiteboards WHERE room_id = ?', ['r1']))?.revision, 2);
  assert.equal((await studied.get<{ title: string }>('SELECT title FROM study_decks WHERE id = ?', ['d1']))?.title, 'deck');
  assert.equal((await studied.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks'))?.n, 0);

  const commit = createCommit(boarded, { now: () => Date.parse('2026-11-07T12:00:00Z'), newId: () => 'new-1' });
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

  await migrateDb(reviewed);
  await migrateDb(boarded);
  await migrateDb(studied);
  assert.equal((await reviewed.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_marks'))?.n, 1);
  assert.equal((await boarded.get<{ revision: number }>('SELECT revision FROM whiteboards WHERE room_id = ?', ['r1']))?.revision, 5);
  assert.equal((await studied.get<{ title: string }>('SELECT title FROM study_decks WHERE id = ?', ['d1']))?.title, 'deck');
  reviewed.close();
  boarded.close();
  studied.close();
});
