import { MAX_VAULT_PATHS } from './markdown.ts';
import { destinationForMapping, type RoomMapping } from './room-map.ts';

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

/** Gives every open note that has no usable room the same mapping. Notes with a room keep it. */
export function assignRoomToUnmapped<T extends AssignableItem>(items: readonly T[], mapping: RoomMapping): T[] {
  return items.map((item) => item.done || item.skipped || destinationForMapping(item.mapping) ? item : { ...item, mapping });
}
