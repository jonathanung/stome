import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync, deflateSync } from 'node:zlib';

import { crc32, inflateBounded } from '../src/import/inflate.ts';

test('zlib and raw DEFLATE work without browser or Node compression APIs', () => {
  const previousStream = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  const previousBlob = Object.getOwnPropertyDescriptor(globalThis, 'Blob');
  Reflect.deleteProperty(globalThis, 'DecompressionStream');
  Reflect.deleteProperty(globalThis, 'Blob');
  try {
    const plain = new TextEncoder().encode('Compressed notes survive on mobile. '.repeat(500));
    for (const [format, compressed] of [['raw', deflateRawSync(plain)], ['zlib', deflateSync(plain)]] as const) {
      const bytes = new Uint8Array(compressed); // ordinary typed array, not Buffer
      assert.deepEqual(inflateBounded(bytes, format, plain.length), plain);
    }
  } finally {
    if (previousStream) Object.defineProperty(globalThis, 'DecompressionStream', previousStream);
    if (previousBlob) Object.defineProperty(globalThis, 'Blob', previousBlob);
  }
});

test('actual expansion limits stop both raw and zlib streams, including very small limits', () => {
  const plain = Buffer.alloc(2 * 1024 * 1024, 0x61);
  for (const [format, compressed] of [['raw', deflateRawSync(plain)], ['zlib', deflateSync(plain)]] as const) {
    assert.throws(() => inflateBounded(new Uint8Array(compressed), format, 10_000), /expands beyond/);
    assert.throws(() => inflateBounded(new Uint8Array(compressed), format, 0), /expands beyond/);
  }
});

test('corrupt or truncated streams never return partial content', () => {
  const plain = Buffer.from('Visible content that must not become a partial success. '.repeat(300));
  const raw = new Uint8Array(deflateRawSync(plain));
  assert.throws(() => inflateBounded(raw.subarray(0, raw.length - 3), 'raw', plain.length));
  assert.throws(() => inflateBounded(Uint8Array.from([255, 255, 255]), 'raw', plain.length));
  const zlib = new Uint8Array(deflateSync(plain));
  const corrupt = new Uint8Array(zlib);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => inflateBounded(corrupt, 'zlib', plain.length), /checksum/);
  assert.throws(() => inflateBounded(zlib.subarray(0, zlib.length - 3), 'zlib', plain.length));
});

test('valid zlib checksums permit only bounded trailing PDF whitespace', () => {
  const plain = Buffer.from('PDF text');
  const zlib = new Uint8Array(deflateSync(plain));
  assert.deepEqual(inflateBounded(Uint8Array.from([...zlib, 13, 10, 32]), 'zlib', 100), new Uint8Array(plain));
  assert.throws(() => inflateBounded(Uint8Array.from([...zlib, 65]), 'zlib', 100), /checksum/);
  assert.throws(() => inflateBounded(Uint8Array.from([...zlib, ...new Array(9).fill(32)]), 'zlib', 100), /checksum/);
});

test('CRC32 uses the standard ZIP checksum and empty streams remain valid', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  assert.deepEqual(inflateBounded(new Uint8Array(deflateRawSync(new Uint8Array())), 'raw', 0), new Uint8Array());
  assert.deepEqual(inflateBounded(new Uint8Array(deflateSync(new Uint8Array())), 'zlib', 0), new Uint8Array());
});
