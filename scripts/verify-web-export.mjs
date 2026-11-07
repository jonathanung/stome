/**
 * Confirms `expo export --platform web` wrote a Metro browser bundle and the
 * expo-sqlite wa-sqlite asset. This is not an iOS or Android native compile.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const failures = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

let files = [];
try {
  files = walk(root);
} catch (error) {
  console.error(`web export missing directory ${root}: ${error.message}`);
  process.exit(1);
}

const htmlPath = path.join(root, 'index.html');
let html = '';
try {
  html = readFileSync(htmlPath, 'utf8');
} catch {
  failures.push('index.html is missing');
}
if (html && html.trim().length === 0) failures.push('index.html is empty');

const scriptSrcs = html ? [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]) : [];
if (html && scriptSrcs.length === 0) failures.push('index.html has no script src');

let bundleCount = 0;
for (const src of scriptSrcs) {
  const local = src.replace(/^\//, '');
  const full = path.join(root, local);
  try {
    const size = statSync(full).size;
    if (!full.endsWith('.js')) failures.push(`${local} is not a JavaScript bundle`);
    else if (size === 0) failures.push(`${local} is empty`);
    else bundleCount += 1;
  } catch {
    failures.push(`index.html references missing ${local}`);
  }
}

const wasmFiles = files.filter((file) => rel(file).includes('/wa-sqlite/') && file.endsWith('.wasm'));
if (wasmFiles.length === 0) failures.push('no wa-sqlite .wasm asset');

const referenced = [];
for (const wasm of wasmFiles) {
  const size = statSync(wasm).size;
  const bytes = readFileSync(wasm).subarray(0, 4);
  const magic = bytes.length === 4 && bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
  if (size === 0 || !magic) {
    failures.push(`${rel(wasm)} is not a non-empty WebAssembly file`);
    continue;
  }
  const url = `/${rel(wasm)}`;
  const hit = files.some((file) => file.endsWith('.js') && readFileSync(file, 'utf8').includes(url));
  if (!hit) failures.push(`${url} is not referenced by a JavaScript bundle`);
  else referenced.push(`${url} (${size} bytes)`);
}

if (failures.length > 0) {
  console.error(`web export check failed:\n${failures.map((item) => `- ${item}`).join('\n')}`);
  process.exit(1);
}

console.log(`web export ok: index.html loads ${bundleCount} bundle(s); ${referenced.join(', ')}`);
