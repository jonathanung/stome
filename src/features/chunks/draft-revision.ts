import type { SaveOutcome } from './autosave';

/**
 * The revision a dirty chunk body was typed against.
 *
 * Captured on the first keystroke and then frozen. A later prop refresh
 * (an AI write landing at revision 2 while the draft still says 1) must not
 * move it: saving with the new revision would silently overwrite that write.
 */
export class DraftRevision {
  /** Last revision this editor successfully committed. */
  written = 0;
  /** Frozen base for the open draft. Null when the editor is clean. */
  private base: number | null = null;

  get frozen(): number | null {
    return this.base;
  }

  snapshot(): { baseRevision: number | null; writtenRevision: number } {
    return { baseRevision: this.base, writtenRevision: this.written };
  }

  restore(snapshot: { baseRevision: number | null; writtenRevision: number }): void {
    this.base = snapshot.baseRevision;
    this.written = snapshot.writtenRevision;
  }

  /** First keystroke of a clean editor captures the base; later ones keep it. */
  noteEdit(chunkRevision: number): void {
    if (this.base === null) this.base = Math.max(chunkRevision, this.written);
  }

  /** Body saves use the frozen base, never a revision that arrived afterwards. */
  expectedBody(chunkRevision: number): number {
    return this.base ?? Math.max(chunkRevision, this.written);
  }

  /** Move, tag, and delete target the newest revision known after a flush. */
  expectedStructural(chunkRevision: number): number {
    return Math.max(chunkRevision, this.written);
  }

  /**
   * A body save settled. Failure leaves the base alone so a retry cannot
   * adopt someone else's revision. A newer keystroke keeps a base at the
   * revision we just wrote, not at a prop that may already have moved on.
   */
  onBodySettled(ok: boolean, revision: number | undefined, stillDirty: boolean): void {
    if (!ok || revision === undefined) return;
    this.written = Math.max(this.written, revision);
    this.base = stillDirty ? this.written : null;
  }

  /**
   * A subject or move change that we sent at `sent` produced `revision`.
   * Advance a frozen body base only when it was the revision we sent, so a
   * conflicted draft is not retargeted at a newer row.
   */
  noteStructural(sent: number, revision: number): void {
    const next = Math.max(this.written, revision);
    if (this.base !== null && this.base === sent) this.base = next;
    this.written = next;
  }
}

export type BodySaveResult = { ok: true; revision?: number } | { ok: false; message: string };

/**
 * Sends the frozen base, then records whether the draft moved while the
 * write was in flight. `latestText` is read after the write returns.
 */
export async function saveBodyWithBase(
  revisions: DraftRevision,
  chunkRevision: number,
  body: string,
  latestText: () => string | null,
  commit: (expectedRevision: number) => Promise<BodySaveResult>,
): Promise<SaveOutcome> {
  const result = await commit(revisions.expectedBody(chunkRevision));
  const latest = latestText();
  revisions.onBodySettled(result.ok, result.ok ? result.revision : undefined, latest !== null && latest !== body);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}
