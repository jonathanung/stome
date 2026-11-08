import { Inflate } from 'fflate/browser';

const INPUT_CHUNK_BYTES = 256;
const ADLER_MODULUS = 65521;

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(start + 5552, bytes.length);
    for (let i = start; i < end; i++) { a += bytes[i]; b += a; }
    a %= ADLER_MODULUS;
    b %= ADLER_MODULUS;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** ZIP's CRC-32 checks the selected DOCX document after decompression. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zlibPayload(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 6 || (bytes[0] & 15) !== 8 || bytes[0] >>> 4 > 7 || ((bytes[0] << 8) | bytes[1]) % 31 !== 0) {
    throw new Error('This compressed stream has an invalid zlib header.');
  }
  if (bytes[1] & 0x20) throw new Error('Compressed streams needing a preset dictionary are not supported.');
  // Inflate stops at DEFLATE's final block. Keeping the trailer here permits
  // checking a PDF writer's bounded trailing whitespace without private APIs.
  return bytes.subarray(2);
}

function checkZlibChecksum(source: Uint8Array, output: Uint8Array): void {
  const expected = adler32(output);
  for (let end = source.length; end >= Math.max(6, source.length - 8); end--) {
    const checksum = new DataView(source.buffer, source.byteOffset + end - 4, 4).getUint32(0);
    if (checksum === expected) return;
    const last = source[end - 1];
    if (last !== 0 && last !== 9 && last !== 10 && last !== 12 && last !== 13 && last !== 32) break;
  }
  throw new Error('This compressed stream failed its zlib checksum.');
}

/**
 * Portable bounded DEFLATE, without Blob, browser streams, workers or Node APIs.
 * Small compressed pushes bound the decoder's temporary expansion; every output
 * callback is checked before keeping its bytes. Corrupt/truncated input throws,
 * so callers never receive a partial result as if it were a complete document.
 */
export function inflateBounded(bytes: Uint8Array, format: 'raw' | 'zlib', maxOutputBytes: number): Uint8Array {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) throw new Error('Invalid decompression limit.');
  const input = format === 'zlib' ? zlibPayload(bytes) : bytes;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Inflate((chunk) => {
    total += chunk.byteLength;
    if (total > maxOutputBytes) throw new Error('This compressed stream expands beyond the import size limit.');
    if (chunk.byteLength) chunks.push(new Uint8Array(chunk));
  });
  if (!input.length) stream.push(input, true);
  else for (let start = 0; start < input.length; start += INPUT_CHUNK_BYTES) {
    stream.push(input.subarray(start, start + INPUT_CHUNK_BYTES), start + INPUT_CHUNK_BYTES >= input.length);
  }
  const output = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { output.set(chunk, position); position += chunk.byteLength; }
  if (format === 'zlib') checkZlibChecksum(bytes, output);
  return output;
}
