/**
 * Freeform image import for issue #26, using the #28 route: a PNG or JPEG
 * board export becomes a reviewed reference note, not reconstructed board
 * objects. Freeform PDF exports go through the shared PDF reader instead.
 *
 * The picture is not stored and not read (no OCR); the note records the board
 * name, source path and image size so the original export can be found again.
 * Keeping the pixels as a visual reference needs the shared asset storage
 * planned in #28. Tests use synthetic images, not authentic Freeform exports.
 */

import type { ParsedNote } from '../markdown.ts';
import { folderSubjects } from '../onenote/shared.ts';

export const MAX_FREEFORM_IMAGE_BYTES = 8 * 1024 * 1024;

export const FREEFORM_IMAGE_WARNING =
  'This board was imported as a reference only. The picture is not stored, and its text, shapes and connectors are not read (no OCR). Keep the original export to see the board. This was not checked against an authentic Freeform export.';

export interface FreeformImageNote extends ParsedNote {
  exportFormat: 'freeform-image';
  image: { type: 'png' | 'jpeg'; width: number; height: number };
}

const IMAGE_EXTENSION = /\.(png|jpe?g)$/i;

export function isFreeformImagePath(path: string): boolean {
  return IMAGE_EXTENSION.test(path);
}

export function normalizeFreeformPath(raw: string): string {
  const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..') || /[:\x00-\x1f]/.test(path)) {
    throw new Error('Use a relative source path without empty folders, .. or control characters.');
  }
  if (!IMAGE_EXTENSION.test(path)) throw new Error('The source path must end in .png, .jpg or .jpeg.');
  return path;
}

export function freeformSourceIdentity(collection: string, path: string): string {
  const name = collection.trim();
  if (!name || name.length > 80) throw new Error('Choose a collection name of 1–80 characters.');
  // import.note only accepts the markdown: prefix; the image extension keeps the identity distinct.
  const identity = `markdown:${encodeURIComponent(name)}/${normalizeFreeformPath(path).split('/').map(encodeURIComponent).join('/')}`;
  if (identity.length > 2048) throw new Error('The source path is too long.');
  return identity;
}

export function freeformPathSubjects(fileSubjects: readonly string[], rawPath: string): { subjects: string; folderWarning: string | null } {
  let folders: string[] = [];
  try {
    folders = normalizeFreeformPath(rawPath).split('/').slice(0, -1);
  } catch {
    folders = [];
  }
  return folderSubjects(fileSubjects, folders, 'No course or topic folder was in the source path. Add Course/Topic/Board.png before saving if you want those subjects.');
}

/** Reads the pixel size from a PNG IHDR chunk or a JPEG start-of-frame marker. */
export function imageInfo(bytes: Uint8Array): FreeformImageNote['image'] {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 24 && png.every((byte, i) => bytes[i] === byte)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (!width || !height) throw new Error('This PNG has no image size.');
    return { type: 'png', width, height };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2) break;
      const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (startOfFrame && offset + 9 <= bytes.length) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        if (!width || !height) throw new Error('This JPEG has no image size.');
        return { type: 'jpeg', width, height };
      }
      offset += 2 + length;
    }
    throw new Error('This JPEG has no image size.');
  }
  throw new Error('This file is not a PNG or JPEG image.');
}

export function parseFreeformImage(input: { path: string; bytes: Uint8Array }): FreeformImageNote {
  const path = normalizeFreeformPath(input.path);
  if (input.bytes.byteLength > MAX_FREEFORM_IMAGE_BYTES) throw new Error('Each image must be at most 8 MiB.');
  const image = imageInfo(input.bytes);
  const title = (path.split('/').pop() ?? path).replace(IMAGE_EXTENSION, '').trim() || 'Freeform board';
  const body = [
    `# ${title}`,
    '',
    `Freeform board export: ${image.width} × ${image.height} ${image.type.toUpperCase()} image.`,
    `Source: ${path}`,
    '',
    'Only this reference was imported. Open the original export to see the board.',
  ].join('\n');
  return {
    path,
    title: title.slice(0, 200),
    bodies: [body],
    subjects: [],
    warnings: [FREEFORM_IMAGE_WARNING],
    exportFormat: 'freeform-image',
    image,
    metadata: { headings: [{ level: 1, text: title }], properties: [], tags: [], wikilinks: [], skippedAttachments: [] },
  };
}
