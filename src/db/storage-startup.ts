/**
 * Startup storage failures observed with expo-sqlite on web.
 *
 * Busy: Chromium threw this while another tab, or a worker in another
 * document, held OPFS sync access handles:
 * "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle':
 * Access Handles cannot be created if there is another open Access Handle
 * or Writable stream associated with the same file."
 * Busy matches that lock sentence, or the name NoModificationAllowedError.
 * Mentioning createSyncAccessHandle is not enough: a missing method or a
 * permission failure can name it without being that lock.
 *
 * Unsupported: Chromium threw this on an insecure origin, where
 * `navigator.storage` is missing:
 * "navigator.storage not available (not supported by your browser or context is not secure)"
 * The wa-sqlite messages are thrown by this expo-sqlite version when the
 * database engine itself fails to load, before a database is opened.
 *
 * A later open in the same document, after the holder is gone, throws
 * "Invalid VFS state". That is not a lock and not an unsupported browser.
 */

export type StorageFailureKind = 'busy' | 'unsupported' | 'unknown';

export type StorageFailure = {
  kind: StorageFailureKind;
  title: string;
  message: string;
  diagnostic: string;
  canRetry: boolean;
};

/** The lock sentence Chromium attached to the failed sync-access call. The method name alone is not this lock. */
const BUSY_LOCK_MESSAGE =
  'Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.';

const UNSUPPORTED_SNIPPETS = [
  'navigator.storage not available',
  'Failed to initialize wa-sqlite',
  'Failed to load the SQLite WebAssembly module',
] as const;

function readText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function errorParts(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (typeof error === 'string') {
    return { name: '', message: error };
  }
  if (error !== null && typeof error === 'object') {
    const record = error as { name?: unknown; message?: unknown };
    return { name: readText(record.name), message: readText(record.message) };
  }
  return { name: '', message: '' };
}

function includesSnippet(text: string, snippets: readonly string[]): boolean {
  return snippets.some((snippet) => text.includes(snippet));
}

export function classifyStorageFailure(error: unknown): StorageFailure {
  const { name, message } = errorParts(error);
  const diagnostic = message || name || 'Unknown error';
  const busy = name === 'NoModificationAllowedError' || message.includes(BUSY_LOCK_MESSAGE);
  if (busy) {
    return {
      kind: 'busy',
      title: 'Notes are open in another window',
      message: "Another window already has this site's notes database open. Close that window, then retry. Nothing was changed.",
      diagnostic,
      canRetry: true,
    };
  }
  if (includesSnippet(message, UNSUPPORTED_SNIPPETS) || includesSnippet(name, UNSUPPORTED_SNIPPETS)) {
    return {
      kind: 'unsupported',
      title: "This page can't store notes",
      message: "Notes stay in this browser's storage, and that storage isn't available on this page. Nothing was opened or changed.",
      diagnostic,
      canRetry: false,
    };
  }
  return {
    kind: 'unknown',
    title: 'Could not open your notes',
    message: "The notes database didn't open, and the reason isn't one this screen knows. Nothing was changed.",
    diagnostic,
    canRetry: true,
  };
}

/**
 * One recovery at a time. The web worker that failed to create the OPFS
 * access handles stays poisoned for the life of the document, so recovery
 * reloads the page instead of opening the database again.
 */
export function createStorageRetryGate() {
  let claimed = false;
  return {
    request(reload: () => void): boolean {
      if (claimed) return false;
      claimed = true;
      reload();
      return true;
    },
  };
}

/**
 * Migrations run only after the database is already open. If they throw,
 * the handle is closed so the error screen does not keep it.
 */
export async function finishStartup<T>(
  db: T,
  migrate: (db: T) => Promise<void>,
  close: (db: T) => Promise<unknown>,
): Promise<void> {
  try {
    await migrate(db);
  } catch (error) {
    await close(db).catch(() => undefined);
    throw error;
  }
}

export const AUTO_RETRY_LIMIT = 5;
export const AUTO_RETRY_DELAY_SECONDS = 3;

/**
 * Attempt bookkeeping for the busy screen. Recovery reloads the page, so the
 * count lives in a key-value store that survives a reload (sessionStorage).
 * Auto retry only ever reloads; it never deletes, writes or steals a lock.
 */
export type AttemptStore = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

const ATTEMPT_KEY = 'stome.storage.attempts';
/** An attempt count older than this belongs to an earlier episode and is ignored. */
const ATTEMPT_TTL_MS = 60_000;

export function readAttempt(store: AttemptStore | null, now: number = Date.now()): number {
  const [count, at] = (store?.getItem(ATTEMPT_KEY) ?? '').split(':').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(count) || count < 1 || !Number.isFinite(at) || now - at > ATTEMPT_TTL_MS) return 1;
  return count;
}

/** Called right before a reload so the next load knows it is a later attempt. */
export function recordRetry(store: AttemptStore | null, now: number = Date.now()): void {
  store?.setItem(ATTEMPT_KEY, `${readAttempt(store, now) + 1}:${now}`);
}

const FIRST_AT_KEY = 'stome.storage.first-at';

/** Wall-clock time of the first failed attempt in this episode; recorded once, ignored once stale. */
export function readFirstAttemptAt(store: AttemptStore | null, now: number = Date.now()): number {
  const saved = Number.parseInt(store?.getItem(FIRST_AT_KEY) ?? '', 10);
  if (Number.isFinite(saved) && now - saved <= ATTEMPT_TTL_MS * AUTO_RETRY_LIMIT) return saved;
  store?.setItem(FIRST_AT_KEY, String(now));
  return now;
}

export function clearAttempts(store: AttemptStore | null): void {
  store?.removeItem(ATTEMPT_KEY);
}

export function canAutoRetry(failure: StorageFailure, attempt: number): boolean {
  return failure.kind === 'busy' && failure.canRetry && attempt < AUTO_RETRY_LIMIT;
}
