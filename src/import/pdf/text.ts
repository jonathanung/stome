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
    let lastY: number | null = null;
    const stack: PdfValue[] = [];
    const lexer = new Lexer(binaryString(data));

    const show = (value: PdfValue | undefined) => {
      const bytes = stringBytes(value);
      if (!bytes || !font) return;
      const decoded = font.decode(bytes);
      result.unknownGlyphs += decoded.unknown;
      builder.text(decoded.text);
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
      switch (op) {
        case 'BT':
          lastY = null;
          break;
        case 'ET':
          builder.newline();
          break;
        case 'Tf': {
          const fontName = name(stack[stack.length - 2]);
          if (fontName !== null) {
            if (!decoders.has(fontName)) decoders.set(fontName, await fontDecoder(doc, doc.resolveDict(fonts?.entries.get(fontName))));
            font = decoders.get(fontName)!;
          }
          break;
        }
        case 'Tj':
          show(stack[stack.length - 1]);
          break;
        case "'":
          builder.newline();
          show(stack[stack.length - 1]);
          break;
        case '"':
          builder.newline();
          show(stack[stack.length - 1]);
          break;
        case 'TJ': {
          const items = stack[stack.length - 1];
          if (Array.isArray(items)) {
            for (const item of items) {
              const adjust = num(item);
              if (adjust !== null) {
                if (adjust < WORD_GAP) builder.space();
              } else show(item);
            }
          }
          break;
        }
        case 'Td':
        case 'TD': {
          const tx = num(stack[stack.length - 2]) ?? 0;
          const ty = num(stack[stack.length - 1]) ?? 0;
          if (Math.abs(ty) > 0.01) builder.newline();
          else if (tx > 0) builder.space();
          if (lastY !== null) lastY += ty;
          break;
        }
        case 'T*':
          builder.newline();
          lastY = null;
          break;
        case 'Tm': {
          // An absolute move: same baseline continues the line, anything else
          // (or an unknown previous position) starts a new one.
          const y = num(stack[stack.length - 1]);
          if (y === null || lastY === null || Math.abs(y - lastY) > 0.01) builder.newline();
          else builder.space();
          lastY = y;
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
    builder.newline();
  };

  for (const data of await streamsOf(contents)) await run(data, resources, 0);
  builder.newline();
  result.lines = builder.lines;
  return result;
}

