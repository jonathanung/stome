import type { Operation } from '../../data/operations.ts';
import {
  CAPTURE_DRAFT_KEY,
  type CaptureDraft,
  captureOperation,
  emptyDraft,
  parseDraft,
} from './draft.ts';

export const CAPTURE_ATTEMPT_KEY = 'stome.captureAttempt';

export const STORAGE_DEGRADED_MESSAGE =
  'This line stays on screen, but a reload may not bring the draft back.';

export const CLEANUP_FAILED_MESSAGE =
  'The note was saved. The draft could not be cleared and may still be here after a reload.';

/** The text and room frozen when a save starts. A later edit does not change this. */
export type BoundAttempt = {
  opId: string;
  text: string;
  roomId: string;
};

export type CaptureNotice =
  | { kind: 'error'; message: string }
  | { kind: 'needs-room' }
  | { kind: 'saved'; cleanupFailed: boolean }
  | { kind: 'degraded' }
  | null;

export type CaptureSession = {
  draft: CaptureDraft;
  unresolved: BoundAttempt | null;
  busy: boolean;
  notice: CaptureNotice;
};

export type CaptureStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type SaveResult = { ok: true; duplicate: boolean } | { ok: false; message: string };

export function readStorageItem(
  storage: CaptureStorage | null,
  key: string,
): { ok: true; value: string | null } | { ok: false } {
  if (!storage) return { ok: false };
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

export function writeStorageItem(storage: CaptureStorage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorageItem(storage: CaptureStorage | null, key: string): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function parseAttempt(raw: string | null): BoundAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BoundAttempt>;
    if (typeof value.opId !== 'string' || value.opId.length === 0) return null;
    if (typeof value.text !== 'string' || value.text.trim().length === 0) return null;
    if (typeof value.roomId !== 'string' || value.roomId.length === 0) return null;
    return { opId: value.opId, text: value.text.trim(), roomId: value.roomId };
  } catch {
    return null;
  }
}

function degraded(session: CaptureSession): CaptureSession {
  if (session.notice?.kind === 'degraded') return session;
  return { ...session, notice: { kind: 'degraded' } };
}

export function loadCaptureState(storage: CaptureStorage | null, newId: () => string): CaptureSession {
  const draftRead = readStorageItem(storage, CAPTURE_DRAFT_KEY);
  const attemptRead = readStorageItem(storage, CAPTURE_ATTEMPT_KEY);
  const draft = draftRead.ok ? parseDraft(draftRead.value) ?? emptyDraft(newId) : emptyDraft(newId);
  const unresolved = attemptRead.ok ? parseAttempt(attemptRead.value) : null;
  const failed = !draftRead.ok || !attemptRead.ok;
  return {
    draft,
    unresolved,
    busy: false,
    notice: failed ? { kind: 'degraded' } : null,
  };
}

/** Typing keeps the text. A text that no longer matches a bound attempt gets its own operation id. */
export function editText(session: CaptureSession, text: string, newId: () => string): CaptureSession {
  let opId = session.draft.opId;
  if (session.unresolved && opId === session.unresolved.opId && text.trim() !== session.unresolved.text) {
    opId = newId();
  }
  const notice = session.notice?.kind === 'error' || session.notice?.kind === 'needs-room' ? null : session.notice;
  return { ...session, draft: { text, opId }, notice };
}

/** Moving to another room detaches the current line from an attempt that targeted the previous room. */
export function noteRoom(session: CaptureSession, roomId: string | null, newId: () => string): CaptureSession {
  if (!roomId || !session.unresolved) return session;
  if (session.draft.opId !== session.unresolved.opId) return session;
  if (session.unresolved.roomId === roomId) return session;
  return { ...session, draft: { ...session.draft, opId: newId() } };
}

export type BeginSave =
  | { ok: false; reason: 'busy' | 'empty' | 'needs-room'; session: CaptureSession }
  | {
      ok: true;
      session: CaptureSession;
      sent: BoundAttempt;
      recover: BoundAttempt | null;
      operation: Operation<'chunk.create'>;
    };

export function beginSave(session: CaptureSession, roomId: string | null, newId: () => string): BeginSave {
  if (session.busy) return { ok: false, reason: 'busy', session };
  const text = session.draft.text.trim();
  if (text.length === 0) return { ok: false, reason: 'empty', session };
  if (!roomId) {
    return { ok: false, reason: 'needs-room', session: { ...session, notice: { kind: 'needs-room' } } };
  }
  const pending = session.unresolved;
  if (pending && session.draft.opId === pending.opId && text === pending.text && roomId === pending.roomId) {
    const sent = pending;
    return {
      ok: true,
      sent,
      recover: null,
      operation: captureOperation({ text: sent.text, opId: sent.opId }, sent.roomId),
      session: { ...session, busy: true, unresolved: sent, notice: null },
    };
  }
  let draft = session.draft;
  let recover: BoundAttempt | null = null;
  if (pending && draft.opId === pending.opId) {
    draft = { text: session.draft.text, opId: newId() };
    recover = pending;
  } else if (pending) {
    recover = pending;
  }
  const sent: BoundAttempt = { opId: draft.opId, text, roomId };
  return {
    ok: true,
    sent,
    recover,
    operation: captureOperation({ text, opId: sent.opId }, roomId),
    session: { ...session, draft, busy: true, unresolved: recover ?? sent, notice: null },
  };
}

export function settleFailed(
  session: CaptureSession,
  sent: BoundAttempt,
  latest: CaptureDraft,
  message: string,
): CaptureSession {
  const sameLine = latest.opId === sent.opId && latest.text.trim() === sent.text;
  const unresolved = sameLine ? sent : session.unresolved?.opId === sent.opId ? null : session.unresolved;
  return { ...session, busy: false, draft: latest, unresolved, notice: { kind: 'error', message } };
}

/**
 * A landed save clears the line only when it is still the line that was sent.
 * Text typed while the commit was pending stays, with its own operation id.
 */
export function settleSaved(
  session: CaptureSession,
  sent: BoundAttempt,
  latest: CaptureDraft,
  cleanupOk: boolean,
  newId: () => string,
  roomId: string | null,
): CaptureSession {
  const roomMoved = roomId !== null && roomId !== sent.roomId;
  const newer = latest.opId !== sent.opId || latest.text.trim() !== sent.text || roomMoved;
  if (newer) {
    const draft = latest.opId === sent.opId ? { text: latest.text, opId: newId() } : latest;
    return {
      ...session,
      busy: false,
      draft,
      unresolved: cleanupOk ? null : sent,
      notice: cleanupOk ? null : { kind: 'saved', cleanupFailed: true },
    };
  }
  return {
    ...session,
    busy: false,
    draft: cleanupOk ? emptyDraft(newId) : { text: latest.text, opId: sent.opId },
    unresolved: cleanupOk ? null : sent,
    notice: { kind: 'saved', cleanupFailed: !cleanupOk },
  };
}

export function persistDraft(storage: CaptureStorage | null, draft: CaptureDraft): boolean {
  return writeStorageItem(storage, CAPTURE_DRAFT_KEY, JSON.stringify(draft));
}

export function persistAttempt(storage: CaptureStorage | null, attempt: BoundAttempt): boolean {
  return writeStorageItem(storage, CAPTURE_ATTEMPT_KEY, JSON.stringify(attempt));
}

export function keepAfterCleanupFailure(
  settled: CaptureSession,
  sent: BoundAttempt,
  latest: CaptureDraft,
): CaptureSession {
  const kept = settled.draft.text.trim().length > 0 ? settled.draft : { text: latest.text, opId: sent.opId };
  return {
    ...settled,
    draft: kept,
    unresolved: sent,
    notice: { kind: 'saved', cleanupFailed: true },
  };
}

export function persistSettled(storage: CaptureStorage | null, settled: CaptureSession): boolean {
  const draftOk = persistDraft(storage, settled.draft);
  if (!draftOk) return false;
  if (settled.unresolved) return persistAttempt(storage, settled.unresolved);
  return removeStorageItem(storage, CAPTURE_ATTEMPT_KEY);
}

export type CaptureLive = {
  commit: (operation: Operation<'chunk.create'>) => Promise<SaveResult>;
  destination: () => Promise<{ roomId: string } | { needsRoom: true }>;
};

export type CaptureController = {
  getState(): CaptureSession;
  setLive(live: CaptureLive): void;
  edit(text: string): void;
  markDegraded(): void;
  noteDestination(roomId: string | null): void;
  observeRoom(roomId: string, stored: boolean): void;
  save(): Promise<{ closePanel: boolean }>;
};

export function createCaptureController(deps: {
  storage: CaptureStorage | null;
  newId: () => string;
  initial?: CaptureSession;
  commit: (operation: Operation<'chunk.create'>) => Promise<SaveResult>;
  destination: () => Promise<{ roomId: string } | { needsRoom: true }>;
  onChange?: (session: CaptureSession) => void;
}): CaptureController {
  let session = deps.initial ?? loadCaptureState(deps.storage, deps.newId);
  let live: CaptureLive = { commit: deps.commit, destination: deps.destination };
  const replace = (next: CaptureSession) => {
    session = next;
    deps.onChange?.(next);
  };
  return {
    getState: () => session,
    setLive(next) {
      live = next;
    },
    edit(text) {
      const next = editText(session, text, deps.newId);
      const stored = persistDraft(deps.storage, next.draft);
      replace(stored ? next : degraded(next));
    },
    markDegraded() {
      const next = degraded(session);
      if (next === session) return;
      replace(next);
    },
    noteDestination(roomId) {
      const next = noteRoom(session, roomId, deps.newId);
      if (next === session) return;
      const stored = persistDraft(deps.storage, next.draft);
      replace(stored ? next : degraded(next));
    },
    observeRoom(roomId, stored) {
      let next = noteRoom(session, roomId, deps.newId);
      if (!stored) next = degraded(next);
      if (next.draft !== session.draft && !persistDraft(deps.storage, next.draft)) next = degraded(next);
      if (next === session) return;
      replace(next);
    },
    async save() {
      const target = await live.destination();
      const roomId = 'roomId' in target ? target.roomId : null;
      const begun = beginSave(session, roomId, deps.newId);
      if (!begun.ok) {
        replace(begun.session);
        return { closePanel: false };
      }
      const attemptStored = begun.recover ? true : persistAttempt(deps.storage, begun.sent);
      const draftStored = persistDraft(deps.storage, begun.session.draft);
      replace({
        ...begun.session,
        notice: attemptStored && draftStored ? begun.session.notice : { kind: 'degraded' },
      });
      const roomNow = async () => {
        const after = await live.destination();
        return 'roomId' in after ? after.roomId : roomId;
      };
      if (begun.recover) {
        const recovered = await live.commit(captureOperation(
          { text: begun.recover.text, opId: begun.recover.opId },
          begun.recover.roomId,
        ));
        const roomAfter = await roomNow();
        const latest = session.draft;
        if (!recovered.ok) {
          replace(settleFailed(session, begun.recover, latest, recovered.message));
          return { closePanel: false };
        }
        const settled = settleSaved(session, begun.recover, latest, true, deps.newId, roomAfter);
        const cleanupOk = persistSettled(deps.storage, settled);
        const shown = cleanupOk ? settled : keepAfterCleanupFailure(settled, begun.recover, latest);
        replace(shown);
        return { closePanel: false };
      }
      const result = await live.commit(begun.operation);
      const roomAfter = await roomNow();
      const latest = session.draft;
      if (!result.ok) {
        replace(settleFailed(session, begun.sent, latest, result.message));
        return { closePanel: false };
      }
      const settled = settleSaved(session, begun.sent, latest, true, deps.newId, roomAfter);
      const cleanupOk = persistSettled(deps.storage, settled);
      const shown = cleanupOk ? settled : keepAfterCleanupFailure(settled, begun.sent, latest);
      replace(shown);
      return { closePanel: shown.draft.text.trim().length === 0 };
    },
  };
}
