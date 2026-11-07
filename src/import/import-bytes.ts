import { MAX_IMPORT_BYTES } from './markdown.ts';
import { MAX_PDF_BYTES } from './pdf/parse.ts';

const NOTE_TOO_BIG = 'Each note must be at most 1 MiB.';
const PDF_TOO_BIG = 'Each PDF must be at most 8 MiB.';
const UNSUPPORTED = 'Only UTF-8 Markdown, OneNote HTML, MHTML and DOCX exports, and PDF files are supported.';
const TEXT_EXPORT = /\.(md|html?|mht|mhtml)$/i;

export type ImportRoute =
  | { kind: 'pdf'; limit: number }
  | { kind: 'docx' }
  | { kind: 'markdown' }
  | { kind: 'onenote-text' }
  | { kind: 'reject'; message: string };

/** Same order as the picker: PDF keeps its own 8 MiB limit, then the 1 MiB note limit. */
export function routeImportAsset(name: string, size: number | undefined): ImportRoute {
  if (/\.pdf$/i.test(name)) {
    if (size !== undefined && size > MAX_PDF_BYTES) return { kind: 'reject', message: PDF_TOO_BIG };
    return { kind: 'pdf', limit: MAX_PDF_BYTES };
  }
  if (size !== undefined && size > MAX_IMPORT_BYTES) return { kind: 'reject', message: NOTE_TOO_BIG };
  if (/\.docx$/i.test(name)) return { kind: 'docx' };
  if (/\.md$/i.test(name)) return { kind: 'markdown' };
  if (TEXT_EXPORT.test(name)) return { kind: 'onenote-text' };
  return { kind: 'reject', message: UNSUPPORTED };
}

export function documentPickerCopiesToCache(platform: string, expoGo: boolean): boolean {
  return !(platform === 'android' && expoGo);
}

export interface BoundedByteSource {
  read(maxBytes: number): Promise<Uint8Array>;
  close(): void;
}

/** Read at most `limit + 1` bytes, then close. A longer result is rejected before the caller decodes it. */
export async function takeCappedBytes(source: BoundedByteSource, limit: number, over: string): Promise<Uint8Array> {
  try {
    const read = await source.read(limit + 1);
    if (read.byteLength > limit) throw new Error(over);
    return Uint8Array.from(read);
  } finally {
    source.close();
  }
}
