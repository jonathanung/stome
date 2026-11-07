import type { AutosaveState } from './autosave';

/**
 * Text that has not been committed, kept outside the editor component so
 * leaving the screen (or reloading this tab) can show it again.
 * A failed save is stored as `error` and is not retried until the person asks.
 */
export interface RecoveredDraft {
  text: string;
  baseRevision: number | null;
  writtenRevision: number;
  status: 'unsaved' | 'error';
  error: string | null;
}

const memory = new Map<string, RecoveredDraft>();
const PREFIX = 'stome.chunk-draft.v1:';

function storage(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function isDraft(value: unknown): value is RecoveredDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as RecoveredDraft;
  const baseOk = draft.baseRevision === null || Number.isInteger(draft.baseRevision);
  return typeof draft.text === 'string'
    && baseOk
    && Number.isInteger(draft.writtenRevision)
    && (draft.status === 'unsaved' || draft.status === 'error')
    && (draft.error === null || typeof draft.error === 'string');
}

export function readDraft(chunkId: string): RecoveredDraft | null {
  const cached = memory.get(chunkId);
  if (cached) return cached;
  const raw = storage()?.getItem(PREFIX + chunkId);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isDraft(parsed)) return null;
    memory.set(chunkId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function rememberDraft(chunkId: string, draft: RecoveredDraft): void {
  memory.set(chunkId, draft);
  try {
    storage()?.setItem(PREFIX + chunkId, JSON.stringify(draft));
  } catch {
    // The in-memory copy still covers navigation in this session.
  }
}

export function forgetDraft(chunkId: string): void {
  memory.delete(chunkId);
  try {
    storage()?.removeItem(PREFIX + chunkId);
  } catch {
    // Ignore a storage that is blocked or gone.
  }
}

/** Test isolation. Production code clears one id at a time through `forgetDraft`. */
export function clearDrafts(): void {
  memory.clear();
  try {
    const store = storage();
    if (!store) return;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Ignore.
  }
}

/** Writes the controller state the editor can restore. A saved body clears it. */
export function syncChunkDraft(
  chunkId: string,
  state: AutosaveState,
  snapshot: { baseRevision: number | null; writtenRevision: number },
): void {
  if (state.text !== null && state.status !== 'saved') {
    rememberDraft(chunkId, {
      text: state.text,
      baseRevision: snapshot.baseRevision,
      writtenRevision: snapshot.writtenRevision,
      status: state.status === 'error' ? 'error' : 'unsaved',
      error: state.status === 'error' ? state.error : null,
    });
    return;
  }
  forgetDraft(chunkId);
}
