import { Budget, decodeStream } from './filters.ts';
import { binaryString, dict, Lexer, name, num, ref, type PdfDict, type PdfValue } from './syntax.ts';

export const MAX_OBJECTS = 50_000;
export const MAX_PAGES = 150;
const MAX_OBJSTM_ENTRIES = 10_000;

interface StoredObject {
  value: PdfValue;
  /** Raw (still encoded) stream bytes, when the object is a stream. */
  raw?: Uint8Array;
  /** Offset of the object, or of the object stream that held it. Later wins. */
  pos: number;
}

export interface PdfPage {
  dict: PdfDict;
  resources: PdfDict | null;
}

/**
 * A loaded PDF: every object found by scanning the file. Scanning instead of
 * trusting the cross-reference table keeps damaged or incrementally saved
 * files readable; the latest definition of an object number wins.
 */
export class PdfDocument {
  readonly objects = new Map<number, StoredObject>();
  readonly trailer: PdfDict = { kind: 'dict', entries: new Map() };
  readonly budget: Budget;
  private readonly decoded = new Map<number, Uint8Array>();
  private readonly bytes: Uint8Array;

  private constructor(bytes: Uint8Array, budget: Budget) {
    this.bytes = bytes;
    this.budget = budget;
  }

  static async load(bytes: Uint8Array, budget: Budget): Promise<PdfDocument> {
    const doc = new PdfDocument(bytes, budget);
    const src = binaryString(bytes);
    if (!/%PDF-\d/.test(src.slice(0, 1024))) throw new Error('This file is not a PDF.');
    doc.scan(src);
    await doc.expandObjectStreams();
    if (doc.trailer.entries.has('Encrypt')) {
      throw new Error('This PDF is encrypted or password-protected. Export it again without a password.');
    }
    return doc;
  }

  private scan(src: string): void {
    const header = /(\d{1,10})[ \t\r\n\f\0]+(\d{1,5})[ \t\r\n\f\0]+obj\b/g;
    const trailers: { pos: number; dict: PdfDict }[] = [];
    let match: RegExpExecArray | null;
    while ((match = header.exec(src)) !== null) {
      if (this.objects.size >= MAX_OBJECTS) throw new Error('This PDF has too many objects to import safely.');
      const pos = match.index;
      const lexer = new Lexer(src, header.lastIndex);
      let value: PdfValue;
      try {
        const token = lexer.next();
        if (token.type !== 'value') continue;
        value = token.value;
      } catch {
        continue; // A damaged object is skipped; the rest of the file may still be readable.
      }
      const stored: StoredObject = { value, pos };
      lexer.skipSpace();
      const streamDict = dict(value);
      if (streamDict && src.startsWith('stream', lexer.pos)) {
        let start = lexer.pos + 6;
        if (src[start] === '\r' && src[start + 1] === '\n') start += 2;
        else if (src[start] === '\n' || src[start] === '\r') start += 1;
        const declared = num(streamDict.entries.get('Length'));
        let end = -1;
        if (declared !== null && declared >= 0 && start + declared <= src.length) {
          const after = src.slice(start + declared, start + declared + 12).replace(/^[\r\n]+/, '');
          if (after.startsWith('endstream')) end = start + declared;
        }
        if (end < 0) {
          const marker = src.indexOf('endstream', start);
          if (marker < 0) continue;
          end = marker;
          if (src[end - 1] === '\n') end -= 1;
          if (src[end - 1] === '\r') end -= 1;
        }
        stored.raw = this.bytes.subarray(start, end);
        header.lastIndex = Math.max(header.lastIndex, end);
        if (name(streamDict.entries.get('Type')) === 'XRef') trailers.push({ pos, dict: streamDict });
      } else {
        header.lastIndex = Math.max(header.lastIndex, lexer.pos);
      }
      this.objects.set(Number(match[1]), stored);
    }

    for (let at = src.indexOf('trailer'); at >= 0; at = src.indexOf('trailer', at + 7)) {
      try {
        const token = new Lexer(src, at + 7).next();
        const trailer = token.type === 'value' ? dict(token.value) : null;
        if (trailer) trailers.push({ pos: at, dict: trailer });
      } catch {
        // Ignore a damaged trailer; another one, or the catalog scan, may work.
      }
    }
    trailers.sort((a, b) => a.pos - b.pos);
    for (const { dict: trailer } of trailers) {
      for (const key of ['Root', 'Info', 'Encrypt']) {
        const value = trailer.entries.get(key);
        if (value !== undefined) this.trailer.entries.set(key, value);
      }
    }
  }

  private async expandObjectStreams(): Promise<void> {
    const streams = [...this.objects.entries()].filter(([, stored]) => stored.raw && name(dict(stored.value)?.entries.get('Type')) === 'ObjStm');
    for (const [objectNumber, stored] of streams) {
      const streamDict = dict(stored.value)!;
      const count = num(streamDict.entries.get('N')) ?? 0;
      const first = num(streamDict.entries.get('First')) ?? 0;
      if (count <= 0 || count > MAX_OBJSTM_ENTRIES) continue;
      let data: Uint8Array;
      try {
        data = await this.decodeObject(objectNumber);
      } catch {
        continue;
      }
      const src = binaryString(data);
      const lexer = new Lexer(src);
      const pairs: [number, number][] = [];
      for (let i = 0; i < count; i += 1) {
        const a = lexer.next();
        const b = lexer.next();
        if (a.type !== 'value' || b.type !== 'value' || num(a.value) === null || num(b.value) === null) break;
        pairs.push([num(a.value)!, num(b.value)!]);
      }
      for (const [inner, offset] of pairs) {
        const existing = this.objects.get(inner);
        if (existing && existing.pos > stored.pos) continue;
        if (this.objects.size >= MAX_OBJECTS && !existing) throw new Error('This PDF has too many objects to import safely.');
        try {
          const token = new Lexer(src, first + offset).next();
          if (token.type === 'value') this.objects.set(inner, { value: token.value, pos: stored.pos });
        } catch {
          // Skip a damaged entry.
        }
      }
    }
  }

  /** Follows references (bounded) to a direct value. */
  resolve(value: PdfValue | undefined): PdfValue | undefined {
    let current = value;
    for (let hops = 0; hops < 32; hops += 1) {
      const target = ref(current);
      if (!target) return current;
      current = this.objects.get(target.num)?.value;
    }
    return undefined;
  }

  resolveDict(value: PdfValue | undefined): PdfDict | null {
    return dict(this.resolve(value));
  }

  /** Decoded bytes of the stream object that `value` refers to, or null if it is not a stream. */
  async streamBytes(value: PdfValue | undefined): Promise<Uint8Array | null> {
    const target = ref(value);
    if (!target) return null;
    const stored = this.objects.get(target.num);
    if (!stored?.raw) return null;
    return this.decodeObject(target.num);
  }

  private async decodeObject(objectNumber: number): Promise<Uint8Array> {
    const cached = this.decoded.get(objectNumber);
    if (cached) return cached;
    const stored = this.objects.get(objectNumber);
    if (!stored?.raw) throw new Error('Not a stream.');
    const streamDict = dict(stored.value)!;
    // A /Length or /DecodeParms given by reference is resolved before decoding.
    const resolved: PdfDict = { kind: 'dict', entries: new Map(streamDict.entries) };
    for (const key of ['Filter', 'DecodeParms']) {
      const value = this.resolve(streamDict.entries.get(key));
      if (value !== undefined) resolved.entries.set(key, value);
    }
    const data = await decodeStream(resolved, stored.raw, this.budget);
    this.decoded.set(objectNumber, data);
    return data;
  }

  catalog(): PdfDict {
    const root = this.resolveDict(this.trailer.entries.get('Root'));
    if (root) return root;
    let found: { pos: number; dict: PdfDict } | null = null;
    for (const stored of this.objects.values()) {
      const candidate = dict(stored.value);
      if (candidate && name(candidate.entries.get('Type')) === 'Catalog' && (!found || stored.pos > found.pos)) found = { pos: stored.pos, dict: candidate };
    }
    if (!found) throw new Error('This PDF has no readable page catalog.');
    return found.dict;
  }

  info(): PdfDict | null {
    return this.resolveDict(this.trailer.entries.get('Info'));
  }

  /** Pages in reading order, with inherited resources. Cycles and depth are bounded. */
  pages(): PdfPage[] {
    const pages: PdfPage[] = [];
    const seen = new Set<PdfDict>();
    const visit = (value: PdfValue | undefined, inherited: PdfDict | null, depth: number): void => {
      if (depth > 32 || pages.length > MAX_PAGES) return;
      const node = this.resolveDict(value);
      if (!node || seen.has(node)) return;
      seen.add(node);
      const resources = this.resolveDict(node.entries.get('Resources')) ?? inherited;
      const type = name(node.entries.get('Type'));
      const kids = this.resolve(node.entries.get('Kids'));
      if (type === 'Pages' || (type !== 'Page' && Array.isArray(kids))) {
        for (const kid of Array.isArray(kids) ? kids : []) visit(kid, resources, depth + 1);
      } else {
        pages.push({ dict: node, resources });
      }
    };
    visit(this.catalog().entries.get('Pages'), null, 0);
    if (pages.length > MAX_PAGES) throw new Error(`This PDF has more than ${MAX_PAGES} pages. Split it and import the parts.`);
    if (!pages.length) throw new Error('This PDF has no pages.');
    return pages;
  }
}
