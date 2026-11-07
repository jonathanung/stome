import { MAX_IMPORT_BYTES, parseMarkdown, type ParsedNote } from './markdown.ts';

const TOO_BIG = 'Each note must be at most 1 MiB.';
const MISSING = 'The file is missing or exceeds 1 MiB.';

export interface PickedNote extends ParsedNote {
  fingerprint: string;
}

/** A readable slice. `arrayBuffer()` must not contain more than the requested end. */
export interface BrowserFile {
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface PickedAsset {
  name: string;
  uri: string;
  size?: number;
  file?: BrowserFile;
}

export interface PickerSelection {
  canceled: boolean;
  assets: PickedAsset[] | null;
}

/**
 * Expo Go denies reads of the document-picker host cache. Other Android builds,
 * iOS, and web can read that copy, so only Expo Go keeps the original content URI.
 */
export function documentPickerCopiesToCache(platform: string, expoGo: boolean): boolean {
  return !(platform === 'android' && expoGo);
}

/**
 * Reads at most the requested byte count, then `close()` releases the descriptor.
 * Callers ask for one more than the import limit and stop. They do not use the
 * provider's reported size as the read length.
 */
export interface BoundedByteSource {
  read(maxBytes: number): Promise<Uint8Array>;
  close(): void;
}

export interface PickedNoteDependencies {
  platform: string;
  expoGo: boolean;
  pick(): Promise<PickerSelection>;
  stat(uri: string): { exists: boolean; size: number | null };
  open(uri: string): BoundedByteSource;
  fingerprint(text: string): Promise<string>;
}

/**
 * Android Expo Go cannot trust `File.exists` on the host cache copy. It reads the
 * content URI through a file handle capped at 1 MiB + 1 byte. A small or missing
 * picker size does not widen that read. Bytes over the limit are rejected before
 * they are decoded.
 */
export async function collectPickedNotes(deps: PickedNoteDependencies): Promise<{ notes: PickedNote[]; errors: string[] } | null> {
  const result = await deps.pick();
  if (result.canceled) return null;
  const errors: string[] = [];
  const notes: PickedNote[] = [];
  const assets = result.assets ?? [];
  if (assets.length > 20) errors.push('Only the first 20 files were read. Import the remaining files in another batch.');
  for (const asset of assets.slice(0, 20)) {
    try {
      if (!/\.md$/i.test(asset.name)) throw new Error('Only UTF-8 .md files are supported.');
      if (asset.size !== undefined && asset.size > MAX_IMPORT_BYTES) throw new Error(TOO_BIG);
      const text = await readAssetText(deps, asset);
      const note = parseMarkdown({ path: asset.name, text });
      notes.push({ ...note, fingerprint: await deps.fingerprint(text) });
    } catch (error) {
      errors.push(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { notes, errors };
}

async function readAssetText(deps: PickedNoteDependencies, asset: PickedAsset): Promise<string> {
  if (deps.platform === 'web') {
    if (!asset.file) throw new Error('The browser did not provide a readable file. Try selecting it again.');
    if (asset.file.size > MAX_IMPORT_BYTES) throw new Error(TOO_BIG);
    return readCappedText(browserSource(asset.file));
  }
  if (!(deps.platform === 'android' && deps.expoGo)) {
    const info = deps.stat(asset.uri);
    if (!info.exists || (typeof info.size === 'number' && info.size > MAX_IMPORT_BYTES)) throw new Error(MISSING);
  }
  try {
    return await readCappedText(deps.open(asset.uri));
  } catch (error) {
    if (error instanceof Error && error.message === TOO_BIG) throw error;
    if (deps.platform === 'android' && deps.expoGo) throw new Error(MISSING);
    throw error;
  }
}

async function readCappedText(source: BoundedByteSource): Promise<string> {
  try {
    const read = await source.read(MAX_IMPORT_BYTES + 1);
    if (read.byteLength > MAX_IMPORT_BYTES) throw new Error(TOO_BIG);
    return new TextDecoder().decode(Uint8Array.from(read));
  } finally {
    source.close();
  }
}

function browserSource(file: BrowserFile): BoundedByteSource {
  let closed = false;
  return {
    async read(maxBytes: number) {
      if (closed) throw new Error('The browser file is already closed.');
      const bytes = new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error(TOO_BIG);
      return bytes;
    },
    close() {
      closed = true;
    },
  };
}
