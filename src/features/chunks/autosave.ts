/**
 * Debounced autosave for one piece of text (#39, CAP.2).
 *
 * - Each edit marks the text unsaved and (re)starts the debounce timer.
 * - When the timer fires, the latest text is saved through the write boundary.
 * - A failed save keeps the text and enters "error". Nothing retries in the
 *   background: the person presses retry, or edits again (a new save).
 *   `flush` on an error is a no-op for the same reason.
 * - Edits made while a save is in flight are saved after it finishes.
 *   `flush` waits for that newer text too, not only the save already running.
 * - `dispose` drops the debounce. It does not schedule another save. A flush
 *   that was already requested still finishes, so leaving the screen saves
 *   the latest text once.
 * - `discard` runs only after a delete has succeeded. Until then the draft stays.
 *
 * No React here, so it is tested in Node with a fake timer.
 */

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';

export interface AutosaveState {
  status: SaveStatus;
  /** The latest text the person typed; null until the first edit. */
  text: string | null;
  error: string | null;
}

export type SaveOutcome = { ok: true } | { ok: false; message: string };

export interface AutosaveOptions {
  save(text: string): Promise<SaveOutcome>;
  onChange(state: AutosaveState): void;
  delayMs?: number;
  /** Starts a timer and returns a function that cancels it. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /**
   * Restores a draft after the editor was unmounted. No timer is armed, so
   * a failed save is not retried just because the screen came back.
   */
  initial?: AutosaveState;
}

export const AUTOSAVE_DELAY_MS = 800;

const realSchedule = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class AutosaveController {
  private state: AutosaveState = { status: 'saved', text: null, error: null };
  private cancelTimer: (() => void) | null = null;
  private inFlight: Promise<void> | null = null;
  /** True when the text changed after the in-flight save started. */
  private dirtyDuringSave = false;
  /** `flush` was called and must not resolve until the newest text is attempted. */
  private flushRequested = false;
  /** The editor is gone. Do not arm another debounce. */
  private disposed = false;
  /** Delete won. Drop drafts and do not write the chunk back. */
  private dropped = false;
  /** A delete is in flight. Unmount must not start a competing save. */
  private suppressSaves = false;
  private readonly opts: Required<Omit<AutosaveOptions, 'initial'>> & Pick<AutosaveOptions, 'initial'>;

  constructor(options: AutosaveOptions) {
    this.opts = { delayMs: AUTOSAVE_DELAY_MS, schedule: realSchedule, ...options };
    const initial = options.initial;
    if (initial && initial.text !== null && (initial.status === 'unsaved' || initial.status === 'error')) {
      this.state = {
        status: initial.status,
        text: initial.text,
        error: initial.status === 'error' ? initial.error : null,
      };
    }
  }

  /** Replaces the save function, e.g. when the caller re-renders with a new closure. */
  setSave(save: AutosaveOptions['save']): void {
    this.opts.save = save;
  }

  /** Replaces the state listener. Used so a draft can be stored after unmount. */
  setOnChange(onChange: AutosaveOptions['onChange']): void {
    this.opts.onChange = onChange;
  }

  get current(): AutosaveState {
    return this.state;
  }

  edit(text: string): void {
    if (this.dropped) return;
    if (this.suppressSaves) {
      this.set({ status: 'unsaved', text, error: null });
      return;
    }
    if (this.inFlight) this.dirtyDuringSave = true;
    this.set({ status: this.inFlight ? 'saving' : 'unsaved', text, error: null });
    this.restartTimer();
  }

  /**
   * Saves now if there are unsaved edits (on blur, leaving the screen).
   * Waits for a newer draft typed during an in-flight save. Does not retry
   * a save that already failed.
   */
  flush(): Promise<void> {
    if (this.dropped || this.suppressSaves) return this.inFlight ?? Promise.resolve();
    this.clearTimer();
    if (this.state.status === 'error') return Promise.resolve();
    this.flushRequested = true;
    if (!this.inFlight && this.state.status === 'unsaved') return this.saveNow();
    if (this.inFlight) return this.inFlight;
    this.flushRequested = false;
    return Promise.resolve();
  }

  /** Manual retry after a failed save. */
  retry(): Promise<void> {
    if (this.dropped || this.state.status !== 'error') return Promise.resolve();
    return this.saveNow();
  }

  /**
   * Blocks autosave while a delete is committing, so an unmount flush cannot
   * race the delete's revision. Call only after pending text has been flushed.
   */
  holdSaves(): void {
    this.suppressSaves = true;
    this.flushRequested = false;
    this.clearTimer();
  }

  /** Lets typing save again after a delete failed. */
  releaseSaves(): void {
    if (this.dropped) return;
    this.suppressSaves = false;
    if (this.disposed) return;
    if (this.state.status === 'unsaved') this.restartTimer();
  }

  /** Drops unsaved edits after the chunk delete has succeeded. */
  discard(): void {
    this.dropped = true;
    this.suppressSaves = false;
    this.flushRequested = false;
    this.dirtyDuringSave = false;
    this.clearTimer();
    if (this.state.status !== 'saved' || this.state.text !== null || this.state.error !== null) {
      this.set({ status: 'saved', text: null, error: null });
    }
  }

  /** Stops the debounce. An in-flight flush may finish; nothing new is scheduled. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private restartTimer(): void {
    this.clearTimer();
    if (this.inFlight || this.disposed || this.suppressSaves || this.dropped) return;
    this.cancelTimer = this.opts.schedule(() => {
      this.cancelTimer = null;
      if (this.disposed || this.suppressSaves || this.dropped) return;
      void this.saveNow();
    }, this.opts.delayMs);
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private saveNow(): Promise<void> {
    if (this.dropped || this.suppressSaves) return Promise.resolve();
    const text = this.state.text;
    if (text === null) {
      this.flushRequested = false;
      return Promise.resolve();
    }
    if (this.disposed && !this.flushRequested) return Promise.resolve();
    this.dirtyDuringSave = false;
    this.set({ status: 'saving', text, error: null });

    const flight: { current: Promise<void> | null } = { current: null };
    const run = (async () => {
      let outcome: SaveOutcome;
      try {
        outcome = await this.opts.save(text);
      } catch (error) {
        outcome = { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      if (this.inFlight === flight.current) this.inFlight = null;
      if (this.dropped) return;

      if (this.dirtyDuringSave) {
        const newer = this.state.text;
        this.dirtyDuringSave = false;
        if (this.flushRequested && !this.suppressSaves) {
          await this.saveNow();
          return;
        }
        this.set({ status: 'unsaved', text: newer, error: null });
        if (!this.disposed && !this.suppressSaves) this.restartTimer();
        return;
      }

      this.flushRequested = false;
      if (outcome.ok) this.set({ status: 'saved', text, error: null });
      else this.set({ status: 'error', text, error: outcome.message });
    })();

    flight.current = run;
    this.inFlight = run;
    return run;
  }

  private set(next: AutosaveState): void {
    this.state = next;
    this.opts.onChange(next);
  }
}

/**
 * Leaves the screen: try the pending text once, then never arm another timer.
 * The returned promise resolves after the newest draft is attempted. A save
 * that was already in error is left untouched.
 */
export function settleOnUnmount(controller: AutosaveController): Promise<void> {
  const pending = controller.flush();
  controller.dispose();
  return pending;
}

/**
 * Flush pending text, then delete at the revision that flush produced.
 * The draft is discarded only when the delete has really finished. A
 * `pending` result only hides the note for undo: a non-empty draft stays so
 * Undo, or a delete that fails when the window closes, can still show it.
 * An emptied note has no text of its own; that draft is dropped so Undo can
 * put the previous text back from the database. While the delete runs,
 * unmount will not start another save against the old revision.
 */
export async function deleteAfterFlush<T extends { ok: boolean; pending?: boolean }>(
  controller: AutosaveController,
  expectedRevision: () => number,
  onDelete: (revision: number) => Promise<T>,
): Promise<T> {
  await controller.flush();
  controller.holdSaves();
  try {
    const result = await onDelete(expectedRevision());
    const emptied = !(controller.current.text ?? '').trim();
    if (result.ok && (!result.pending || emptied)) controller.discard();
    return result;
  } finally {
    controller.releaseSaves();
  }
}
