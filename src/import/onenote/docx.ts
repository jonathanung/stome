import { MAX_IMPORT_BYTES, decodeEntities } from './shared.ts';

const LOCAL_SIG = 0x04034b50;
const MAX_ENTRIES = 64;
const MAX_NAME = 1024;

interface ZipEntry {
  name: string;
  method: number;
  compressed: Uint8Array;
  uncompressedSize: number;
}

export interface DocxPackage {
  documentXml: string;
  hasMedia: boolean;
  hasMacros: boolean;
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && entries.length < MAX_ENTRIES) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== LOCAL_SIG) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags & 0x1) throw new Error('Encrypted DOCX entries are not supported.');
    if (flags & 0x8) throw new Error('This DOCX uses a streaming ZIP layout this importer cannot bound safely.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error('ZIP64 DOCX packages are not supported.');
    if (uncompressedSize > MAX_IMPORT_BYTES) throw new Error('A DOCX entry expands beyond the 1 MiB import limit.');
    if (nameLength > MAX_NAME) throw new Error('This DOCX entry name is too long.');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart + compressedSize > bytes.length) throw new Error('This DOCX is truncated or its ZIP headers are not safe.');
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(nameStart, nameStart + nameLength));
    } catch {
      throw new Error('This DOCX entry name is not valid UTF-8.');
    }
    if (name.includes('\0') || name.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('DOCX entry path is not safe.');
    }
    if (method !== 0 && method !== 8) throw new Error('This DOCX uses a compression method that is not supported.');
    if (method === 0 && compressedSize !== uncompressedSize) throw new Error('This DOCX stored entry has an inconsistent size.');
    entries.push({
      name,
      method,
      compressed: bytes.subarray(dataStart, dataStart + compressedSize),
      uncompressedSize,
    });
    offset = dataStart + compressedSize;
  }
  if (offset + 4 <= bytes.length && entries.length >= MAX_ENTRIES && view.getUint32(offset, true) === LOCAL_SIG) {
    throw new Error('This DOCX has too many entries to import safely.');
  }
  if (!entries.length) throw new Error('This file is not a readable DOCX document.');
  return entries;
}

async function inflateRaw(compressed: Uint8Array, expected: number): Promise<Uint8Array> {
  const Stream = globalThis.DecompressionStream;
  if (typeof Stream !== 'function') throw new Error('DOCX compression cannot be read here. Import an HTML or MHTML export instead.');
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy]).stream().pipeThrough(new Stream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > expected) throw new Error('A DOCX entry expands beyond the 1 MiB import limit.');
      chunks.push(step.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expected) throw new Error('This DOCX entry decompressed to an unexpected size.');
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

interface XmlTag {
  local: string;
  closing: boolean;
  selfClosing: boolean;
  next: number;
}

function xmlLocal(raw: string): string {
  const name = raw.toLowerCase();
  const colon = name.lastIndexOf(':');
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function readXmlTag(xml: string, start: number): XmlTag {
  let quote: '"' | "'" | null = null;
  let end = -1;
  const limit = Math.min(xml.length, start + 65_536);
  for (let i = start + 1; i < limit; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This DOCX document has a tag that is too long or unclosed.');
  const raw = xml.slice(start, end + 1);
  const match = /^<\s*(\/?)\s*([^\s/>]+)/.exec(raw);
  return {
    local: match ? xmlLocal(match[2]) : '',
    closing: match?.[1] === '/',
    selfClosing: raw.endsWith('/>'),
    next: end + 1,
  };
}

function closeAt(xml: string, from: number, local: string): { start: number; next: number } {
  let i = from;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    const tag = readXmlTag(xml, lt);
    if (tag.closing && tag.local === local) return { start: lt, next: tag.next };
    i = tag.next;
  }
  throw new Error('This DOCX document has an unclosed text element.');
}

export interface DocxParagraph {
  text: string;
  level: number | null;
  media: boolean;
}

function headingLevel(inner: string): number | null {
  const style = /<(?:[\w.-]+:)?pStyle\b[^>]*\b(?:[\w.-]+:)?val\s*=\s*"([^"]+)"/i.exec(inner);
  if (style) {
    const heading = /^heading\s*([1-6])$/i.exec(style[1].trim());
    if (heading) return Number(heading[1]);
    if (/^title$/i.test(style[1].trim())) return 1;
  }
  const outline = /<(?:[\w.-]+:)?outlineLvl\b[^>]*\b(?:[\w.-]+:)?val\s*=\s*"(\d+)"/i.exec(inner);
  if (outline) {
    const level = Number(outline[1]);
    if (level >= 0 && level <= 5) return level + 1;
  }
  return null;
}

function paragraphText(inner: string): { text: string; media: boolean } {
  let text = '';
  let media = false;
  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf('<', i);
    if (lt < 0) break;
    if (inner.startsWith('<!--', lt)) {
      const close = inner.indexOf('-->', lt + 4);
      if (close < 0) throw new Error('This DOCX document has an unclosed comment.');
      i = close + 3;
      continue;
    }
    const tag = readXmlTag(inner, lt);
    if (tag.local === 'drawing' || tag.local === 'pict' || tag.local === 'object' || tag.local === 'blip') media = true;
    if (!tag.closing && (tag.local === 'tab' || tag.local === 'br') && tag.selfClosing) text += tag.local === 'tab' ? '\t' : '\n';
    if (!tag.closing && !tag.selfClosing && (tag.local === 'instrtext' || tag.local === 'del' || tag.local === 'deltext')) {
      i = closeAt(inner, tag.next, tag.local).next;
      continue;
    }
    if (!tag.closing && !tag.selfClosing && tag.local === 't') {
      const close = closeAt(inner, tag.next, 't');
      text += decodeEntities(inner.slice(tag.next, close.start));
      i = close.next;
      continue;
    }
    i = tag.next;
  }
  return { text: text.replace(/[ \t]+\n/g, '\n').trim(), media };
}

export function paragraphsFromDocumentXml(xml: string): DocxParagraph[] {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('This DOCX contains a document type this importer will not resolve.');
  if (xml.includes('\0')) throw new Error('This DOCX document is not valid text.');
  const paragraphs: DocxParagraph[] = [];
  let depth = 0;
  let start = -1;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (xml.startsWith('<!--', lt)) {
      const close = xml.indexOf('-->', lt + 4);
      if (close < 0) throw new Error('This DOCX document has an unclosed comment.');
      i = close + 3;
      continue;
    }
    const tag = readXmlTag(xml, lt);
    if (tag.local === 'p' && !tag.closing && !tag.selfClosing) {
      if (depth === 0) start = tag.next;
      depth++;
    } else if (tag.local === 'p' && tag.closing) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        const inner = xml.slice(start, lt);
        const text = paragraphText(inner);
        paragraphs.push({ text: text.text, level: headingLevel(inner), media: text.media });
        start = -1;
      }
    }
    i = tag.next;
  }
  return paragraphs;
}

/** Read `word/document.xml` only. Media and macros are detected, not unpacked or run. */
export async function readDocxPackage(bytes: Uint8Array): Promise<DocxPackage> {
  const entries = readZipEntries(bytes);
  const document = entries.find((entry) => entry.name === 'word/document.xml');
  if (!document) {
    if (entries.some((entry) => entry.name === 'EncryptionInfo' || entry.name === 'EncryptedPackage')) {
      throw new Error('Encrypted DOCX files are not supported.');
    }
    throw new Error('This DOCX has no word/document.xml page to import.');
  }
  const xmlBytes = document.method === 0 ? document.compressed : await inflateRaw(document.compressed, document.uncompressedSize);
  let documentXml: string;
  try {
    documentXml = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes);
  } catch {
    throw new Error('word/document.xml is not valid UTF-8.');
  }
  if (new TextEncoder().encode(documentXml).length > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
  return {
    documentXml,
    hasMedia: entries.some((entry) => entry.name.startsWith('word/media/')),
    hasMacros: entries.some((entry) => entry.name.toLowerCase().includes('vbaproject')),
  };
}
