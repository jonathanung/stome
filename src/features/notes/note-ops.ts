/**
 * Pure helpers for the room notes screen: search, split and merge.
 * No React and no database, so they are tested in Node.
 */

import { LIMITS } from '../../data/operations.ts';

export interface SearchableNote {
  body: string;
  subjects: readonly string[];
}

/** Every word of the query must appear in the note text or its subjects (case-insensitive). */
export function matchesQuery(note: SearchableNote, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${note.body}\n${note.subjects.join(' ')}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Splits a note at the cursor. Whitespace around the cut is trimmed; both
 * halves must keep some text, otherwise there is nothing to split.
 */
export function splitAt(body: string, caret: number): { head: string; tail: string } | null {
  if (!Number.isInteger(caret) || caret <= 0 || caret >= body.length) return null;
  const head = body.slice(0, caret).replace(/\s+$/, '');
  const tail = body.slice(caret).replace(/^\s+/, '');
  if (!head.trim() || !tail.trim()) return null;
  return { head, tail };
}

/** Joins two notes with a blank line, keeping both subject lists (first one's order). */
export function mergeNotes(first: SearchableNote, second: SearchableNote): { body: string; subjects: string[] } | { error: string } {
  const body = `${first.body.replace(/\s+$/, '')}\n\n${second.body.replace(/^\s+/, '')}`;
  if (body.length > LIMITS.body) return { error: 'Those notes are too long to merge into one.' };
  const subjects: string[] = [];
  for (const subject of [...first.subjects, ...second.subjects]) {
    if (!subjects.some((kept) => kept.toLowerCase() === subject.toLowerCase())) subjects.push(subject);
  }
  if (subjects.length > LIMITS.subjects) return { error: 'Together these notes have too many subjects to merge.' };
  return { body, subjects };
}

/**
 * Subjects typed into one field. Clears the holder immediately so a second
 * call in the same turn (Enter blurs the field, and both events add) cannot
 * submit the same text again.
 */
export function consumeCommaList(holder: { current: string }): string[] {
  const raw = holder.current;
  holder.current = '';
  return raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Ctrl+Enter or Cmd+Enter. On devices without modifier keys this never matches. */
export function isSubmitShortcut(event: { key?: string; ctrlKey?: boolean; metaKey?: boolean; nativeEvent?: { key?: string; ctrlKey?: boolean; metaKey?: boolean } }): boolean {
  const key = event.key ?? event.nativeEvent?.key;
  const modifier = Boolean(event.ctrlKey || event.metaKey || event.nativeEvent?.ctrlKey || event.nativeEvent?.metaKey);
  return key === 'Enter' && modifier;
}
