import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { MIGRATIONS, SUPPORTED_VERSION, migrationsFor } from '../src/db/schema.ts';
import { nodeDb } from './support/node-db.ts';

const version = async (db: Db) => (await db.get<{ user_version: number }>('PRAGMA user_version'))?.user_version;
const tables = async (db: Db) =>
  (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((t) => t.name);
const count = async (db: Db, table: string) => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n;

function seed(db: ReturnType<typeof nodeDb>) {
  const t = 1000;
  db.raw.prepare('INSERT INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('r1', 'bio', t, t);
  db.raw.prepare('INSERT INTO chunks (id, room_id, position, body, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)').run('c1', 'r1', 'glycolysis', t, t);
  db.raw.prepare('INSERT INTO chunk_subjects (chunk_id, subject, position) VALUES (?, ?, 0)').run('c1', 'metabolism');
  db.raw.prepare("INSERT INTO annotations (id, chunk_id, type, anchor, created_at, updated_at) VALUES ('a1', 'c1', 'highlight', '{\"start\":0,\"end\":4}', ?, ?)").run(t, t);
}

test('a fresh database migrates to the latest version, and running again does nothing', async () => {
  const db = nodeDb();
  await migrateDb(db);
  assert.equal(await version(db), SUPPORTED_VERSION);
  const before = await tables(db);
  assert.deepEqual(before, ['annotations', 'applied_ops', 'chunk_subjects', 'chunks', 'import_sources', 'rooms']);

  await migrateDb(db);
  assert.equal(await version(db), SUPPORTED_VERSION);
  assert.deepEqual(await tables(db), before);
});

test('migration versions are contiguous and a newer database is refused', () => {
  MIGRATIONS.forEach((m, i) => assert.equal(m.version, i + 1));
  assert.equal(migrationsFor(SUPPORTED_VERSION).length, 0);
  assert.throws(() => migrationsFor(SUPPORTED_VERSION + 1), /newer/);
});

test('notes from the v1 scaffold become chunks in a "notes" room', async () => {
  const db = nodeDb();
  await db.exec(MIGRATIONS[0].sql);
  await db.exec('PRAGMA user_version = 1');
  db.raw.prepare('INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)').run('first', 'body one', 10, 11);
  db.raw.prepare('INSERT INTO notes (title, body, created_at, updated_at) VALUES (?, ?, ?, ?)').run('second', '', 20, 21);

  await migrateDb(db);

  const rooms = await db.all<{ id: string; name: string }>('SELECT id, name FROM rooms');
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].name, 'notes');
  assert.match(rooms[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const chunks = await db.all<{ body: string; position: number; room_id: string }>('SELECT body, position, room_id FROM chunks ORDER BY position');
  assert.deepEqual(chunks.map((c) => [c.position, c.body]), [[0, 'first\nbody one'], [1, 'second']]);
  assert.ok(chunks.every((c) => c.room_id === rooms[0].id));
  assert.ok(!(await tables(db)).includes('notes'));
});

test('an empty v1 database upgrades without creating a room', async () => {
  const db = nodeDb();
  await db.exec(MIGRATIONS[0].sql);
  await db.exec('PRAGMA user_version = 1');
  await migrateDb(db);
  assert.equal(await count(db, 'rooms'), 0);
});

test('a failed migration rolls back and leaves the previous version', async () => {
  const db = nodeDb();
  let execs = 0;
  const failing: Db = {
    ...db,
    async exec(sql) {
      execs += 1;
      if (execs === 3) throw new Error('simulated failure'); // pragmas, v1, then v1's version bump
      return db.exec(sql);
    },
  };
  await assert.rejects(migrateDb(failing), /simulated failure/);
  assert.equal(await version(db), 0);
  assert.deepEqual(await tables(db), []);
});

test('deleting a room removes its chunks, subjects and annotations', async () => {
  const db = nodeDb();
  await migrateDb(db);
  seed(db);
  await db.run('DELETE FROM rooms WHERE id = ?', ['r1']);
  for (const table of ['chunks', 'chunk_subjects', 'annotations']) assert.equal(await count(db, table), 0, table);
});

test('deleting a chunk removes its subjects and annotations', async () => {
  const db = nodeDb();
  await migrateDb(db);
  seed(db);
  await db.run('DELETE FROM chunks WHERE id = ?', ['c1']);
  assert.equal(await count(db, 'chunk_subjects'), 0);
  assert.equal(await count(db, 'annotations'), 0);
  assert.equal(await count(db, 'rooms'), 1);
});

test('an annotation with an invalid type or a missing chunk is rejected', async () => {
  const db = nodeDb();
  await migrateDb(db);
  seed(db);
  const insert = (id: string, chunk: string, type: string) =>
    db.run("INSERT INTO annotations (id, chunk_id, type, anchor, created_at, updated_at) VALUES (?, ?, ?, '{}', 1, 1)", [id, chunk, type]);
  await assert.rejects(insert('bad-type', 'c1', 'sticker'), /CHECK constraint/);
  await assert.rejects(insert('no-chunk', 'missing', 'highlight'), /FOREIGN KEY constraint/);
  assert.equal(await count(db, 'annotations'), 1);
});

test('a room stage outside stonehenge|brick is rejected', async () => {
  const db = nodeDb();
  await migrateDb(db);
  await assert.rejects(
    db.run("INSERT INTO rooms (id, name, stage, created_at, updated_at) VALUES ('r', 'x', 'marble', 1, 1)"),
    /CHECK constraint/,
  );
});
