/**
 * Deleting a note with an Undo window.
 *
 * The note is hidden at once, but the delete is committed only after the
 * window closes (or when another note is deleted, or the screen is left).
 * Undo simply cancels it, so nothing has to be rebuilt and annotations are
 * never lost. If the commit fails, the note reappears. A reload during the
 * window leaves the note in place: failing safe, not losing data.
 */

export interface PendingDelete {
  chunkId: string;
  /** Shown in the undo bar, e.g. "Note deleted" or "Empty note removed". */
  label: string;
  /** For a note that was emptied: the text to put back on Undo. */
  restoreBody?: string;
}

export interface PendingDeleteOptions {
  commit(entry: PendingDelete): Promise<{ ok: true } | { ok: false; message: string }>;
  onChange(pending: PendingDelete | null): void;
  onError(message: string): void;
  delayMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export const UNDO_WINDOW_MS = 6000;

const realSchedule = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class PendingDeletes {
  private current: PendingDelete | null = null;
  private cancelTimer: (() => void) | null = null;
  private readonly committing = new Set<string>();
  private readonly opts: Required<PendingDeleteOptions>;

  constructor(options: PendingDeleteOptions) {
    this.opts = { delayMs: UNDO_WINDOW_MS, schedule: realSchedule, ...options };
  }

  get pending(): PendingDelete | null {
    return this.current;
  }

  /** Notes hidden right now: the one in the undo window and any still being committed. */
  isHidden(chunkId: string): boolean {
    return this.current?.chunkId === chunkId || this.committing.has(chunkId);
  }

  /** Hides a note and opens the undo window. An earlier pending delete is committed first. */
  async remove(entry: PendingDelete): Promise<void> {
    const previous = this.take();
    this.current = entry;
    this.cancelTimer = this.opts.schedule(() => {
      void this.flush();
    }, this.opts.delayMs);
    this.opts.onChange(entry);
    if (previous) await this.commit(previous);
  }

  /** Cancels the pending delete and returns it so the caller can restore text. */
  undo(): PendingDelete | null {
    const entry = this.take();
    this.opts.onChange(null);
    return entry;
  }

  /** Commits the pending delete now (window closed, or the screen is being left). */
  async flush(): Promise<void> {
    const entry = this.take();
    if (!entry) return;
    this.opts.onChange(null);
    await this.commit(entry);
  }

  private take(): PendingDelete | null {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const entry = this.current;
    this.current = null;
    return entry;
  }

  private async commit(entry: PendingDelete): Promise<void> {
    this.committing.add(entry.chunkId);
    try {
      const result = await this.opts.commit(entry);
      if (!result.ok) this.opts.onError(`Could not delete the note: ${result.message}`);
    } catch (error) {
      this.opts.onError(`Could not delete the note: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.committing.delete(entry.chunkId);
      this.opts.onChange(this.current);
    }
  }
}
