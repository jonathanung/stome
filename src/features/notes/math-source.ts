/**
 * Splits note text for the reading view. The stored note is never rewritten:
 * callers keep the original string and only use these segments to draw it.
 *
 * Code fences and inline code stay literal. `$12.50` and `$1,000` stay prices.
 * `$...$`, `$$...$$`, `\(...\)` and `\[...\]` are math when they are closed.
 * An unclosed delimiter stays ordinary text.
 */

export type NoteInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'math'; tex: string };

export type NoteBlock =
  | { type: 'line'; code: boolean; heading: number | null; quote: boolean; inlines: NoteInline[] }
  | { type: 'math'; tex: string };

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;
const CURRENCY = /^\d{1,3}(?:,\d{3})*(?:\.\d+)?$/;

function fenceMark(line: string): { char: string; length: number; info: string } | null {
  const marker = FENCE.exec(line);
  if (!marker) return null;
  return { char: marker[1][0], length: marker[1].length, info: marker[2] };
}

function closesFence(line: string, open: { char: string; length: number }): boolean {
  const mark = fenceMark(line);
  return mark !== null && mark.char === open.char && mark.length >= open.length && mark.info.trim() === '';
}

function findOpener(line: string): { start: number; end: number; closer: string } | null {
  let code = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '`') { code = !code; continue; }
    if (code) continue;
    if (line[i] === '\\' && line[i + 1] === '$') { i += 1; continue; }
    if (line.startsWith('$$', i)) return { start: i, end: i + 2, closer: '$$' };
    if (line.startsWith('\\[', i)) return { start: i, end: i + 2, closer: '\\]' };
  }
  return null;
}

function findCloser(text: string, closer: string): number {
  return text.indexOf(closer);
}

function takeDisplay(lines: string[], index: number): { prefix: string; tex: string; suffix: string; next: number } | null {
  const open = findOpener(lines[index]);
  if (!open) return null;
  const rest = lines[index].slice(open.end);
  const closeHere = findCloser(rest, open.closer);
  if (closeHere !== -1) {
    return {
      prefix: lines[index].slice(0, open.start),
      tex: rest.slice(0, closeHere),
      suffix: rest.slice(closeHere + open.closer.length),
      next: index + 1,
    };
  }
  const tex: string[] = [rest];
  for (let j = index + 1; j < lines.length; j += 1) {
    const at = findCloser(lines[j], open.closer);
    if (at !== -1) {
      tex.push(lines[j].slice(0, at));
      return {
        prefix: lines[index].slice(0, open.start),
        tex: tex.join('\n'),
        suffix: lines[j].slice(at + open.closer.length),
        next: j + 1,
      };
    }
    tex.push(lines[j]);
  }
  return null;
}

function isCurrency(content: string): boolean {
  return CURRENCY.test(content);
}

function inlineDollar(text: string, index: number): number | null {
  if (text[index] !== '$' || text[index + 1] === '$') return null;
  if (index > 0 && text[index - 1] === '\\') return null;
  if (index > 0 && /[A-Za-z0-9]/.test(text[index - 1])) return null;
  const start = index + 1;
  if (start >= text.length || /\s/.test(text[start])) return null;
  let end = start;
  while (end < text.length && text[end] !== '$' && text[end] !== '\n') end += 1;
  if (text[end] !== '$') return null;
  if (text[end - 1] === '\\' || /\s/.test(text[end - 1])) return null;
  const content = text.slice(start, end);
  if (!content || isCurrency(content)) return null;
  return end;
}

export function parseInlines(text: string): NoteInline[] {
  const parts: NoteInline[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    parts.push({ type: 'text', text: buf });
    buf = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i) {
        flush();
        parts.push({ type: 'code', text: text.slice(i, close + 1) });
        i = close;
        continue;
      }
    }
    if (text.startsWith('\\(', i)) {
      const close = text.indexOf('\\)', i + 2);
      if (close !== -1) {
        const tex = text.slice(i + 2, close).trim();
        if (tex) {
          flush();
          parts.push({ type: 'math', tex });
          i = close + 1;
          continue;
        }
      }
    }
    const dollar = inlineDollar(text, i);
    if (dollar !== null) {
      flush();
      parts.push({ type: 'math', tex: text.slice(i + 1, dollar) });
      i = dollar;
      continue;
    }
    buf += text[i];
  }
  flush();
  return parts.length ? parts : [{ type: 'text', text }];
}

function lineBlock(line: string, code: boolean): NoteBlock {
  if (code) return { type: 'line', code: true, heading: null, quote: false, inlines: [{ type: 'text', text: line }] };
  const heading = /^(#{1,6})\s+(.+)$/.exec(line);
  const quote = !heading && line.startsWith('> ');
  const content = heading ? heading[2] : quote ? line.slice(2) : line.replace(/^[-*] /, '• ');
  return {
    type: 'line',
    code: false,
    heading: heading ? heading[1].length : null,
    quote,
    inlines: parseInlines(content),
  };
}

function appendPlain(blocks: NoteBlock[], text: string): void {
  if (text === '') return;
  blocks.push(lineBlock(text, false));
}

/** Reading structure for one note. Does not modify `body`. */
export function segmentNote(body: string): NoteBlock[] {
  const lines = body.split('\n');
  const blocks: NoteBlock[] = [];
  let i = 0;
  let fence: { char: string; length: number } | null = null;
  while (i < lines.length) {
    const mark = fenceMark(lines[i]);
    if (fence) {
      blocks.push(lineBlock(lines[i], true));
      if (mark && closesFence(lines[i], fence)) fence = null;
      i += 1;
      continue;
    }
    if (mark) {
      fence = mark;
      blocks.push(lineBlock(lines[i], true));
      i += 1;
      continue;
    }
    const display = takeDisplay(lines, i);
    if (display && display.tex.trim()) {
      appendPlain(blocks, display.prefix);
      blocks.push({ type: 'math', tex: display.tex.trim() });
      if (display.suffix) blocks.push(...segmentNote(display.suffix));
      i = display.next;
      continue;
    }
    blocks.push(lineBlock(lines[i], false));
    i += 1;
  }
  return blocks;
}
