export type NoteFormat = 'heading' | 'bullet' | 'quote' | 'bold' | 'italic';
export interface NoteSelection { start: number; end: number }

/** Keep note text portable: formatting uses Markdown and the existing autosave. */
export function formatNote(text: string, selection: NoteSelection, format: NoteFormat) {
  const start = Math.max(0, Math.min(text.length, selection.start));
  const end = Math.max(start, Math.min(text.length, selection.end));
  if (format === 'bold' || format === 'italic') {
    const mark = format === 'bold' ? '**' : '*';
    const selected = text.slice(start, end);
    const content = selected || 'text';
    return {
      text: text.slice(0, start) + mark + content + mark + text.slice(end),
      selection: { start: start + mark.length, end: start + mark.length + content.length },
    };
  }
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', Math.max(start, end - 1));
  const to = newline < 0 ? text.length : newline;
  const prefix = format === 'heading' ? '## ' : format === 'bullet' ? '- ' : '> ';
  const lines = text.slice(from, to).split('\n');
  const remove = lines.every((line) => line.startsWith(prefix));
  const replacement = lines.map((line) => remove ? line.slice(prefix.length) : prefix + line.replace(/^(?:#{1,6} |[-*] |> )/, '')).join('\n');
  return { text: text.slice(0, from) + replacement + text.slice(to), selection: { start: from, end: from + replacement.length } };
}
