export type NoteFormat = 'heading' | 'bullet' | 'numbered' | 'checklist' | 'quote' | 'bold' | 'italic' | 'code' | 'link';
export interface NoteSelection { start: number; end: number }

/** Keep note text portable: formatting uses Markdown and the existing autosave. */
export function formatNote(text: string, selection: NoteSelection, format: NoteFormat) {
  const start = Math.max(0, Math.min(text.length, selection.start));
  const end = Math.max(start, Math.min(text.length, selection.end));
  if (format === 'link') {
    const selected = text.slice(start, end);
    const label = selected || 'text';
    const url = 'https://';
    const replacement = `[${label}](${url})`;
    return {
      text: text.slice(0, start) + replacement + text.slice(end),
      selection: selected
        ? { start: start + label.length + 3, end: start + label.length + 3 + url.length }
        : { start: start + 1, end: start + 1 + label.length },
    };
  }
  if (format === 'bold' || format === 'italic' || format === 'code') {
    const mark = format === 'bold' ? '**' : format === 'italic' ? '*' : '`';
    const selected = text.slice(start, end);
    const neighboringMarks = start >= mark.length && text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark;
    const belongsToLongerMark = mark === '*' && (text[start - 2] === '*' || text[end + 1] === '*');
    if (neighboringMarks && !belongsToLongerMark) {
      return {
        text: text.slice(0, start - mark.length) + selected + text.slice(end + mark.length),
        selection: { start: start - mark.length, end: end - mark.length },
      };
    }
    if (selected.length > mark.length * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
      const content = selected.slice(mark.length, -mark.length);
      return {
        text: text.slice(0, start) + content + text.slice(end),
        selection: { start, end: start + content.length },
      };
    }
    const content = selected || 'text';
    return {
      text: text.slice(0, start) + mark + content + mark + text.slice(end),
      selection: { start: start + mark.length, end: start + mark.length + content.length },
    };
  }
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', Math.max(start, end - 1));
  const to = newline < 0 ? text.length : newline;
  const prefix = format === 'heading' ? '## ' : format === 'bullet' ? '- ' : format === 'checklist' ? '- [ ] ' : format === 'quote' ? '> ' : null;
  const lines = text.slice(from, to).split('\n');
  const remove = lines.every((line) => prefix ? line.startsWith(prefix) : /^\d+\. /.test(line));
  const replacement = lines.map((line, index) => {
    if (remove) return prefix ? line.slice(prefix.length) : line.replace(/^\d+\. /, '');
    const clean = line.replace(/^(?:#{1,6} |[-*] \[[ xX]\] |[-*] |\d+\. |> )/, '');
    return (prefix ?? `${index + 1}. `) + clean;
  }).join('\n');
  return { text: text.slice(0, from) + replacement + text.slice(to), selection: { start: from, end: from + replacement.length } };
}
