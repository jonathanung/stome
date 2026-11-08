/**
 * Paste handling for the chunk composer (#38, CAP.1): pasting several
 * paragraphs creates one chunk per paragraph.
 *
 * React Native has no cross-platform paste event, so a paste is recognized
 * by its shape: one change that inserts more than one character and leaves
 * text with a blank line between paragraphs.
 */

/** Splits on blank lines; trims each paragraph and drops empty ones. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** The text a single change introduced, ignoring the prefix and suffix that stayed put. */
function insertedSlice(previous: string, next: string): string {
  let start = 0;
  const max = Math.min(previous.length, next.length);
  while (start < max && previous[start] === next[start]) start += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return next.slice(start, nextEnd);
}

function hasParagraphBreak(text: string): boolean {
  return /\n[ \t]*\n/.test(text.replace(/\r\n?/g, '\n'));
}

/**
 * Given the composer's text before and after one change, returns the
 * paragraphs to turn into chunks if the change was a multi-paragraph paste,
 * or null to keep editing normally.
 *
 * The inserted text itself has to contain a blank line. A short edit inside
 * a draft that already has two paragraphs is still typing: committing it
 * would clear the composer while the person is writing.
 */
export function pastedParagraphs(previous: string, next: string): string[] | null {
  const inserted = next.length - previous.length;
  if (inserted <= 1) return null;
  if (!hasParagraphBreak(insertedSlice(previous, next))) return null;
  const paragraphs = splitParagraphs(next);
  return paragraphs.length > 1 ? paragraphs : null;
}
