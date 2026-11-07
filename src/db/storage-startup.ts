/**
 * Startup storage failures observed with expo-sqlite on web.
 *
 * Busy: Chromium threw this while another tab, or a worker in another
 * document, held OPFS sync access handles:
 * "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle':
 * Access Handles cannot be created if there is another open Access Handle
 * or Writable stream associated with the same file."
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

const BUSY_SNIPPETS = ['createSyncAccessHandle', 'Access Handles cannot be created'] as const;

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
  const busy = name === 'NoModificationAllowedError' || includesSnippet(message, BUSY_SNIPPETS);
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
