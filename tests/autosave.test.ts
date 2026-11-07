import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutosaveController, type AutosaveState, type SaveOutcome } from '../src/features/chunks/autosave.ts';

/** A fake clock: timers run only when `advance` passes their due time. */
function fakeTimers() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 0;
  return {
    schedule(fn: () => void, ms: number) {
      const id = ++next;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    async advance(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
      await new Promise((r) => setImmediate(r));
    },
    pending: () => timers.length,
  };
}

function setup(save: (text: string) => Promise<SaveOutcome>) {
  const clock = fakeTimers();
  const states: AutosaveState[] = [];
  const saves: string[] = [];
  const ctl = new AutosaveController({
    delayMs: 800,
    schedule: clock.schedule,
    onChange: (s) => states.push(s),
    save: async (text) => {
      saves.push(text);
      return save(text);
    },
  });
  return { ctl, clock, states, saves, last: () => states[states.length - 1] };
}

test('edits are debounced into one save of the latest text', async () => {
  const s = setup(async () => ({ ok: true }));
  s.ctl.edit('a');
  await s.clock.advance(500);
  s.ctl.edit('ab');
  await s.clock.advance(500);
  s.ctl.edit('abc');
  assert.equal(s.last().status, 'unsaved');
  assert.deepEqual(s.saves, []);

  await s.clock.advance(800);
  assert.deepEqual(s.saves, ['abc']);
  assert.deepEqual(s.last(), { status: 'saved', text: 'abc', error: null });
  assert.ok(s.states.some((st) => st.status === 'saving'));
});

test('a failed save keeps the text, shows the error, and does not retry in the background', async () => {
  let fail = true;
  const s = setup(async () => (fail ? { ok: false, message: 'disk is full' } : { ok: true }));
  s.ctl.edit('my precious notes');
  await s.clock.advance(800);

  assert.deepEqual(s.last(), { status: 'error', text: 'my precious notes', error: 'disk is full' });
  assert.equal(s.clock.pending(), 0, 'no timer is waiting to retry');
  await s.clock.advance(60_000);
  assert.equal(s.saves.length, 1, 'still only the one attempt');

  fail = false;
  await s.ctl.retry();
  assert.equal(s.saves.length, 2);
  assert.deepEqual(s.last(), { status: 'saved', text: 'my precious notes', error: null });
});

test('a save that throws is treated as a failure', async () => {
  const s = setup(async () => {
    throw new Error('database is locked');
  });
  s.ctl.edit('x');
  await s.clock.advance(800);
  assert.equal(s.last().status, 'error');
  assert.equal(s.last().error, 'database is locked');
  assert.equal(s.last().text, 'x');
});

test('edits during a save are saved afterwards', async () => {
  let release!: () => void;
  const s = setup(() => new Promise<SaveOutcome>((r) => (release = () => r({ ok: true }))));
  s.ctl.edit('first');
  await s.clock.advance(800);
  assert.equal(s.last().status, 'saving');

  s.ctl.edit('first, then more');
  assert.equal(s.last().status, 'saving');
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(s.last().status, 'unsaved');
  assert.equal(s.last().text, 'first, then more');

  await s.clock.advance(800);
  release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(s.saves, ['first', 'first, then more']);
  assert.equal(s.last().status, 'saved');
});

test('flush saves immediately and cancels the timer', async () => {
  const s = setup(async () => ({ ok: true }));
  s.ctl.edit('leaving the screen');
  await s.ctl.flush();
  assert.deepEqual(s.saves, ['leaving the screen']);
  assert.equal(s.clock.pending(), 0);
  await s.clock.advance(800);
  assert.equal(s.saves.length, 1);
});

test('retry does nothing unless the last save failed', async () => {
  const s = setup(async () => ({ ok: true }));
  await s.ctl.retry();
  s.ctl.edit('x');
  await s.ctl.retry();
  assert.deepEqual(s.saves, []);
});

test('discard drops unsaved edits so a later flush saves nothing', async () => {
  const s = setup(async () => ({ ok: true }));
  s.ctl.edit('about to delete this chunk');
  s.ctl.discard();
  await s.ctl.flush();
  await s.clock.advance(800);
  assert.deepEqual(s.saves, []);
  assert.equal(s.last().status, 'saved');
});
