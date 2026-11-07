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

/**
 * Given the composer's text before and after one change, returns the
 * paragraphs to turn into chunks if the change was a multi-paragraph paste,
 * or null to keep editing normally.
 */
export function pastedParagraphs(previous: string, next: string): string[] | null {
  const inserted = next.length - previous.length;
  if (inserted <= 1) return null;
  const paragraphs = splitParagraphs(next);
  return paragraphs.length > 1 ? paragraphs : null;
}
