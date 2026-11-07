/**
 * OneNote file-export parsers for issue #25, using the #28 HTML / MHTML / DOCX
 * routes. They produce the reviewed note shape the existing import pipeline saves.
 *
 * Not supported: native .one, Microsoft Graph sign-in, PDF, OCR or ink, fetching
 * remote images or pages, running scripts, and authentic OneNote certification.
 * Tests use synthetic format fixtures.
 *
 * Source identity keeps the existing `markdown:` prefix because the import
 * commit boundary only accepts that shape. The reviewed path keeps the export
 * extension, so these notes do not share an identity with a .md file.
 */

import type { ParsedNote } from '../markdown.ts';
import { paragraphsFromDocumentXml, readDocxPackage } from './docx.ts';
import { htmlToSections } from './html.ts';
import { extractMhtmlHtml } from './mhtml.ts';
import {
  UNSUPPORTED_WARNING,
  exportFormatFor,
  filenameTitle,
  normalizeOnenotePath,
  onenotePathSubjects,
  onenoteSourceIdentity,
  packSections,
} from './shared.ts';

export { onenotePathSubjects, onenoteSourceIdentity, UNSUPPORTED_WARNING };

export interface OneNoteNote extends ParsedNote {
  exportFormat: 'onenote-html' | 'onenote-mhtml' | 'onenote-docx';
}

/** OneNote exports carry headings but no Markdown properties, tags or wikilinks. */
function emptyMetadata(sections: string[][]): ParsedNote['metadata'] {
  const headings = sections.flat()
    .map((line) => /^(#{1,6})\s+(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ level: match[1].length, text: match[2].trim() }));
  return { headings, properties: [], tags: [], wikilinks: [], skippedAttachments: [] };
}

function finish(rawPath: string, format: OneNoteNote['exportFormat'], title: string | null, sections: string[][], warnings: Set<string>): OneNoteNote {
  const path = normalizeOnenotePath(rawPath);
  const visible = sections.filter((section) => section.some((line) => line.trim()));
  const pageTitle = (title ?? '').replace(/\s+/g, ' ').trim() || (visible.length ? filenameTitle(path) : '');
  if (!pageTitle && !visible.length) throw new Error('This note is empty.');
  const alreadyTitled = visible.some((section) => section.some((line) => line.replace(/^#{1,6}\s+/, '').trim().toLowerCase() === pageTitle.toLowerCase()));
  if (!alreadyTitled) visible.unshift([`# ${pageTitle}`]);
  warnings.add(UNSUPPORTED_WARNING);
  return { path, title: pageTitle, bodies: packSections(visible, warnings), subjects: [], warnings: [...warnings], exportFormat: format, metadata: emptyMetadata(visible) };
}

export function parseOneNoteText(input: { path: string; text: string }): OneNoteNote {
  const format = exportFormatFor(input.path);
  if (format === 'onenote-docx') throw new Error('DOCX exports must be read as bytes.');
  const extracted = format === 'onenote-mhtml' ? extractMhtmlHtml(input.text) : null;
  const page = htmlToSections(extracted ? extracted.html : input.text);
  if (extracted && extracted.skippedParts > 0) page.warnings.add(`Embedded files in this MHTML export were not imported (${extracted.skippedParts} non-HTML parts).`);
  return finish(input.path, format, page.title, page.sections, page.warnings);
}

export async function parseOneNoteBytes(input: { path: string; bytes: Uint8Array }): Promise<OneNoteNote> {
  const format = exportFormatFor(input.path);
  if (format !== 'onenote-docx') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
    return parseOneNoteText({ path: input.path, text });
  }
  const pkg = await readDocxPackage(input.bytes);
  const warnings = new Set<string>();
  const sections: string[][] = [[]];
  let title: string | null = null;
  const current = () => sections[sections.length - 1];
  for (const paragraph of paragraphsFromDocumentXml(pkg.documentXml)) {
    if (paragraph.media) warnings.add('Images, drawings, audio, and video were left out. Their files were not fetched or copied.');
    if (!paragraph.text) continue;
    if (paragraph.level) {
      if (!title) title = paragraph.text;
      if (current().length) sections.push([]);
      current().push(`${'#'.repeat(paragraph.level)} ${paragraph.text}`);
      continue;
    }
    current().push(paragraph.text);
  }
  if (pkg.hasMedia) warnings.add('Images, drawings, audio, and video were left out. Their files were not fetched or copied.');
  if (pkg.hasMacros) warnings.add('Word macros were not imported or run.');
  warnings.add('Headers, footers, comments, and notes outside word/document.xml were not imported.');
  return finish(input.path, format, title, sections, warnings);
}
