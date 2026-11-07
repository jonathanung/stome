import Constants from 'expo-constants';
import { CryptoDigestAlgorithm, digest, digestStringAsync } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import { File, FileMode } from 'expo-file-system';
import { Platform } from 'react-native';

import { documentPickerCopiesToCache, routeImportAsset, takeCappedBytes, type BoundedByteSource } from './import-bytes.ts';
import { MAX_IMPORT_BYTES, parseMarkdown, type ParsedNote } from './markdown.ts';
import { parseOneNoteBytes, parseOneNoteText } from './onenote/parse.ts';
import { MAX_PDF_BYTES, parsePdf } from './pdf/parse.ts';

export interface PickedNote extends ParsedNote {
  fingerprint: string;
  /** Present for every file read here. Markdown stays on the Markdown parser. */
  exportFormat?: 'markdown' | 'onenote-html' | 'onenote-mhtml' | 'onenote-docx' | 'pdf';
  /** PDF only: the page number of each body, in order. */
  pages?: number[];
}

type WebFile = {
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
};

const NOTE_TOO_BIG = 'Each note must be at most 1 MiB.';
const NOTE_MISSING = 'The file is missing or exceeds 1 MiB.';
const BROWSER_MISSING = 'The browser did not provide a readable file. Try selecting it again.';

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
  const expoGo = Constants.expoGoConfig != null;
  const result = await getDocumentAsync({
    type: '*/*',
    multiple: true,
    // Expo Go cannot read the host-cache copy. Keep the content URI there only.
    copyToCacheDirectory: documentPickerCopiesToCache(Platform.OS, expoGo),
    base64: false,
  });
  if (result.canceled) return null;
  const errors: string[] = [];
  const notes: PickedNote[] = [];
  if (result.assets.length > 20) errors.push('Only the first 20 files were read. Import the remaining files in another batch.');
  for (const asset of result.assets.slice(0, 20)) {
    try {
      const route = routeImportAsset(asset.name, asset.size);
      if (route.kind === 'reject') throw new Error(route.message);
      if (route.kind === 'pdf') {
        const bytes = ownedBytes(await readBoundedBytes(asset, MAX_PDF_BYTES));
        const note = await parsePdf({ path: asset.name, bytes });
        notes.push({ ...note, fingerprint: hexDigest(await digest(CryptoDigestAlgorithm.SHA256, bytes)) });
        continue;
      }
      if (route.kind === 'docx') {
        const bytes = ownedBytes(await readBoundedBytes(asset));
        const note = await parseOneNoteBytes({ path: asset.name, bytes });
        notes.push({ ...note, fingerprint: hexDigest(await digest(CryptoDigestAlgorithm.SHA256, bytes)) });
        continue;
      }
      const text = await readBoundedText(asset);
      if (route.kind === 'markdown') {
        const note = parseMarkdown({ path: asset.name, text });
        notes.push({ ...note, fingerprint: await digestStringAsync(CryptoDigestAlgorithm.SHA256, text), exportFormat: 'markdown' });
      } else {
        const note = parseOneNoteText({ path: asset.name, text });
        notes.push({ ...note, fingerprint: await digestStringAsync(CryptoDigestAlgorithm.SHA256, text) });
      }
    } catch (error) {
      errors.push(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { notes, errors };
}

async function readBoundedText(asset: { uri: string; file?: WebFile }): Promise<string> {
  const bytes = await readAtMost(asset, MAX_IMPORT_BYTES, NOTE_TOO_BIG, NOTE_MISSING);
  return new TextDecoder().decode(bytes);
}

async function readBoundedBytes(asset: { uri: string; file?: WebFile }, limit = MAX_IMPORT_BYTES): Promise<Uint8Array> {
  const mib = limit / 1024 / 1024;
  return readAtMost(asset, limit, `Each file must be at most ${mib} MiB.`, `The file is missing or exceeds ${mib} MiB.`);
}

async function readAtMost(asset: { uri: string; file?: WebFile }, limit: number, over: string, missing: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    if (!asset.file) throw new Error(BROWSER_MISSING);
    if (asset.file.size > limit) throw new Error(over);
    return takeCappedBytes(webSource(asset.file), limit, over);
  }
  const expoGo = Platform.OS === 'android' && Constants.expoGoConfig != null;
  if (!expoGo) {
    const file = new File(asset.uri);
    const size = file.size as number | null | undefined;
    if (!file.exists || (typeof size === 'number' && Number.isFinite(size) && size > limit)) throw new Error(missing);
  }
  let source: BoundedByteSource;
  try {
    source = openHandle(asset.uri);
  } catch (error) {
    if (expoGo) throw new Error(missing);
    throw error;
  }
  try {
    return await takeCappedBytes(source, limit, over);
  } catch (error) {
    if (error instanceof Error && error.message === over) throw error;
    if (expoGo) throw new Error(missing);
    throw error;
  }
}

function openHandle(uri: string): BoundedByteSource {
  const handle = new File(uri).open(FileMode.ReadOnly);
  let closed = false;
  return {
    read: (maxBytes) => handle.readBytes(maxBytes),
    close() {
      if (closed) return;
      closed = true;
      handle.close();
    },
  };
}

function webSource(file: WebFile): BoundedByteSource {
  let closed = false;
  return {
    async read(maxBytes: number) {
      if (closed) throw new Error('The browser file is already closed.');
      const bytes = new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error('The browser returned more bytes than requested.');
      return bytes;
    },
    close() {
      closed = true;
    },
  };
}
