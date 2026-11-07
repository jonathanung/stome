import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { formatUuidV4 } from '../src/harness/ids.ts';

test('a version-4 id sets the version and variant bits without calling crypto', () => {
  const zeros = new Uint8Array(16);
  assert.equal(formatUuidV4(zeros), '00000000-0000-4000-8000-000000000000');
  assert.equal(zeros[6], 0);
  const filled = new Uint8Array(16).fill(0xff);
  assert.equal(formatUuidV4(filled), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.equal(filled[8], 0xff);
  assert.throws(() => formatUuidV4(new Uint8Array(15)), /Could not create an id/);
});

test('Ask, confirm, and replay do not need browser crypto.randomUUID', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const runTurn = readFileSync(new URL('../src/harness/runTurn.ts', import.meta.url), 'utf8');
  const ids = readFileSync(new URL('../src/harness/ids.ts', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  assert.equal(/\.randomUUID\s*\(/.test(runTurn), false);
  assert.equal(/\.randomUUID\s*\(/.test(ids), false);
  assert.match(layout, /installHarnessRandomBytes\(\(size\) => getRandomBytes\(size\)\)/);

  const child = spawn(
    process.execPath,
    [
      '--experimental-sqlite',
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--import',
      './scripts/register-harness.mjs',
      'tests/support/ask-without-random-uuid.ts',
    ],
    { cwd: root },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve) => {
    child.once('exit', resolve);
  });
  assert.equal(stderr, '', stderr);
  assert.match(stdout, /ask-without-random-uuid ok/);
  assert.equal(code, 0);
});
