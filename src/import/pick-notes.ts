import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { MAX_IMPORT_BYTES, parseMarkdown, type ParsedNote } from './markdown';

export interface PickedNote extends ParsedNote {
  fingerprint: string;
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
      if (!/\.md$/i.test(asset.name)) throw new Error('Only UTF-8 .md files are supported.');
      if (asset.size !== undefined && asset.size > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
      let text: string;
      if (Platform.OS === 'web') {
        if (!asset.file) throw new Error('The browser did not provide a readable file. Try selecting it again.');
        if (asset.file.size > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
        text = await asset.file.text();
      } else {
        const file = new File(asset.uri);
        if (!file.exists || file.size > MAX_IMPORT_BYTES) throw new Error('The file is missing or exceeds 1 MiB.');
        text = await file.text();
      }
      const note = parseMarkdown({ path: asset.name, text });
      const fingerprint = await digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
      notes.push({ ...note, fingerprint });
    } catch (error) {
      errors.push(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { notes, errors };
}
