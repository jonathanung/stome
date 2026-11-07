import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const wasmUrl = '/assets/node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.test.wasm';

function exportTree(indexHtml: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'web-export-'));
  const jsPath = path.join(dir, '_expo/static/js/web/app.js');
  const wasmPath = path.join(dir, wasmUrl.slice(1));
  mkdirSync(path.dirname(jsPath), { recursive: true });
  mkdirSync(path.dirname(wasmPath), { recursive: true });
  writeFileSync(jsPath, `bundle ${wasmUrl}\n`);
  writeFileSync(wasmPath, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01]));
  writeFileSync(path.join(dir, 'index.html'), indexHtml);
  return dir;
}

function verify(dir: string) {
  return spawnSync(process.execPath, ['scripts/verify-web-export.mjs', dir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('a zero-byte index.html fails even when the bundle and wasm are present', () => {
  const dir = exportTree('');
  try {
    const result = verify(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /index\.html is empty/);
    assert.match(result.stderr, /index\.html has no script src/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a whitespace-only index.html fails the same way', () => {
  const dir = exportTree(' \n\t ');
  try {
    const result = verify(dir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /index\.html is empty/);
    assert.match(result.stderr, /index\.html has no script src/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an index that loads the referenced wasm bundle passes', () => {
  const dir = exportTree('<script src="/_expo/static/js/web/app.js" defer></script>\n');
  try {
    const result = verify(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /web export ok: index.html loads 1 bundle/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
