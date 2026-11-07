import Constants from 'expo-constants';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { collectPickedNotes, documentPickerCopiesToCache, type PickedNote } from './picked-notes';

export type { PickedNote };

/** Native picker URIs are temporary; callers review a stable source path. */
export async function pickNotes(): Promise<{ notes: PickedNote[]; errors: string[] } | null> {
  const expoGo = Constants.expoGoConfig != null;
  return collectPickedNotes({
    platform: Platform.OS,
    expoGo,
    pick: () => getDocumentAsync({
      type: '*/*',
      multiple: true,
      // Expo Go cannot read the host-cache copy. Keep the content URI there only.
      copyToCacheDirectory: documentPickerCopiesToCache(Platform.OS, expoGo),
      base64: false,
    }),
    stat: (uri) => {
      const file = new File(uri);
      const size = file.size as number | null | undefined;
      return { exists: Boolean(file.exists), size: typeof size === 'number' && Number.isFinite(size) ? size : null };
    },
    read: async (uri) => new File(uri).text(),
    fingerprint: (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text),
  });
}
