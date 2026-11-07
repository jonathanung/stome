import { dict, name, num, type PdfDict, type PdfValue } from './syntax.ts';

/** Total decompressed bytes one PDF may produce. Stops compression bombs. */
export class Budget {
  remaining: number;

  constructor(bytes: number) {
    this.remaining = bytes;
  }

  take(bytes: number): void {
    this.remaining -= bytes;
    if (this.remaining < 0) throw new Error('This PDF expands beyond the import size limit.');
  }
}

export class UnsupportedFilter extends Error {
  readonly filter: string;

  constructor(filter: string) {
    super(`PDF filter ${filter} is not supported.`);
    this.filter = filter;
  }
}

async function inflate(data: Uint8Array, budget: Budget): Promise<Uint8Array> {
  const Stream = globalThis.DecompressionStream;
  if (typeof Stream !== 'function') {
    throw new Error('PDF compression cannot be read on this device. Use the web app to import PDFs.');
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const reader = new Blob([copy]).stream().pipeThrough(new Stream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      budget.take(step.value.byteLength);
      total += step.value.byteLength;
      chunks.push(step.value);
    }
  } catch (error) {
    // Many PDF writers leave bytes after the end of the zlib stream. Keep what
    // decompressed cleanly; fail only when nothing did.
    if (error instanceof Error && /expands beyond/.test(error.message)) throw error;
    if (!total) throw new Error('A compressed PDF stream could not be read.');
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

function asciiHex(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let high = -1;
  for (const byte of data) {
    if (byte === 0x3e /* > */) break;
    const char = String.fromCharCode(byte);
    if (!/[0-9A-Fa-f]/.test(char)) continue;
    const value = parseInt(char, 16);
    if (high < 0) high = value;
    else {
      out.push(high * 16 + value);
      high = -1;
    }
  }
  if (high >= 0) out.push(high * 16);
  return Uint8Array.from(out);
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group: number[] = [];
  for (let i = 0; i < data.length; i += 1) {
    const byte = data[i];
    if (byte === 0x7e /* ~ */) break;
    if (byte === 0x7a /* z */ && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (byte < 0x21 || byte > 0x75) continue;
    group.push(byte - 33);
    if (group.length === 5) {
      let value = 0;
      for (const digit of group) value = value * 85 + digit;
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      group = [];
    }
  }
  if (group.length > 1) {
    const count = group.length - 1;
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    out.push(...bytes.slice(0, count));
  }
  return Uint8Array.from(out);
}

/** PNG row predictors (Predictor >= 10), used by object and cross-reference streams. */
function unpredict(data: Uint8Array, parms: PdfDict | null): Uint8Array {
  const predictor = num(parms?.entries.get('Predictor')) ?? 1;
  if (predictor < 10) {
    if (predictor === 2) throw new UnsupportedFilter('TIFF predictor');
    return data;
  }
  const colors = num(parms?.entries.get('Colors')) ?? 1;
  const bits = num(parms?.entries.get('BitsPerComponent')) ?? 8;
  const columns = num(parms?.entries.get('Columns')) ?? 1;
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowLength = Math.ceil((colors * bits * columns) / 8);
  if (rowLength <= 0 || rowLength > 1 << 20) throw new Error('A PDF stream has an unsafe row size.');
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let previous = new Uint8Array(rowLength);
  for (let row = 0; row < rows; row += 1) {
    const type = data[row * (rowLength + 1)];
    const line = data.subarray(row * (rowLength + 1) + 1, (row + 1) * (rowLength + 1));
    const current = new Uint8Array(rowLength);
    for (let i = 0; i < rowLength; i += 1) {
      const left = i >= bpp ? current[i - bpp] : 0;
      const up = previous[i];
      const upLeft = i >= bpp ? previous[i - bpp] : 0;
      let value = line[i];
      if (type === 1) value += left;
      else if (type === 2) value += up;
      else if (type === 3) value += Math.floor((left + up) / 2);
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      current[i] = value & 0xff;
    }
    out.set(current, row * rowLength);
    previous = current;
  }
  return out;
}

/** Applies a stream's /Filter chain. Image-only codecs are reported, not decoded. */
export async function decodeStream(streamDict: PdfDict, raw: Uint8Array, budget: Budget): Promise<Uint8Array> {
  const filterValue = streamDict.entries.get('Filter');
  const parmsValue = streamDict.entries.get('DecodeParms');
  const filters: string[] = Array.isArray(filterValue) ? filterValue.map((item) => name(item) ?? '') : name(filterValue) ? [name(filterValue)!] : [];
  const parms: (PdfDict | null)[] = Array.isArray(parmsValue) ? parmsValue.map((item: PdfValue) => dict(item)) : [dict(parmsValue)];
  let data = raw;
  for (let i = 0; i < filters.length; i += 1) {
    const filter = filters[i];
    if (filter === 'FlateDecode' || filter === 'Fl') {
      data = unpredict(await inflate(data, budget), parms[i] ?? null);
    } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      data = asciiHex(data);
    } else if (filter === 'ASCII85Decode' || filter === 'A85') {
      data = ascii85(data);
    } else {
      throw new UnsupportedFilter(filter || 'unknown');
    }
  }
  return data;
}
