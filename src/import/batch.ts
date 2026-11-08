import { MAX_VAULT_PATHS } from './markdown.ts';
import { groupOf } from './review-selection.ts';
import { chooseExistingRoom, destinationForMapping, type RoomMapping } from './room-map.ts';

/**
 * Most notes one import batch holds, across every pick. Each file is already
 * bounded (1 MiB text, 8 MiB PDF or image), so this bounds review memory.
 */
export const MAX_IMPORT_BATCH = MAX_VAULT_PATHS;

export function batchLimitMessage(dropped: number, max = MAX_IMPORT_BATCH): string {
  return `An import holds up to ${max} notes. ${dropped} ${dropped === 1 ? 'file was' : 'files were'} not added. Save this batch, then import the rest.`;
}

/** How many more files the batch can take. */
export function remainingCapacity(current: number, max = MAX_IMPORT_BATCH): number {
  return Math.max(0, max - current);
}

interface BatchItem {
  note: { path: string; fingerprint: string };
}

/**
 * Appends a new pick to the batch. Drops files already in the batch (same file
 * name and content) and anything past the cap. Never reorders or removes existing items.
 */
export function mergeBatch<T extends BatchItem>(existing: readonly T[], incoming: readonly T[], max = MAX_IMPORT_BATCH): {
  items: T[];
  duplicates: number;
  dropped: number;
} {
  const seen = new Set(existing.map((item) => `${item.note.path}\0${item.note.fingerprint}`));
  const items = [...existing];
  let duplicates = 0;
  let dropped = 0;
  for (const item of incoming) {
    const key = `${item.note.path}\0${item.note.fingerprint}`;
    if (seen.has(key)) { duplicates += 1; continue; }
    if (items.length >= max) { dropped += 1; continue; }
    seen.add(key);
    items.push(item);
  }
  return { items, duplicates, dropped };
}

interface AssignableItem {
  mapping: RoomMapping;
  done?: boolean;
  skipped?: boolean;
}

/**
 * Notes saved together with the same new room name share the room created by
 * the first of them. Later notes keep their own choice.
 */
export function shareCreatedRoom(mapping: RoomMapping, created: ReadonlyMap<string, string>): RoomMapping {
  const destination = destinationForMapping(mapping);
  if (!destination || !('name' in destination)) return mapping;
  const roomId = created.get(destination.name.toLowerCase());
  return roomId ? chooseExistingRoom(roomId) : mapping;
}

interface BatchRoomDraft {
  done?: boolean;
  skipped?: boolean;
  duplicate?: 'same' | 'changed';
  mapping: RoomMapping;
  /** Normalized name of a room this batch created for this note. Absent for an explicit existing room. */
  createdRoomName?: string;
}

/** Remembers the room a successful new-room save created, including when a later refresh fails. */
export function savedDraftPatch(mapping: RoomMapping, roomId: string, result: string): {
  done: true;
  mapping: RoomMapping;
  result: string;
  createdRoomName?: string;
} {
  const destination = destinationForMapping(mapping);
  const patch = { done: true as const, mapping: chooseExistingRoom(roomId), result };
  if (!destination || !('name' in destination)) return patch;
  return { ...patch, createdRoomName: destination.name.toLowerCase() };
}

/**
 * Rooms this batch has already created, keyed by the normalized name its notes
 * asked for. An existing room that merely has the same name is not consulted.
 */
export function createdRoomsInBatch(drafts: readonly BatchRoomDraft[]): Map<string, string> {
  const created = new Map<string, string>();
  for (const draft of drafts) {
    if (!draft.done || !draft.createdRoomName) continue;
    const destination = destinationForMapping(draft.mapping);
    if (destination && 'roomId' in destination) created.set(draft.createdRoomName, destination.roomId);
  }
  return created;
}

/** Saves ready notes in order. A later attempt reuses rooms this batch already created. */
export async function saveReadyImports<T extends BatchRoomDraft>(
  drafts: readonly T[],
  save: (draft: T, mapping: RoomMapping) => Promise<string | null>,
): Promise<void> {
  const created = createdRoomsInBatch(drafts);
  for (const draft of drafts) {
    if (groupOf({ done: draft.done === true, skipped: draft.skipped === true, duplicate: draft.duplicate, mapping: draft.mapping }) !== 'ready') continue;
    const destination = destinationForMapping(draft.mapping);
    const mapping = shareCreatedRoom(draft.mapping, created);
    const roomId = await save(draft, mapping);
    if (!roomId) return;
    if (destination && 'name' in destination) created.set(destination.name.toLowerCase(), roomId);
  }
}

/** Gives every open note that has no usable room the same mapping. Notes with a room keep it. */
export function assignRoomToUnmapped<T extends AssignableItem>(items: readonly T[], mapping: RoomMapping): T[] {
  return items.map((item) => item.done || item.skipped || destinationForMapping(item.mapping) ? item : { ...item, mapping });
}
