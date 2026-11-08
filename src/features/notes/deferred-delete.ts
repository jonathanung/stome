/**
 * A note delete waits out an undo window before it is written. The revision
 * has to be read from the database at that moment: the list on screen can
 * still be the revision from before autosave, and deleting with that older
 * number fails. The note then stays after the person has left the room.
 */

export type DeferredOutcome = { ok: true } | { ok: false; message: string };

export async function commitDeferredDelete(
  chunkId: string,
  load: (chunkId: string) => Promise<{ revision: number } | null>,
  remove: (revision: number) => Promise<DeferredOutcome>,
): Promise<DeferredOutcome> {
  const latest = await load(chunkId);
  if (!latest) return { ok: true };
  return remove(latest.revision);
}

/** Undo of an emptied note writes the previous text at the revision on disk. */
export async function restoreDeferredBody(
  chunkId: string,
  load: (chunkId: string) => Promise<{ revision: number } | null>,
  update: (revision: number) => Promise<DeferredOutcome>,
): Promise<DeferredOutcome> {
  const latest = await load(chunkId);
  if (!latest) return { ok: false, message: 'This note no longer exists.' };
  return update(latest.revision);
}
