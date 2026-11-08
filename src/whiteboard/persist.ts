export type LoadedBoard = { elements: readonly unknown[]; revision: number } | null;

export type BoardWrite = {
  elements: unknown[];
  expectedRevision?: number;
};

export type BoardSaveStatus = 'saving' | 'saved' | 'unsaved';

export type BoardSaver = {
  readonly ready: boolean;
  readonly dirty: boolean;
  readonly revision: number;
  readonly elements: unknown[];
  load(loaded: LoadedBoard): void;
  edit(elements: readonly unknown[]): void;
  flush(): Promise<'saved' | 'unsaved'>;
};

export type LoadGate =
  | { open: false; message: string }
  | { open: true; elements: readonly unknown[]; revision: number };

/** A failed read keeps the stored row. Drawing stays closed until a later read succeeds. */
export function gateLoadedBoard(
  result: { ok: true; board: LoadedBoard } | { ok: false; corrupt: boolean },
): LoadGate {
  if (!result.ok) {
    return {
      open: false,
      message: result.corrupt
        ? 'This whiteboard could not be read. It was not replaced.'
        : 'Could not open this whiteboard. Nothing was changed.',
    };
  }
  return { open: true, elements: result.board?.elements ?? [], revision: result.board?.revision ?? 0 };
}

/** Notes leaves only after a successful flush, or after the user confirms the unsaved strokes. */
export function backAfterFlush(result: 'saved' | 'unsaved', confirmedLeave: boolean): 'stay' | 'leave' {
  if (result === 'saved') return 'leave';
  return confirmedLeave ? 'leave' : 'stay';
}

function elementId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('id' in value)) return null;
  const id = (value as { id: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Saved shapes stay, and shapes drawn before that snapshot arrived are kept
 * beside them. A local shape with the same id replaces the saved one.
 */
export function mergeBoardElements(saved: readonly unknown[], local: readonly unknown[]): unknown[] {
  const localById = new Map<string, unknown>();
  for (const el of local) {
    const id = elementId(el);
    if (id) localById.set(id, el);
  }
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const el of saved) {
    const id = elementId(el);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(localById.get(id) ?? el);
  }
  for (const el of local) {
    const id = elementId(el);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(el);
  }
  return merged;
}

/**
 * One writer for one room. Saves run in order. A stroke that lands while a
 * save is in flight is written next, using the revision that save returned.
 * A failed write stays queued for the next edit or flush.
 */
export function createBoardSaver(
  write: (save: BoardWrite) => Promise<{ revision: number }>,
  onStatus?: (status: BoardSaveStatus) => void,
): BoardSaver {
  let ready = false;
  let dirty = false;
  let revision = 0;
  let elements: unknown[] = [];
  let queued: unknown[] | null = null;
  let writing = false;
  let tail: Promise<void> = Promise.resolve();

  function pump(): void {
    if (!ready || writing || queued === null) return;
    const snapshot = queued;
    queued = null;
    writing = true;
    onStatus?.('saving');
    const expectedRevision = revision > 0 ? revision : undefined;
    tail = tail.then(async () => {
      let failed = false;
      try {
        const saved = await write({ elements: snapshot, expectedRevision });
        revision = saved.revision;
        if (queued === null) {
          dirty = false;
          onStatus?.('saved');
        }
      } catch {
        failed = true;
        if (queued === null) queued = snapshot;
        dirty = true;
        onStatus?.('unsaved');
      } finally {
        writing = false;
      }
      if (!failed && queued !== null) pump();
    });
  }

  return {
    get ready() { return ready; },
    get dirty() { return dirty; },
    get revision() { return revision; },
    get elements() { return elements; },
    load(loaded) {
      if (dirty) {
        elements = mergeBoardElements(loaded?.elements ?? [], elements);
        revision = loaded?.revision ?? 0;
        ready = true;
        queued = elements;
        pump();
        return;
      }
      elements = [...(loaded?.elements ?? [])];
      revision = loaded?.revision ?? 0;
      ready = true;
      dirty = false;
      queued = null;
    },
    edit(next) {
      elements = [...next];
      dirty = true;
      if (!ready) return;
      queued = elements;
      pump();
    },
    async flush() {
      for (let spin = 0; spin < 4; spin += 1) {
        const pending = tail;
        pump();
        await pending;
        await tail;
        if (!writing && queued === null && !dirty) return 'saved';
      }
      onStatus?.('unsaved');
      return 'unsaved';
    },
  };
}
