import type { PdfDocument } from './document.ts';
import { UnsupportedFilter } from './filters.ts';
import { fontDecoder, type FontDecoder } from './fonts.ts';
import { binaryString, Lexer, name, num, stringBytes, type PdfDict, type PdfValue } from './syntax.ts';

export interface PageText {
  lines: string[];
  images: number;
  unknownGlyphs: number;
  unsupportedFilters: string[];
}

const MAX_FORM_DEPTH = 4;
const MAX_OPS_PER_PAGE = 500_000;
/** A TJ adjustment more negative than this (thousandths of an em) is a word gap. */
const WORD_GAP = -200;

class LineBuilder {
  lines: string[] = [];
  private current = '';

  text(value: string): void {
    this.current += value;
  }

  space(): void {
    if (this.current && !this.current.endsWith(' ')) this.current += ' ';
  }

  newline(): void {
    const line = this.current.replace(/\s+/g, ' ').trim();
    if (line) this.lines.push(line);
    this.current = '';
  }
}

/** Skips inline image data (`BI … ID <binary> EI`), which is not text. */
function skipInlineImage(lexer: Lexer): void {
  const src = lexer.src;
  let at = lexer.pos + 1;
  for (;;) {
    const ei = src.indexOf('EI', at);
    if (ei < 0) {
      lexer.pos = src.length;
      return;
    }
    const before = src.charCodeAt(ei - 1);
    const after = ei + 2 >= src.length ? 0x20 : src.charCodeAt(ei + 2);
    const space = (code: number) => code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
    if (space(before) && space(after)) {
      lexer.pos = ei + 2;
      return;
    }
    at = ei + 2;
  }
}

/** Interprets one page's content streams and returns its text lines. */
export async function extractPageText(doc: PdfDocument, contents: PdfValue | undefined, resources: PdfDict | null): Promise<PageText> {
  const result: PageText = { lines: [], images: 0, unknownGlyphs: 0, unsupportedFilters: [] };
  const builder = new LineBuilder();
  let ops = 0;
  // Where the last drawn text ended, across text blocks and form XObjects.
  let cursor: { x: number; y: number } | null = null;
  let pendingNewline = false;

  /** Chooses the separator before text drawn at (x, y): nothing, a space or a new line. */
  const place = (x: number, y: number, size: number, text: string) => {
    if (pendingNewline) {
      builder.newline();
      pendingNewline = false;
    } else if (cursor) {
      const dy = Math.abs(y - cursor.y);
      const gap = x - cursor.x;
      // Another baseline, or a jump far to the left, starts a new line;
      // a gap wider than a quarter em is a word space.
      if (dy > 0.3 * size || gap < -size) builder.newline();
      else if (gap > 0.25 * size) builder.space();
    }
    builder.text(text);
  };

  const streamsOf = async (value: PdfValue | undefined): Promise<Uint8Array[]> => {
    const list = Array.isArray(value) ? value : [value];
    const out: Uint8Array[] = [];
    for (const item of list) {
      try {
        const bytes = await doc.streamBytes(item);
        if (bytes) out.push(bytes);
      } catch (error) {
        if (error instanceof UnsupportedFilter) result.unsupportedFilters.push(error.filter);
        else throw error;
      }
    }
    return out;
  };

  const run = async (data: Uint8Array, res: PdfDict | null, depth: number): Promise<void> => {
    const fonts = doc.resolveDict(res?.entries.get('Font'));
    const xobjects = doc.resolveDict(res?.entries.get('XObject'));
    const decoders = new Map<string, FontDecoder>();
    let font: FontDecoder | null = null;
    let fontSize = 12;
    let leading = 0;
    // Text line matrix [a b c d e f]; the pen is where the next glyph goes.
    let line = [1, 0, 0, 1, 0, 0];
    let penX = 0;
    let penY = 0;
    const stack: PdfValue[] = [];
    const lexer = new Lexer(binaryString(data));
    const scale = () => Math.hypot(line[0], line[1]) || 1;
    const moveTo = (tx: number, ty: number) => {
      const [a, b, c, d, e, f] = line;
      line = [a, b, c, d, tx * a + ty * c + e, tx * b + ty * d + f];
      penX = line[4];
      penY = line[5];
    };

    const show = (value: PdfValue | undefined) => {
      const bytes = stringBytes(value);
      if (!bytes || !font) return;
      const decoded = font.decode(bytes);
      result.unknownGlyphs += decoded.unknown;
      place(penX, penY, Math.abs(fontSize) * scale(), decoded.text);
      penX += decoded.width * fontSize * line[0];
      penY += decoded.width * fontSize * line[1];
      cursor = { x: penX, y: penY };
    };

    for (;;) {
      if ((ops += 1) > MAX_OPS_PER_PAGE) throw new Error('A PDF page has too many drawing operations to import safely.');
      const token = lexer.next();
      if (token.type === 'eof') break;
      if (token.type === 'value') {
        stack.push(token.value);
        if (stack.length > 64) stack.shift();
        continue;
      }
      const op = token.op;
      const nextLine = () => {
        if (leading) moveTo(0, -leading);
        else {
          pendingNewline = true;
          moveTo(0, 0);
        }
      };
      switch (op) {
        case 'BT':
          line = [1, 0, 0, 1, 0, 0];
          penX = 0;
          penY = 0;
          break;
        case 'Tf': {
          const fontName = name(stack[stack.length - 2]);
          fontSize = num(stack[stack.length - 1]) ?? fontSize;
          if (fontName !== null) {
            if (!decoders.has(fontName)) decoders.set(fontName, await fontDecoder(doc, doc.resolveDict(fonts?.entries.get(fontName))));
            font = decoders.get(fontName)!;
          }
          break;
        }
        case 'TL':
          leading = num(stack[stack.length - 1]) ?? leading;
          break;
        case 'Tj':
          show(stack[stack.length - 1]);
          break;
        case "'":
        case '"':
          nextLine();
          show(stack[stack.length - 1]);
          break;
        case 'TJ': {
          const items = stack[stack.length - 1];
          if (Array.isArray(items)) {
            for (const item of items) {
              const adjust = num(item);
              if (adjust === null) {
                show(item);
                continue;
              }
              penX -= (adjust / 1000) * fontSize * line[0];
              penY -= (adjust / 1000) * fontSize * line[1];
              if (adjust < WORD_GAP) builder.space();
              if (cursor) cursor = { x: penX, y: penY };
            }
          }
          break;
        }
        case 'Td':
        case 'TD': {
          const tx = num(stack[stack.length - 2]) ?? 0;
          const ty = num(stack[stack.length - 1]) ?? 0;
          if (op === 'TD') leading = -ty;
          moveTo(tx, ty);
          break;
        }
        case 'T*':
          nextLine();
          break;
        case 'Tm': {
          const matrix = stack.slice(-6).map((item) => num(item));
          if (matrix.length === 6 && matrix.every((value) => value !== null)) {
            line = matrix as number[];
            penX = line[4];
            penY = line[5];
          }
          break;
        }
        case 'Do': {
          const xName = name(stack[stack.length - 1]);
          const xRef = xName !== null ? xobjects?.entries.get(xName) : undefined;
          const xobject = doc.resolveDict(xRef);
          const subtype = name(xobject?.entries.get('Subtype'));
          if (subtype === 'Image') result.images += 1;
          else if (subtype === 'Form' && depth < MAX_FORM_DEPTH) {
            const [formData] = await streamsOf(xRef);
            if (formData) {
              const formResources = doc.resolveDict(xobject?.entries.get('Resources')) ?? res;
              await run(formData, formResources, depth + 1);
            }
          }
          break;
        }
        case 'BI':
          result.images += 1;
          skipInlineImage(lexer);
          break;
        default:
          break;
      }
      stack.length = 0;
    }
  };

  for (const data of await streamsOf(contents)) await run(data, resources, 0);
  builder.newline();
  result.lines = builder.lines;
  return result;
}

