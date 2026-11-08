import { IMPORT_EXCERPT_CHARS, MAX_IMPORT_NOTES } from '../harness/tools.ts';
import type { ImportSuggestInput, ImportSuggestion } from '../harness/tools.ts';
import { LIMITS } from '../data/operations.ts';
import { chooseExistingRoom, chooseNewRoom, type ExistingRoom, type RoomMapping } from './room-map.ts';

/**
 * Unit of suggestion: one reviewed note (one draft in the import screen). That is
 * the same unit the room-mapping step maps, because each draft owns one RoomMapping
 * and one `subjects` string. `id` is the draft id, so a suggestion maps straight back.
 */
export interface SuggestNote {
  id: string;
  title: string;
  bodies: readonly string[];
}

/** Cut at a word boundary, never above `max` characters. */
export function excerptAt(text: string, max: number = IMPORT_EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  // Keep the whole cut when it ends exactly on a word boundary.
  if (/\s/.test(clean[max] ?? '')) return cut.trimEnd();
  const lastSpace = cut.search(/\s\S*$/);
  const head = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return head.trimEnd();
}

/** Batches of at most MAX_IMPORT_NOTES notes, in draft order. */
export function buildSuggestBatches(
  notes: readonly SuggestNote[],
  rooms: readonly ExistingRoom[],
): ImportSuggestInput[] {
  const roomViews = rooms.map((room) => ({ id: room.id, name: room.name }));
  const views = notes.map((note) => ({
    id: note.id,
    title: note.title,
    text: excerptAt(note.bodies.join('\n\n')),
  }));
  const batches: ImportSuggestInput[] = [];
  for (let i = 0; i < views.length; i += MAX_IMPORT_NOTES) {
    batches.push({ notes: views.slice(i, i + MAX_IMPORT_NOTES), rooms: roomViews });
  }
  return batches;
}

function splitSubjects(subjects: string): string[] {
  return subjects.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** Existing subjects first, then suggested ones, deduplicated case-insensitively and within limits. */
export function mergeSubjects(current: string, suggested: readonly string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...splitSubjects(current), ...suggested.flatMap((s) => splitSubjects(s.replace(/,/g, ' ')))]) {
    const key = raw.toLowerCase();
    if (seen.has(key) || raw.length > LIMITS.subject || out.length >= LIMITS.subjects) continue;
    seen.add(key);
    out.push(raw);
  }
  return out.join(', ');
}

/** Pure: the mapping and subjects a suggestion would produce. Nothing is written. */
export function applySuggestion(
  suggestion: ImportSuggestion,
  currentSubjects: string,
): { mapping: RoomMapping; subjects: string } {
  const mapping =
    suggestion.roomId !== null
      ? chooseExistingRoom(suggestion.roomId)
      : chooseNewRoom((suggestion.newRoomName ?? '').trim().replace(/\s+/g, ' ').slice(0, LIMITS.roomName));
  return { mapping, subjects: mergeSubjects(currentSubjects, suggestion.subjects) };
}

/** Human label for the inline "Suggested: ..." line. */
export function describeSuggestion(suggestion: ImportSuggestion, rooms: readonly ExistingRoom[]): string {
  if (suggestion.roomId !== null) {
    const name = rooms.find((room) => room.id === suggestion.roomId)?.name ?? 'unknown room';
    return `Suggested: ${name} (existing)`;
  }
  return `Suggested: new room “${suggestion.newRoomName ?? ''}”`;
}
