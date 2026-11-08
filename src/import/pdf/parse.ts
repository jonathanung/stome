/**
 * Generic PDF import for issue #24, using the #28 route: selectable text per
 * page, with the page kept as a heading on each chunk. This is the shared path
 * for GoodNotes, OneNote and Freeform PDF exports.
 *
 * Not supported: OCR or handwriting recognition, encrypted PDFs, keeping the
 * original PDF as a visual reference (needs the shared asset storage planned
 * in #28), and authentic GoodNotes/OneNote/Freeform certification (#19, #72).
 * Tests use synthetic PDFs.
 */

import { LIMITS } from '../../data/operations.ts';
import type { ParsedNote } from '../markdown.ts';
import { folderSubjects } from '../onenote/shared.ts';
import { MAX_PAGES, PdfDocument } from './document.ts';
import { Budget } from './filters.ts';
import { stringBytes } from './syntax.ts';
import { extractPageText } from './text.ts';

/** PDF exports are larger than text notes; text is still bounded per page. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;
/** Total decompressed bytes across all streams in one PDF. */
export const MAX_PDF_EXPANDED_BYTES = 64 * 1024 * 1024;

export const PDF_WARNING =
  'Only selectable text was imported, one chunk per page. Handwriting, drawings and images are not recognized (no OCR), and the original PDF is not stored. Reading order follows the PDF and can differ from the visible layout. This reader was not checked against an authentic GoodNotes, OneNote or Freeform export.';

export interface PdfNote extends ParsedNote {
  exportFormat: 'pdf';
  /** Page number for each body, in order. */
  pages: number[];
}

const PDF_EXTENSION = /\.pdf$/i;

export function normalizePdfPath(raw: string): string {
  const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..') || /[:\x00-\x1f]/.test(path)) {
    throw new Error('Use a relative source path without empty folders, .. or control characters.');
  }
  if (!PDF_EXTENSION.test(path)) throw new Error('PDF import accepts .pdf files.');
  return path;
}

/**
 * The import commit boundary only accepts a `markdown:` collection/path identity
 * (see the OneNote route). The .pdf extension stays in the path, so a PDF never
 * shares an identity with a Markdown or HTML file of the same name.
 */
export function pdfSourceIdentity(collection: string, path: string): string {
  const name = collection.trim();
  if (!name || name.length > 80) throw new Error('Choose a collection name of 1–80 characters.');
  const identity = `markdown:${encodeURIComponent(name)}/${normalizePdfPath(path).split('/').map(encodeURIComponent).join('/')}`;
  if (identity.length > 2048) throw new Error('The source path is too long.');
  return identity;
}

export function pdfPathSubjects(fileSubjects: readonly string[], rawPath: string): { subjects: string; folderWarning: string | null } {
  let folders: string[] = [];
  try {
    folders = normalizePdfPath(rawPath).split('/').slice(0, -1);
  } catch {
    folders = [];
  }
  return folderSubjects(fileSubjects, folders, 'No course or topic folder was in the source path. Add Course/Topic/File.pdf before saving if you want those subjects.');
}

function infoTitle(bytes: Uint8Array | null): string | null {
  if (!bytes || !bytes.length) return null;
  let text: string;
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  } else {
    text = String.fromCharCode(...bytes.subarray(0, 400));
  }
  const clean = text.replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean && clean.length <= 200 ? clean : null;
}

function pageRanges(pages: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j += 1;
    parts.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Splits text longer than one chunk on line boundaries. */
function splitPage(heading: string, lines: string[]): string[] {
  const max = LIMITS.body - heading.length - 2;
  const bodies: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const raw of lines) {
    const line = raw.length > max ? raw.slice(0, max) : raw;
    if (size + line.length + 1 > max && current.length) {
      bodies.push(`${heading}\n${current.join('\n')}`);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) bodies.push(`${heading}\n${current.join('\n')}`);
  return bodies;
}

export async function parsePdf(input: { path: string; bytes: Uint8Array }): Promise<PdfNote> {
  const path = normalizePdfPath(input.path);
  if (input.bytes.byteLength > MAX_PDF_BYTES) throw new Error(`Each PDF must be at most ${MAX_PDF_BYTES / 1024 / 1024} MiB.`);
  const doc = await PdfDocument.load(input.bytes, new Budget(MAX_PDF_EXPANDED_BYTES));
  const pages = doc.pages();
  const warnings = new Set<string>([PDF_WARNING]);
  const bodies: string[] = [];
  const bodyPages: number[] = [];
  const empty: number[] = [];
  let unknown = 0;
  const filters = new Set<string>();

  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    const page = pages[index];
    const text = await extractPageText(doc, page.dict.entries.get('Contents'), page.resources);
    unknown += text.unknownGlyphs;
    text.unsupportedFilters.forEach((filter) => filters.add(filter));
    const heading = `## Page ${pageNumber}`;
    if (!text.lines.length) {
      empty.push(pageNumber);
      // Keep the page in the note so nothing disappears silently.
      bodies.push(`${heading}\nNo selectable text on this page. It may be handwriting, a drawing or an image; OCR is not supported.`);
      bodyPages.push(pageNumber);
      continue;
    }
    for (const body of splitPage(heading, text.lines)) {
      bodies.push(body);
      bodyPages.push(pageNumber);
    }
  }

  if (empty.length === pages.length) {
    throw new Error('This PDF has no selectable text. It may be scanned or handwritten; OCR is not supported.');
  }
  if (bodies.length > LIMITS.bodiesPerOp) {
    throw new Error(`This PDF needs more than ${LIMITS.bodiesPerOp} chunks. Split it and import the parts.`);
  }
  if (empty.length) {
    warnings.add(`${empty.length === 1 ? 'Page' : 'Pages'} ${pageRanges(empty)} had no selectable text and ${empty.length === 1 ? 'is' : 'are'} kept as a placeholder. Handwriting and images are not recognized.`);
  }
  if (unknown) warnings.add(`${unknown} characters use a font without a text map and were left out. Check the preview against the PDF.`);
  if (filters.size) warnings.add(`Some page content uses unsupported compression (${[...filters].join(', ')}) and was left out.`);

  const title = infoTitle(stringBytes(doc.resolve(doc.info()?.entries.get('Title'))))
    ?? (path.split('/').pop() ?? path).replace(PDF_EXTENSION, '');
  return { path, title: title.slice(0, 200), bodies, subjects: [], warnings: [...warnings], exportFormat: 'pdf', pages: bodyPages,
    metadata: { headings: [], properties: [], tags: [], wikilinks: [], skippedAttachments: [] } };
}

export { MAX_PAGES };
