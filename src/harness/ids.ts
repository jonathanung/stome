/**
 * Ids for harness sessions and confirmed writes.
 * Android Expo Go has no `globalThis.crypto`, so `crypto.randomUUID` throws
 * before Ask reaches the companion. Bytes come from Web Crypto when it is
 * present, from the native source the app installs (expo-crypto), or from
 * Node when the harness tests run without a browser. This file never calls
 * `randomUUID`.
 */

const ID_BYTES = 16;

type ByteSource = (size: number) => Uint8Array;

let nativeBytes: ByteSource | null = null;

/** The app installs expo-crypto here. Pass null to remove it. */
export function installHarnessRandomBytes(source: ByteSource | null): void {
  nativeBytes = source;
}

export function createHarnessId(): string {
  return formatUuidV4(randomIdBytes(ID_BYTES));
}

/** RFC 4122 version-4 id. Copies `source` before setting the version bits. */
export function formatUuidV4(source: Uint8Array): string {
  if (source.length < ID_BYTES) {
    throw new Error('Could not create an id on this device');
  }
  const bytes = new Uint8Array(source.subarray(0, ID_BYTES));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomIdBytes(size: number): Uint8Array {
  const web = webRandomBytes(size);
  if (web) return web;
  if (nativeBytes) return asBytes(nativeBytes(size), size);
  const node = nodeRandomBytes(size);
  if (node) return node;
  throw new Error('Could not create an id on this device');
}

function webRandomBytes(size: number): Uint8Array | null {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') return null;
  const bytes = new Uint8Array(size);
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

function asBytes(value: Uint8Array, size: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== size) {
    throw new Error('Could not create an id on this device');
  }
  return value;
}

type NodeProcess = {
  versions?: { node?: string };
  getBuiltinModule?: (name: string) => { randomFillSync?: (buffer: Uint8Array) => void };
};

function nodeRandomBytes(size: number): Uint8Array | null {
  const proc = (globalThis as { process?: NodeProcess }).process;
  if (!proc?.versions?.node || typeof proc.getBuiltinModule !== 'function') return null;
  try {
    const builtin = proc.getBuiltinModule('node:crypto');
    if (typeof builtin?.randomFillSync !== 'function') return null;
    const bytes = new Uint8Array(size);
    builtin.randomFillSync(bytes);
    return bytes;
  } catch {
    return null;
  }
}
