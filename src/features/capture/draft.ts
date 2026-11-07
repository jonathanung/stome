import type { Operation } from '../../data/operations.ts';

export type CaptureDraft = {
  text: string;
  opId: string;
};

export const CAPTURE_DRAFT_KEY = 'stome.captureDraft';
export const LAST_ROOM_KEY = 'stome.lastRoomId';

export function emptyDraft(newId: () => string): CaptureDraft {
  return { text: '', opId: newId() };
}

export function parseDraft(raw: string | null): CaptureDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CaptureDraft>;
    if (typeof value.text !== 'string' || typeof value.opId !== 'string' || value.opId.length === 0) return null;
    return { text: value.text, opId: value.opId };
  } catch {
    return null;
  }
}

export function canSubmit(draft: CaptureDraft, busy: boolean): boolean {
  return !busy && draft.text.trim().length > 0;
}

/** A failed commit keeps the same text and operation id. Success starts a new draft. */
export function finishDraft(draft: CaptureDraft, ok: boolean, newId: () => string): CaptureDraft {
  if (!ok) return draft;
  return emptyDraft(newId);
}

/** One new human chunk. Editing that chunk belongs to the chunk editor, not here. */
export function captureOperation(draft: CaptureDraft, roomId: string): Operation<'chunk.create'> {
  return {
    opId: draft.opId,
    kind: 'chunk.create',
    source: 'human',
    confirmed: false,
    payload: { roomId, bodies: [draft.text.trim()], subjects: [] },
  };
}
