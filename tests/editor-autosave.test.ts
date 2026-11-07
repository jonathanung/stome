import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutosaveController, deleteAfterFlush, settleOnUnmount, type SaveOutcome } from '../src/features/chunks/autosave.ts';
import { DraftRevision, saveBodyWithBase } from '../src/features/chunks/draft-revision.ts';
import { clearDrafts, readDraft, syncChunkDraft } from '../src/features/chunks/draft-store.ts';
import { createCommit } from '../src/data/commit.ts';
import { listChunks } from '../src/data/queries.ts';
import { migrateDb } from '../src/db/migrate.ts';
import { nodeDb } from './support/node-db.ts';

function fakeTimers() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 0;
  return {
    schedule(fn: () => void, ms: number) {
      const id = ++next;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((timer) => timer.id !== id);
      };
    },
    async advance(ms: number) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) timer.fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
    pending: () => timers.length,
  };
}

async function settled() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('a dirty draft keeps the revision it was typed against', () => {
  const revisions = new DraftRevision();
  revisions.noteEdit(1);
  assert.equal(revisions.expectedBody(1), 1);
  assert.equal(revisions.expectedBody(2), 1, 'a prop refresh must not move the base');
  revisions.onBodySettled(false, undefined, true);
  assert.equal(revisions.expectedBody(2), 1);

  const clean = new DraftRevision();
  clean.noteEdit(1);
  clean.onBodySettled(true, 2, false);
  assert.equal(clean.frozen, null);
  clean.noteEdit(5);
  assert.equal(clean.expectedBody(5), 5, 'a clean editor adopts the body now on screen');

  const dirty = new DraftRevision();
  dirty.noteEdit(1);
  dirty.onBodySettled(true, 2, true);
  assert.equal(dirty.expectedBody(9), 2, 'keystrokes during the save stay based on the write, not a later prop');
  dirty.noteStructural(2, 3);
  assert.equal(dirty.expectedBody(9), 3);

  const conflicted = new DraftRevision();
  conflicted.noteEdit(1);
  conflicted.noteStructural(2, 3);
  assert.equal(conflicted.expectedBody(3), 1, 'a structural write at a newer revision does not retarget the draft');
  assert.equal(conflicted.expectedStructural(3), 3);
});

test('an AI update does not get overwritten by a dirty draft that started at revision 1', async () => {
  const db = nodeDb();
  await migrateDb(db);
  let id = 0;
  const commit = createCommit(db, { newId: () => `id-${++id}`, now: () => 1_000 + id });
  const room = await commit({
    opId: 'room', kind: 'room.create', source: 'human', confirmed: false, payload: { name: 'biology' },
  });
  assert.equal(room.ok, true);
  if (!room.ok) return;
  const created = await commit({
    opId: 'chunk', kind: 'chunk.create', source: 'human', confirmed: false,
    payload: { roomId: room.value.roomId, bodies: ['human base'] },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const chunkId = created.value.chunkIds[0] ?? '';

  const revisions = new DraftRevision();
  let propsRevision = 1;
  const clock = fakeTimers();
  const sent: number[] = [];
  const latest = { text: (): string | null => null };
  const ctl = new AutosaveController({
    delayMs: 800,
    schedule: clock.schedule,
    onChange: () => {},
    save: (body) => saveBodyWithBase(
      revisions,
      propsRevision,
      body,
      () => latest.text(),
      async (expectedRevision) => {
        sent.push(expectedRevision);
        const result = await commit({
          opId: `human-${sent.length}`,
          kind: 'chunk.update',
          source: 'human',
          confirmed: false,
          expectedRevision,
          payload: { chunkId, body },
        });
        if (!result.ok) return { ok: false, message: result.error.message };
        return { ok: true, revision: result.value.revision };
      },
    ),
  });
  latest.text = () => ctl.current.text;

  revisions.noteEdit(propsRevision);
  ctl.edit('human draft');
  const ai = await commit({
    opId: 'ai-edit',
    kind: 'chunk.update',
    source: 'ai',
    confirmed: true,
    expectedRevision: 1,
    payload: { chunkId, body: 'ai text' },
  });
  assert.equal(ai.ok, true);
  if (!ai.ok) return;
  propsRevision = ai.value.revision;
  assert.equal(propsRevision, 2);
  assert.equal(revisions.expectedBody(propsRevision), 1);

  await clock.advance(800);
  await settled();
  const [after] = await listChunks(db, room.value.roomId);
  assert.deepEqual(sent, [1]);
  assert.equal(after?.body, 'ai text');
  assert.equal(after?.revision, 2);
  assert.equal(ctl.current.status, 'error');
  assert.equal(ctl.current.text, 'human draft');

  await ctl.retry();
  const [retried] = await listChunks(db, room.value.roomId);
  assert.deepEqual(sent, [1, 1]);
  assert.equal(retried?.body, 'ai text');
  assert.equal(ctl.current.status, 'error');
  assert.equal(ctl.current.text, 'human draft');
  db.close();
});

test('delete waits for the autosave revision and keeps the draft when delete fails', async () => {
  const revisions = new DraftRevision();
  let propsRevision = 1;
  const clock = fakeTimers();
  let release!: (outcome: SaveOutcome) => void;
  const latest = { text: (): string | null => null };
  const ctl = new AutosaveController({
    delayMs: 800,
    schedule: clock.schedule,
    onChange: (state) => syncChunkDraft('chunk-delete', state, revisions.snapshot()),
    save: (body) => saveBodyWithBase(
      revisions,
      propsRevision,
      body,
      () => latest.text(),
      async (expectedRevision) => {
        const outcome = await new Promise<SaveOutcome>((resolve) => {
          release = resolve;
        });
        if (!outcome.ok) return { ok: false, message: outcome.message };
        propsRevision = expectedRevision + 1;
        return { ok: true, revision: propsRevision };
      },
    ),
  });
  latest.text = () => ctl.current.text;

  revisions.noteEdit(1);
  ctl.edit('A');
  await clock.advance(800);
  ctl.edit('AB');

  let seen = -1;
  const failed = deleteAfterFlush(
    ctl,
    () => revisions.expectedStructural(propsRevision),
    async (revision) => {
      seen = revision;
      ctl.edit('AB!');
      void ctl.flush();
      ctl.dispose();
      return { ok: false, message: 'disk is full' };
    },
  );
  release({ ok: true });
  await settled();
  release({ ok: true });
  const result = await failed;
  assert.equal(result.ok, false);
  assert.equal(seen, 3, 'delete uses the revision after A and AB, not the original 1');
  assert.equal(ctl.current.text, 'AB!');
  await clock.advance(60_000);
  assert.equal(ctl.current.text, 'AB!');
  const recovered = readDraft('chunk-delete');
  assert.equal(recovered?.text, 'AB!');
  assert.equal(recovered?.status, 'unsaved');
  clearDrafts();
});

test('a successful delete drops the draft and does not save text typed while it commits', async () => {
  const clock = fakeTimers();
  const ctl = new AutosaveController({
    delayMs: 800,
    schedule: clock.schedule,
    onChange: (state) => syncChunkDraft('chunk-gone', state, { baseRevision: 1, writtenRevision: 1 }),
    save: async () => ({ ok: true }),
  });
  ctl.edit('gone soon');
  assert.equal(readDraft('chunk-gone')?.text, 'gone soon');
  await clock.advance(800);
  assert.equal(ctl.current.status, 'saved');
  assert.equal(readDraft('chunk-gone'), null);

  const deleted = await deleteAfterFlush(ctl, () => 2, async (revision) => {
    assert.equal(revision, 2);
    ctl.edit('typed during delete');
    void ctl.flush();
    ctl.dispose();
    return { ok: true as const };
  });
  assert.equal(deleted.ok, true);
  assert.equal(ctl.current.text, null);
  assert.equal(readDraft('chunk-gone'), null);
  await clock.advance(60_000);
  assert.equal(ctl.current.text, null);
  clearDrafts();
});

test('a failed save survives unmount and is not retried when the editor returns', async () => {
  clearDrafts();
  const clock = fakeTimers();
  let attempts = 0;
  const first = new AutosaveController({
    delayMs: 800,
    schedule: clock.schedule,
    onChange: (state) => syncChunkDraft('chunk-back', state, { baseRevision: 4, writtenRevision: 4 }),
    save: async () => {
      attempts += 1;
      return { ok: false, message: 'database is locked' };
    },
  });
  first.edit('recover me');
  await clock.advance(800);
  assert.equal(first.current.status, 'error');
  await settleOnUnmount(first);
  await clock.advance(60_000);
  assert.equal(attempts, 1);

  const draft = readDraft('chunk-back');
  assert.equal(draft?.text, 'recover me');
  assert.equal(draft?.status, 'error');
  assert.equal(draft?.baseRevision, 4);
  assert.equal(draft?.error, 'database is locked');

  const clock2 = fakeTimers();
  let secondAttempts = 0;
  const second = new AutosaveController({
    delayMs: 800,
    schedule: clock2.schedule,
    onChange: () => {},
    initial: { status: draft!.status, text: draft!.text, error: draft!.error },
    save: async () => {
      secondAttempts += 1;
      return { ok: true };
    },
  });
  await clock2.advance(60_000);
  assert.equal(secondAttempts, 0, 'restoring a failed draft does not save');
  assert.equal(second.current.text, 'recover me');
  assert.equal(second.current.status, 'error');
  await second.retry();
  assert.equal(secondAttempts, 1);
  assert.equal(second.current.status, 'saved');
  clearDrafts();
});
