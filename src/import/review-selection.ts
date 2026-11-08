import { destinationForMapping, type RoomMapping } from './room-map.ts';

export type ReviewGroup = 'imported' | 'needs' | 'ready' | 'skipped';

export function groupOf(note: { done: boolean; skipped: boolean; duplicate?: 'same' | 'changed'; mapping: RoomMapping }): ReviewGroup {
  if (note.done || (note.duplicate === 'same' && !note.skipped)) return 'imported';
  if (note.skipped) return 'skipped';
  return destinationForMapping(note.mapping) ? 'ready' : 'needs';
}

export function isSettled(note: { done: boolean; skipped: boolean; duplicate?: 'same' | 'changed'; mapping: RoomMapping }): boolean {
  return groupOf(note) !== 'needs';
}

/**
 * The note being reviewed stays selected after its room name becomes valid.
 * Falling back to the next note that still needs a room only happens when
 * nothing is selected, or the selected note was removed.
 */
export function selectedReviewNote<T extends { id: string; done: boolean; skipped: boolean; duplicate?: 'same' | 'changed'; mapping: RoomMapping }>(
  notes: readonly T[],
  selectedId: string | null,
): T | undefined {
  if (selectedId) {
    const pinned = notes.find((note) => note.id === selectedId);
    if (pinned) return pinned;
  }
  return notes.find((note) => groupOf(note) === 'needs') ?? notes[0];
}
