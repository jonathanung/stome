import { MAX_IMPORT_BYTES, parseMarkdown, type ParsedNote } from './markdown.ts';

export interface PickedNote extends ParsedNote {
  fingerprint: string;
}

export interface PickedAsset {
  name: string;
  uri: string;
  size?: number;
  file?: { size: number; text(): Promise<string> };
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

export interface PickedNoteDependencies {
  platform: string;
  expoGo: boolean;
  pick(): Promise<PickerSelection>;
  stat(uri: string): { exists: boolean; size: number | null };
  read(uri: string): Promise<string>;
  fingerprint(text: string): Promise<string>;
}

/**
 * Android Expo Go copies a picked file into the host app cache, outside the
 * experience sandbox. Scoped file permissions then report `File.exists === false`
 * for a real file. The original `content://` URI stays readable. A picker size
 * within 1 MiB is enough to try that read; the parsed bytes are still limited.
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
      if (asset.size !== undefined && asset.size > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
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
    if (asset.file.size > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
    return asset.file.text();
  }
  if (deps.platform === 'android' && deps.expoGo) return readAndroidPickerText(deps, asset);
  const info = deps.stat(asset.uri);
  if (!info.exists || (typeof info.size === 'number' && info.size > MAX_IMPORT_BYTES)) {
    throw new Error('The file is missing or exceeds 1 MiB.');
  }
  return deps.read(asset.uri);
}

async function readAndroidPickerText(deps: PickedNoteDependencies, asset: PickedAsset): Promise<string> {
  const reportedKnown = typeof asset.size === 'number' && Number.isFinite(asset.size);
  if (!reportedKnown) {
    let info: { exists: boolean; size: number | null } | undefined;
    try {
      info = deps.stat(asset.uri);
    } catch {
      info = undefined;
    }
    if (info?.exists && typeof info.size === 'number' && info.size > MAX_IMPORT_BYTES) {
      throw new Error('The file is missing or exceeds 1 MiB.');
    }
  }
  try {
    return await deps.read(asset.uri);
  } catch {
    throw new Error('The file is missing or exceeds 1 MiB.');
  }
}
