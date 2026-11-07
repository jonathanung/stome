/**
 * Debounced autosave for one piece of text (#39, CAP.2).
 *
 * - Each edit marks the text unsaved and (re)starts the debounce timer.
 * - When the timer fires, the latest text is saved through the write boundary.
 * - A failed save keeps the text and enters "error". Nothing retries in the
 *   background: the person presses retry, or edits again (a new save).
 * - Edits made while a save is in flight are saved after it finishes.
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
  private readonly opts: Required<AutosaveOptions>;

  constructor(options: AutosaveOptions) {
    this.opts = { delayMs: AUTOSAVE_DELAY_MS, schedule: realSchedule, ...options };
  }

  /** Replaces the save function, e.g. when the caller re-renders with a new closure. */
  setSave(save: AutosaveOptions['save']): void {
    this.opts.save = save;
  }

  get current(): AutosaveState {
    return this.state;
  }

  edit(text: string): void {
    if (this.inFlight) this.dirtyDuringSave = true;
    this.set({ status: this.inFlight ? 'saving' : 'unsaved', text, error: null });
    this.restartTimer();
  }

  /** Saves now if there are unsaved edits (on blur, leaving the screen). */
  flush(): Promise<void> {
    this.clearTimer();
    if (this.state.status === 'unsaved') return this.saveNow();
    return this.inFlight ?? Promise.resolve();
  }

  /** Manual retry after a failed save. */
  retry(): Promise<void> {
    if (this.state.status !== 'error') return Promise.resolve();
    return this.saveNow();
  }

  /** Drops unsaved edits (the chunk is being deleted), so nothing saves later. */
  discard(): void {
    this.clearTimer();
    this.dirtyDuringSave = false;
    if (this.state.status === 'unsaved' || this.state.status === 'error') this.set({ status: 'saved', text: null, error: null });
  }

  dispose(): void {
    this.clearTimer();
  }

  private restartTimer(): void {
    this.clearTimer();
    if (this.inFlight) return; // saved again when the in-flight save finishes
    this.cancelTimer = this.opts.schedule(() => {
      this.cancelTimer = null;
      void this.saveNow();
    }, this.opts.delayMs);
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private saveNow(): Promise<void> {
    const text = this.state.text;
    if (text === null) return Promise.resolve();
    this.dirtyDuringSave = false;
    this.set({ status: 'saving', text, error: null });

    this.inFlight = (async () => {
      let outcome: SaveOutcome;
      try {
        outcome = await this.opts.save(text);
      } catch (error) {
        outcome = { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      this.inFlight = null;

      if (this.dirtyDuringSave) {
        // Newer text arrived meanwhile: that text is what needs saving now.
        this.set({ status: 'unsaved', text: this.state.text, error: null });
        this.restartTimer();
      } else if (outcome.ok) {
        this.set({ status: 'saved', text, error: null });
      } else {
        this.set({ status: 'error', text, error: outcome.message });
      }
    })();
    return this.inFlight;
  }

  private set(next: AutosaveState): void {
    this.state = next;
    this.opts.onChange(next);
  }
}
