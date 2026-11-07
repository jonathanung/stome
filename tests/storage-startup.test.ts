import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyStorageFailure,
  createStorageRetryGate,
  finishStartup,
} from '../src/db/storage-startup.ts';

const BUSY_MESSAGE =
  "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.";

const UNSUPPORTED_MESSAGE =
  'navigator.storage not available (not supported by your browser or context is not secure)';

test('a held OPFS access handle is a busy startup, with the original diagnostic', () => {
  const failure = classifyStorageFailure(new Error(BUSY_MESSAGE));
  assert.equal(failure.kind, 'busy');
  assert.equal(failure.canRetry, true);
  assert.equal(failure.diagnostic, BUSY_MESSAGE);
  assert.match(failure.title, /another window/);
  assert.equal(failure.message.includes('unsupported'), false);
  assert.equal(failure.message.includes('corrupt'), false);
});

test('a DOMException name for the same lock is busy even without the Chrome message', () => {
  const failure = classifyStorageFailure({ name: 'NoModificationAllowedError', message: 'locked' });
  assert.equal(failure.kind, 'busy');
  assert.equal(failure.diagnostic, 'locked');
});

test('a missing createSyncAccessHandle method is not a competing window', () => {
  const failure = classifyStorageFailure(new TypeError('handle.createSyncAccessHandle is not a function'));
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.canRetry, true);
  assert.equal(failure.diagnostic, 'handle.createSyncAccessHandle is not a function');
  assert.equal(failure.title.includes('another window'), false);
  assert.equal(failure.title.includes("can't store"), false);
});

test('a permission or security failure that names the method is not busy', () => {
  const message =
    "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': The request is not allowed by the user agent or the platform in the current context.";
  const failure = classifyStorageFailure({ name: 'NotAllowedError', message });
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.canRetry, true);
  assert.equal(failure.diagnostic, message);
  assert.equal(failure.title.includes('another window'), false);
  assert.equal(failure.message.includes('unsupported'), false);
});

test('a page without navigator.storage is unsupported and has no retry', () => {
  const failure = classifyStorageFailure(new Error(UNSUPPORTED_MESSAGE));
  assert.equal(failure.kind, 'unsupported');
  assert.equal(failure.canRetry, false);
  assert.equal(failure.diagnostic, UNSUPPORTED_MESSAGE);
  assert.equal(failure.title.includes('another window'), false);
  assert.match(failure.message, /isn't available/);
});

test('wa-sqlite failing to load is unsupported, not a busy database', () => {
  const wasm = classifyStorageFailure(new Error('Failed to load the SQLite WebAssembly module from "wasm". Cause: 404'));
  const engine = classifyStorageFailure(new Error('Failed to initialize wa-sqlite'));
  assert.equal(wasm.kind, 'unsupported');
  assert.equal(engine.kind, 'unsupported');
  assert.equal(wasm.canRetry, false);
});

test('Invalid VFS state stays unknown and still offers a retry', () => {
  const failure = classifyStorageFailure(new Error('Invalid VFS state'));
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.canRetry, true);
  assert.equal(failure.diagnostic, 'Invalid VFS state');
  assert.equal(failure.title.includes('another window'), false);
  assert.equal(failure.title.includes("can't store"), false);
  assert.equal(failure.message.includes('unsupported'), false);
  assert.equal(failure.message.includes('corrupt'), false);
  assert.equal(failure.message.includes('busy'), false);
});

test('a schema read failure is not relabeled as busy or unsupported', () => {
  const failure = classifyStorageFailure(new Error('Could not read the database schema version'));
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.diagnostic, 'Could not read the database schema version');
});

test('an empty failure still has a visible diagnostic', () => {
  const failure = classifyStorageFailure(undefined);
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.diagnostic, 'Unknown error');
});

test('concurrent retry reloads once, including a reentrant call', () => {
  const gate = createStorageRetryGate();
  let reloads = 0;
  const first = gate.request(() => {
    reloads += 1;
    const nested = gate.request(() => {
      reloads += 1;
    });
    assert.equal(nested, false);
  });
  const second = gate.request(() => {
    reloads += 1;
  });
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(reloads, 1);
});

test('a failed migration closes the handle once and does not swallow the error', async () => {
  let closes = 0;
  let migrated = 0;
  await assert.rejects(
    () =>
      finishStartup(
        { id: 1 },
        async () => {
          migrated += 1;
          throw new Error('Could not read the database schema version');
        },
        async () => {
          closes += 1;
          throw new Error('close failed');
        },
      ),
    /schema version/,
  );
  assert.equal(migrated, 1);
  assert.equal(closes, 1);
});

test('a successful migration does not close the database', async () => {
  let closes = 0;
  await finishStartup({ id: 1 }, async () => undefined, async () => {
    closes += 1;
  });
  assert.equal(closes, 0);
});

test('two overlapping migration failures close each handle and do not share one close', async () => {
  const closed: number[] = [];
  const migrate = async (db: { id: number }) => {
    if (db.id === 1) throw new Error('Could not read the database schema version');
  };
  await Promise.all([
    finishStartup({ id: 1 }, migrate, async (db) => {
      closed.push(db.id);
    }).catch((error: unknown) => {
      assert.equal(error instanceof Error ? error.message : '', 'Could not read the database schema version');
    }),
    finishStartup({ id: 2 }, migrate, async (db) => {
      closed.push(db.id);
    }),
  ]);
  assert.deepEqual(closed, [1]);
});

test('auto retry is bounded and only for busy storage', async () => {
  const { AUTO_RETRY_LIMIT, canAutoRetry, readAttempt, recordRetry, clearAttempts } = await import('../src/db/storage-startup.ts');
  const busy = classifyStorageFailure({ name: 'NoModificationAllowedError', message: 'locked' });
  const unknown = classifyStorageFailure(new Error('boom'));
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  assert.equal(readAttempt(store), 1);
  for (let i = 1; i < AUTO_RETRY_LIMIT; i += 1) {
    assert.equal(canAutoRetry(busy, readAttempt(store)), true);
    recordRetry(store);
  }
  assert.equal(readAttempt(store), AUTO_RETRY_LIMIT);
  assert.equal(canAutoRetry(busy, readAttempt(store)), false);
  assert.equal(canAutoRetry(unknown, 1), false);
  clearAttempts(store);
  assert.equal(readAttempt(store), 1);
  assert.equal(readAttempt(null), 1);
});
