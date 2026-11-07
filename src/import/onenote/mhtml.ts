import { MAX_IMPORT_BYTES, assertTextBudget } from './shared.ts';

const MAX_PARTS = 40;
const MAX_HEADER_CHARS = 64 * 1024;
const MAX_DEPTH = 2;

export interface MhtmlPage {
  html: string;
  skippedParts: number;
}

function splitEntity(raw: string): { headers: string; body: string } {
  const source = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const breakAt = source.indexOf('\n\n');
  if (breakAt < 0) throw new Error('This MHTML export is missing its message headers.');
  if (breakAt > MAX_HEADER_CHARS) throw new Error('This MHTML export has headers that are too large.');
  return { headers: source.slice(0, breakAt), body: source.slice(breakAt + 2) };
}

function headerValue(headers: string, name: string): string {
  const unfolded = headers.replace(/\n[ \t]+/g, ' ');
  const match = new RegExp(`^${name}:[ \\t]*(.*)$`, 'im').exec(unfolded);
  return match?.[1]?.trim() ?? '';
}

function boundaryOf(contentType: string): string | null {
  const match = /boundary\s*=\s*(?:"([^"]{1,200})"|([^;\s"]{1,200}))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2] ?? '';
  if (!boundary || /[\r\n]/.test(boundary)) return null;
  return boundary;
}

function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return (match?.[1] ?? 'utf-8').toLowerCase();
}

function decodeQuotedPrintable(input: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '=') {
      const next = input[i + 1];
      if (next === '\n') {
        i += 1;
        continue;
      }
      if (next === '\r') {
        i += input[i + 2] === '\n' ? 2 : 1;
        continue;
      }
      const hex = input.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(char.charCodeAt(0));
        continue;
      }
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else if (char !== '\r') {
      const code = char.charCodeAt(0);
      if (code > 255) throw new Error('This MHTML quoted-printable part is not single-byte text.');
      bytes.push(code);
    }
    if (bytes.length > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
  }
  return Uint8Array.from(bytes);
}

function decodeBase64(input: string): Uint8Array {
  const cleaned = input.replace(/\s+/g, '');
  if (cleaned.length > MAX_IMPORT_BYTES * 2) throw new Error('Each note must be at most 1 MiB.');
  if (cleaned.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(cleaned)) throw new Error('This MHTML part is not valid base64.');
  const binary = atob(cleaned);
  if (binary.length > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeText(bytes: Uint8Array, charset: string): string {
  const label = charset === 'unicode' || charset === 'utf-16' ? 'utf-16' : charset;
  if (!['utf-8', 'us-ascii', 'ascii', 'utf-16', 'utf-16le', 'windows-1252', 'iso-8859-1'].includes(label)) {
    throw new Error(`This MHTML HTML part uses an unsupported character set (${charset}).`);
  }
  const text = new TextDecoder(label, { fatal: label === 'utf-8' }).decode(bytes);
  assertTextBudget(text);
  return text;
}

function transferBytes(body: string, encoding: string): Uint8Array {
  const normalized = encoding.toLowerCase();
  if (!normalized || normalized === '7bit' || normalized === '8bit' || normalized === 'binary') {
    if (body.length > MAX_IMPORT_BYTES) throw new Error('Each note must be at most 1 MiB.');
    const bytes = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) {
      const code = body.charCodeAt(i);
      if (code > 255) throw new Error('This MHTML part is not single-byte text.');
      bytes[i] = code;
    }
    return bytes;
  }
  if (normalized === 'quoted-printable') return decodeQuotedPrintable(body);
  if (normalized === 'base64') return decodeBase64(body);
  throw new Error(`This MHTML part uses an unsupported transfer encoding (${encoding}).`);
}

function partsOf(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  const parts: string[] = [];
  let current: string[] | null = null;
  let markers = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (trimmed === marker || trimmed === `${marker}--`) {
      markers++;
      if (markers > MAX_PARTS + 1) throw new Error('This MHTML export has too many parts to import safely.');
      if (current) parts.push(current.join('\n'));
      current = trimmed.endsWith('--') ? null : [];
      if (!current) break;
      continue;
    }
    if (current) current.push(line);
  }
  if (current) parts.push(current.join('\n'));
  return parts;
}

function htmlFrom(raw: string, depth: number, state: { parts: number; skipped: number }): string | null {
  if (depth > MAX_DEPTH) throw new Error('This MHTML export is nested too deeply to import safely.');
  const { headers, body } = splitEntity(raw);
  const contentType = headerValue(headers, 'content-type');
  const lower = contentType.toLowerCase();
  if (lower.includes('multipart/')) {
    const boundary = boundaryOf(contentType);
    if (!boundary) throw new Error('This MHTML export is missing a MIME boundary.');
    let html: string | null = null;
    for (const part of partsOf(body, boundary)) {
      state.parts++;
      if (state.parts > MAX_PARTS) throw new Error('This MHTML export has too many parts to import safely.');
      const found = htmlFrom(part, depth + 1, state);
      if (found && !html) html = found;
      else if (!found) state.skipped++;
    }
    return html;
  }
  if (!lower.includes('text/html')) return null;
  const bytes = transferBytes(body, headerValue(headers, 'content-transfer-encoding'));
  return decodeText(bytes, charsetOf(contentType));
}

/** Read the first HTML body from an MHTML package. Other parts are counted and ignored. */
export function extractMhtmlHtml(raw: string): MhtmlPage {
  assertTextBudget(raw);
  const state = { parts: 0, skipped: 0 };
  const html = htmlFrom(raw, 0, state);
  if (!html?.trim()) throw new Error('This MHTML export has no HTML page to import.');
  return { html, skippedParts: state.skipped };
}
