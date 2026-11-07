import { LIMITS } from '../../data/operations.ts';
import { MAX_IMPORT_BYTES } from '../markdown.ts';

export { MAX_IMPORT_BYTES };

/** Shown before a person confirms the import. These exports are not certified OneNote samples. */
export const UNSUPPORTED_WARNING =
  'Images, ink, audio, video, attachments, and embedded files are not imported. Nothing is downloaded or executed. Native .one files and Microsoft sign-in are not supported. This parser was not checked against an authentic OneNote export.';

const EXPORT_EXTENSION = /\.(html?|mht|mhtml|docx)$/i;

export function normalizeOnenotePath(raw: string): string {
  const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..') || /[:\x00-\x1f]/.test(path)) {
    throw new Error('Use a relative source path without empty folders, .. or control characters.');
  }
  if (!EXPORT_EXTENSION.test(path)) throw new Error('OneNote file import accepts .html, .htm, .mht, .mhtml, and .docx exports.');
  return path;
}

export function filenameTitle(path: string): string {
  const base = normalizeOnenotePath(path).split('/').pop() ?? path;
  return base.replace(EXPORT_EXTENSION, '');
}

export function exportFormatFor(path: string): 'onenote-html' | 'onenote-mhtml' | 'onenote-docx' {
  const normalized = normalizeOnenotePath(path);
  if (/\.docx$/i.test(normalized)) return 'onenote-docx';
  if (/\.mht(ml)?$/i.test(normalized)) return 'onenote-mhtml';
  return 'onenote-html';
}

/**
 * The import commit boundary only accepts a `markdown:` collection/path identity.
 * The reviewed export extension stays in the path so an HTML or DOCX note does not
 * share an identity with a Markdown file of the same name.
 */
export function onenoteSourceIdentity(collection: string, path: string): string {
  const name = collection.trim();
  if (!name || name.length > 80) throw new Error('Choose a collection name of 1–80 characters.');
  const identity = `markdown:${encodeURIComponent(name)}/${normalizeOnenotePath(path).split('/').map(encodeURIComponent).join('/')}`;
  if (identity.length > 2048) throw new Error('The source path is too long.');
  return identity;
}

/**
 * Folder names in a reviewed source path become subject suggestions after the
 * file's own subjects. Shared by every file-export route (OneNote, PDF).
 */
export function folderSubjects(
  fileSubjects: readonly string[],
  folders: readonly string[],
  missingFolderWarning: string,
): { subjects: string; folderWarning: string | null } {
  const subjects: string[] = [];
  const seen = new Set<string>();
  let folderWarning: string | null = null;
  const push = (candidate: string, fromFolder: boolean) => {
    const subject = candidate.trim().replace(/\s+/g, ' ');
    const key = subject.toLowerCase();
    if (fromFolder && subject.includes(',')) {
      folderWarning = 'The folder contains a comma and was not suggested because subjects are comma-separated. Review the subjects.';
      return;
    }
    if (!subject || seen.has(key)) return;
    if (subject.length > LIMITS.subject || subjects.length >= LIMITS.subjects) {
      if (fromFolder) folderWarning = 'The folder suggestion exceeds the subject limits and was omitted. Review the subjects.';
      return;
    }
    seen.add(key);
    subjects.push(subject);
  };
  for (const subject of fileSubjects) push(subject, false);
  if (!folders.length) folderWarning ??= missingFolderWarning;
  for (const folder of folders) push(folder, true);
  return { subjects: subjects.join(', '), folderWarning };
}

export function onenotePathSubjects(fileSubjects: readonly string[], rawPath: string): { subjects: string; folderWarning: string | null } {
  let folders: string[] = [];
  try {
    folders = normalizeOnenotePath(rawPath).split('/').slice(0, -1);
  } catch {
    folders = [];
  }
  return folderSubjects(fileSubjects, folders, 'No notebook or section folder was in the source path. Add Notebook/Section/Page before saving if you want those subjects.');
}

export function packSections(sections: string[][], warnings: Set<string>): string[] {
  const bodies: string[] = [];
  for (const lines of sections) {
    let body = lines.map((line) => line.trim()).filter(Boolean).join('\n');
    if (!body.trim()) continue;
    while (body.length > LIMITS.body) {
      let end: number = LIMITS.body;
      const last = body.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      bodies.push(body.slice(0, end));
      body = body.slice(end);
      warnings.add('Long sections were split into smaller chunks.');
    }
    if (body.trim()) bodies.push(body);
  }
  if (!bodies.length) throw new Error('This note is empty.');
  if (bodies.length > LIMITS.bodiesPerOp) throw new Error(`This note exceeds ${LIMITS.bodiesPerOp} chunks. Split it into smaller files.`);
  return bodies;
}

export function assertTextBudget(text: string): void {
  if (text.includes('\0')) throw new Error('This file is not valid text.');
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode a bounded set of entities. Unknown names stay literal and nothing is fetched. */
export function decodeEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (token, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const digits = hex ? body.slice(2) : body.slice(1);
      if (!digits || digits.length > 6) return token;
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? token;
  });
}
