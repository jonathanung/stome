/**
 * PDF syntax for the bounded text-layer reader (#24): tokens and values.
 *
 * Bytes are viewed as a "binary string" (one char per byte) so offsets match
 * the file and nothing is decoded as UTF-8 by accident.
 */

export type PdfValue = null | boolean | number | PdfName | PdfString | PdfValue[] | PdfDict | PdfRef;

export interface PdfName {
  kind: 'name';
  name: string;
}

export interface PdfString {
  kind: 'string';
  bytes: Uint8Array;
}

export interface PdfRef {
  kind: 'ref';
  num: number;
  gen: number;
}

export interface PdfDict {
  kind: 'dict';
  entries: Map<string, PdfValue>;
}

export type Token = { type: 'value'; value: PdfValue } | { type: 'op'; op: string } | { type: 'eof' };

const DELIMITERS = '()<>[]{}/%';

export function binaryString(bytes: Uint8Array): string {
  let out = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return out;
}

export function isWhite(code: number): boolean {
  return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09 || code === 0x0c || code === 0x00;
}

function isDelimiter(char: string): boolean {
  return DELIMITERS.includes(char);
}

export function name(value: PdfValue | undefined): string | null {
  return value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'name' ? value.name : null;
}

export function dict(value: PdfValue | undefined): PdfDict | null {
  return value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'dict' ? value : null;
}

export function num(value: PdfValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function stringBytes(value: PdfValue | undefined): Uint8Array | null {
  return value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'string' ? value.bytes : null;
}

export function ref(value: PdfValue | undefined): PdfRef | null {
  return value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'ref' ? value : null;
}

/** Reads PDF tokens from a binary string. Every loop is bounded by the input length. */
export class Lexer {
  pos: number;
  readonly src: string;

  constructor(src: string, pos = 0) {
    this.src = src;
    this.pos = pos;
  }

  skipSpace(): void {
    const src = this.src;
    while (this.pos < src.length) {
      const code = src.charCodeAt(this.pos);
      if (isWhite(code)) {
        this.pos += 1;
      } else if (code === 0x25 /* % */) {
        while (this.pos < src.length && src[this.pos] !== '\n' && src[this.pos] !== '\r') this.pos += 1;
      } else {
        return;
      }
    }
  }

  /** The next value or operator. `ref` lookahead turns `n g R` into a reference. */
  next(depth = 0): Token {
    if (depth > 64) throw new Error('This PDF nests values too deeply to read safely.');
    this.skipSpace();
    const src = this.src;
    if (this.pos >= src.length) return { type: 'eof' };
    const char = src[this.pos];

    if (char === '/') return { type: 'value', value: this.readName() };
    if (char === '(') return { type: 'value', value: this.readLiteral() };
    if (char === '<' && src[this.pos + 1] === '<') {
      this.pos += 2;
      return { type: 'value', value: this.readDict(depth) };
    }
    if (char === '<') return { type: 'value', value: this.readHex() };
    if (char === '[') {
      this.pos += 1;
      const items: PdfValue[] = [];
      for (;;) {
        this.skipSpace();
        if (this.pos >= src.length) throw new Error('This PDF has an unclosed array.');
        if (src[this.pos] === ']') {
          this.pos += 1;
          return { type: 'value', value: items };
        }
        const token = this.next(depth + 1);
        if (token.type === 'value') items.push(token.value);
        else if (token.type === 'eof') throw new Error('This PDF has an unclosed array.');
        // Operators inside arrays are malformed input; skip them.
      }
    }
    if (char === ']' || char === '>' || char === ')' || char === '{' || char === '}') {
      this.pos += 1;
      return { type: 'op', op: char };
    }

    const start = this.pos;
    while (this.pos < src.length && !isWhite(src.charCodeAt(this.pos)) && !isDelimiter(src[this.pos])) this.pos += 1;
    const word = src.slice(start, this.pos);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      const value = Number(word);
      if (/^\d+$/.test(word)) {
        // `n g R` is a reference.
        const save = this.pos;
        const gen = this.peekInteger();
        if (gen !== null) {
          this.skipSpace();
          if (src[this.pos] === 'R' && (this.pos + 1 >= src.length || isWhite(src.charCodeAt(this.pos + 1)) || isDelimiter(src[this.pos + 1]))) {
            this.pos += 1;
            return { type: 'value', value: { kind: 'ref', num: value, gen } };
          }
        }
        this.pos = save;
      }
      return { type: 'value', value };
    }
    if (word === 'true') return { type: 'value', value: true };
    if (word === 'false') return { type: 'value', value: false };
    if (word === 'null') return { type: 'value', value: null };
    if (!word) {
      this.pos += 1;
      return { type: 'op', op: char };
    }
    return { type: 'op', op: word };
  }

  private peekInteger(): number | null {
    this.skipSpace();
    const match = /^\d+/.exec(this.src.slice(this.pos, this.pos + 12));
    if (!match) return null;
    const end = this.pos + match[0].length;
    if (end < this.src.length && !isWhite(this.src.charCodeAt(end)) && !isDelimiter(this.src[end])) return null;
    this.pos = end;
    return Number(match[0]);
  }

  private readName(): PdfName {
    const src = this.src;
    this.pos += 1;
    let out = '';
    while (this.pos < src.length && !isWhite(src.charCodeAt(this.pos)) && !isDelimiter(src[this.pos])) {
      if (src[this.pos] === '#' && /^[0-9A-Fa-f]{2}$/.test(src.slice(this.pos + 1, this.pos + 3))) {
        out += String.fromCharCode(parseInt(src.slice(this.pos + 1, this.pos + 3), 16));
        this.pos += 3;
      } else {
        out += src[this.pos];
        this.pos += 1;
      }
    }
    return { kind: 'name', name: out };
  }

  private readLiteral(): PdfString {
    const src = this.src;
    this.pos += 1;
    const bytes: number[] = [];
    let depth = 1;
    while (this.pos < src.length) {
      const char = src[this.pos];
      if (char === '\\') {
        const nextChar = src[this.pos + 1];
        this.pos += 2;
        switch (nextChar) {
          case 'n': bytes.push(10); break;
          case 'r': bytes.push(13); break;
          case 't': bytes.push(9); break;
          case 'b': bytes.push(8); break;
          case 'f': bytes.push(12); break;
          case '\r':
            if (src[this.pos] === '\n') this.pos += 1;
            break;
          case '\n':
            break;
          default:
            if (nextChar !== undefined && /[0-7]/.test(nextChar)) {
              let octal = nextChar;
              while (octal.length < 3 && /[0-7]/.test(src[this.pos] ?? '')) {
                octal += src[this.pos];
                this.pos += 1;
              }
              bytes.push(parseInt(octal, 8) & 0xff);
            } else if (nextChar !== undefined) {
              bytes.push(nextChar.charCodeAt(0) & 0xff);
            }
        }
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          this.pos += 1;
          return { kind: 'string', bytes: Uint8Array.from(bytes) };
        }
      }
      bytes.push(src.charCodeAt(this.pos) & 0xff);
      this.pos += 1;
    }
    throw new Error('This PDF has an unclosed string.');
  }

  private readHex(): PdfString {
    const src = this.src;
    const end = src.indexOf('>', this.pos);
    if (end < 0) throw new Error('This PDF has an unclosed hex string.');
    let hex = src.slice(this.pos + 1, end).replace(/[^0-9A-Fa-f]/g, '');
    this.pos = end + 1;
    if (hex.length % 2) hex += '0';
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return { kind: 'string', bytes };
  }

  private readDict(depth: number): PdfDict {
    const entries = new Map<string, PdfValue>();
    const src = this.src;
    for (;;) {
      this.skipSpace();
      if (this.pos >= src.length) throw new Error('This PDF has an unclosed dictionary.');
      if (src[this.pos] === '>' && src[this.pos + 1] === '>') {
        this.pos += 2;
        return { kind: 'dict', entries };
      }
      const key = this.next(depth + 1);
      if (key.type === 'eof') throw new Error('This PDF has an unclosed dictionary.');
      if (key.type !== 'value' || name(key.value) === null) continue;
      const value = this.next(depth + 1);
      if (value.type === 'value') entries.set(name(key.value)!, value.value);
      else if (value.type === 'eof') throw new Error('This PDF has an unclosed dictionary.');
    }
  }
}
