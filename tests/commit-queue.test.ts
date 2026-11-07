import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommit } from '../src/data/commit.ts';
import type { Db } from '../src/db/driver.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

test('one database queue keeps a human write out of a failed pin transaction', async () => {
  const inner = nodeDb();
  await migrateDb(inner);
  let arm = false;
  let pinned = false;
  let pinOpen = false;
  let humanStartedWhilePinOpen = false;
  let releaseGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let humanEntered = false;
  const db: Db = {
    exec: (sql) => inner.exec(sql),
    run: (sql, params) => inner.run(sql, params),
    get: (sql, params) => inner.get(sql, params),
    all: (sql, params) => inner.all(sql, params),
    async transaction(task) {
      return inner.transaction(async () => {
        if (arm) {
          arm = false;
          pinned = true;
          pinOpen = true;
          await gate;
          pinOpen = false;
          throw new Error('injected pin failure');
        }
        if (pinOpen) humanStartedWhilePinOpen = true;
        humanEntered = true;
        return task();
      });
    },
  };
  let nextId = 0;
  const roomCommit = createCommit(db, { now: () => 1_000, newId: () => `human-${nextId++}` });
  const harnessCommit = createCommit(db, { now: () => 2_000, newId: () => `pin-${nextId++}` });
  const room = await roomCommit({
    opId: 'room',
    kind: 'room.create',
    source: 'human',
    confirmed: false,
    payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const note = await roomCommit({
    opId: 'chunk',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['photosynthesis makes sugar'] },
  });
  assert.equal(note.ok, true);
  if (!note.ok) return;
  const chunkId = note.value.chunkIds[0] ?? '';

  humanEntered = false;
  arm = true;
  const pin = harnessCommit({
    opId: 'pin-op',
    kind: 'annotation.create',
    source: 'ai',
    confirmed: true,
    expectedRevision: 1,
    payload: { chunkId, type: 'ai_answer', anchor: { start: 0, end: 4 }, payload: { answer: 'sugar' } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pinned, true);
  assert.equal(humanEntered, false);
  const human = roomCommit({
    opId: 'human-while-pinned',
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['added during the pin'] },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(humanEntered, false);
  releaseGate();
  const pinResult = await pin;
  const humanResult = await human;
  assert.equal(humanStartedWhilePinOpen, false);
  assert.equal(pinResult.ok, false);
  if (!pinResult.ok) assert.equal(pinResult.error.code, 'failed');
  assert.equal(humanResult.ok, true);
  const annotations = await inner.get<{ n: number }>('SELECT COUNT(*) AS n FROM annotations');
  assert.equal(annotations?.n, 0);
  const bodies = await inner.all<{ content: string }>('SELECT content FROM chunks ORDER BY position');
  assert.deepEqual(bodies.map((row) => row.content), ['photosynthesis makes sugar', 'added during the pin']);
  const pinOp = await inner.get<{ op_id: string }>('SELECT op_id FROM applied_ops WHERE op_id = ?', ['pin-op']);
  assert.equal(pinOp, null);
  inner.close();
});
