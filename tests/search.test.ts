import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { OpKind, Operation, Payloads } from '../src/data/operations.ts';
import { highlightRuns, searchNotes } from '../src/data/search.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

async function setup() {
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  let clock = 0;
  let op = 0;
  const commit = createCommit(db, { newId: () => `id-${++id}`, now: () => (clock += 1000) });
  const run = async <K extends OpKind>(kind: K, payload: Payloads[K]) => {
    const r = await commit({ opId: `op-${++op}`, kind, payload, source: 'human', confirmed: false } as Operation<K>);
    assert.ok(r.ok, JSON.stringify(r));
    return r.value;
  };
  return { db, run };
}

test('search finds chunks across rooms, newest first, and honours filters', async () => {
  const { db, run } = await setup();
  const bio = (await run('room.create', { name: 'biology' })).roomId;
  const cs = (await run('room.create', { name: 'cmpt 310' })).roomId;
  await run('chunk.create', { roomId: bio, bodies: ['Oxygen is the final acceptor', 'glycolysis needs no O2'] });
  await run('chunk.create', { roomId: cs, bodies: ['hill climbing on the oxygen sensor'] });

  const all = await searchNotes(db, 'OXYGEN');
  assert.deepEqual(all.map((h) => h.roomName), ['cmpt 310', 'biology']);
  assert.deepEqual((await searchNotes(db, 'oxygen', { roomId: bio })).map((h) => h.roomName), ['biology']);
  assert.deepEqual(await searchNotes(db, '   '), []);
  assert.deepEqual(await searchNotes(db, 'oxygen', { kinds: ['highlight'] }), []);
});

test('highlightRuns splits on every case-insensitive match', () => {
  assert.deepEqual(highlightRuns('No Oxygen, more oxygen', 'oxygen'), [
    { text: 'No ', hit: false },
    { text: 'Oxygen', hit: true },
    { text: ', more ', hit: false },
    { text: 'oxygen', hit: true },
  ]);
  assert.deepEqual(highlightRuns('abc', ''), [{ text: 'abc', hit: false }]);
});
