import { CryptoDigestAlgorithm, digest, digestStringAsync } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { MAX_FREEFORM_IMAGE_BYTES, isFreeformImagePath, parseFreeformImage } from './freeform/parse';
import { MAX_IMPORT_BYTES, parseMarkdown, type ParsedNote } from './markdown';
import { parseOneNoteBytes, parseOneNoteText } from './onenote/parse';
import { MAX_PDF_BYTES, parsePdf } from './pdf/parse';

export interface PickedNote extends ParsedNote {
  fingerprint: string;
  /** Present for every file read here. Markdown stays on the Markdown parser. */
  exportFormat?: 'markdown' | 'onenote-html' | 'onenote-mhtml' | 'onenote-docx' | 'pdf' | 'freeform-image';
  /** PDF only: the page number of each body, in order. */
  pages?: number[];
}

const TEXT_EXPORT = /\.(md|html?|mht|mhtml)$/i;

function hexDigest(buffer: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/** Native picker URIs are temporary; callers review a stable source path. */
export async function pickNotes(): Promise<{ notes: PickedNote[]; errors: string[] } | null> {
  const result = await getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true, base64: false });
  if (result.canceled) return null;
  const errors: string[] = [];
  const notes: PickedNote[] = [];
  if (result.assets.length > 20) errors.push('Only the first 20 files were read. Import the remaining files in another batch.');
  for (const asset of result.assets.slice(0, 20)) {
    try {
      if (/\.pdf$/i.test(asset.name)) {
        if (asset.size !== undefined && asset.size > MAX_PDF_BYTES) throw new Error('Each PDF must be at most 8 MiB.');
        const bytes = ownedBytes(await readBoundedBytes(asset, MAX_PDF_BYTES));
        const note = await parsePdf({ path: asset.name, bytes });
        notes.push({ ...note, fingerprint: hexDigest(await digest(CryptoDigestAlgorithm.SHA256, bytes)) });
        continue;
      }
      if (isFreeformImagePath(asset.name)) {
        if (asset.size !== undefined && asset.size > MAX_FREEFORM_IMAGE_BYTES) throw new Error('Each image must be at most 8 MiB.');
        const bytes = ownedBytes(await readBoundedBytes(asset, MAX_FREEFORM_IMAGE_BYTES));
        const note = parseFreeformImage({ path: asset.name, bytes });
        notes.push({ ...note, fingerprint: hexDigest(await digest(CryptoDigestAlgorithm.SHA256, bytes)) });
        continue;
      }
      if (asset.size !== undefined && asset.size > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
      const docx = /\.docx$/i.test(asset.name);
      if (!docx && !TEXT_EXPORT.test(asset.name)) throw new Error('Only UTF-8 Markdown, OneNote HTML, MHTML and DOCX exports, PDF files, and PNG or JPEG board images are supported.');
      if (docx) {
        const bytes = ownedBytes(await readBoundedBytes(asset));
        const note = await parseOneNoteBytes({ path: asset.name, bytes });
        notes.push({ ...note, fingerprint: hexDigest(await digest(CryptoDigestAlgorithm.SHA256, bytes)) });
      } else {
        const text = await readBoundedText(asset);
        if (/\.md$/i.test(asset.name)) {
          const note = parseMarkdown({ path: asset.name, text });
          notes.push({ ...note, fingerprint: await digestStringAsync(CryptoDigestAlgorithm.SHA256, text), exportFormat: 'markdown' });
        } else {
          const note = parseOneNoteText({ path: asset.name, text });
          notes.push({ ...note, fingerprint: await digestStringAsync(CryptoDigestAlgorithm.SHA256, text) });
        }
      }
    } catch (error) {
      errors.push(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { notes, errors };
}

async function readBoundedText(asset: { uri: string; file?: { size: number; text(): Promise<string> } }): Promise<string> {
  if (Platform.OS === 'web') {
    if (!asset.file) throw new Error('The browser did not provide a readable file. Try selecting it again.');
    if (asset.file.size > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
    return asset.file.text();
  }
  const file = new File(asset.uri);
  if (!file.exists || file.size > MAX_IMPORT_BYTES) throw new Error('The file is missing or exceeds 1 MiB.');
  return file.text();
}

async function readBoundedBytes(
  asset: { uri: string; file?: { size: number; arrayBuffer(): Promise<ArrayBuffer> } },
  limit = MAX_IMPORT_BYTES,
): Promise<Uint8Array> {
  const mib = limit / 1024 / 1024;
  const tooLarge = `Each file must be at most ${mib} MiB.`;
  if (Platform.OS === 'web') {
    if (!asset.file) throw new Error('The browser did not provide a readable file. Try selecting it again.');
    if (asset.file.size > limit) throw new Error(tooLarge);
    const bytes = new Uint8Array(await asset.file.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error(tooLarge);
    return bytes;
  }
  const file = new File(asset.uri);
  if (!file.exists || file.size > limit) throw new Error(`The file is missing or exceeds ${mib} MiB.`);
  const bytes = await file.bytes();
  if (bytes.byteLength > limit) throw new Error(tooLarge);
  return bytes;
}
