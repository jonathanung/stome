/**
 * Real-browser smoke for the current Expo web app.
 *
 * Reuses the existing stack: `npm run web:sqlite`, `npm run companion`, and
 * puppeteer-core loaded from outside this repo (same idea as
 * scripts/browser-harness.mjs and design-theme/screenshot.mjs). It does not
 * add a dependency, change the lockfile, or join `npm run check`.
 *
 *   mkdir -p /tmp/stome-browser && cd /tmp/stome-browser && npm init -y && npm install puppeteer-core
 *   cd /path/to/stome && node scripts/browser-regression.mjs
 *
 * Chrome: CHROME_PATH or /usr/bin/google-chrome.
 * The command starts the mock companion and the document host, then stops them.
 * STOME_REGRESSION_NO_SPAWN=1 uses servers that are already up and requires
 * STOME_PAIRING_TOKEN. The token is typed into the page and is never written
 * to the report or left visible in screenshots.
 */
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = new URL('..', import.meta.url).pathname;
const puppeteerRoot = process.env.STOME_PUPPETEER_ROOT ?? '/tmp/stome-browser/package.json';
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const webPort = Number(process.env.STOME_WEB_PORT ?? 8081);
const ownedWebUrl = `http://127.0.0.1:${webPort}/`;
const webUrl = process.env.STOME_WEB_URL ?? ownedWebUrl;
const outDir = process.env.STOME_REGRESSION_OUT ?? '/opt/cursor/artifacts/browser-regression';
const spawnServers = process.env.STOME_REGRESSION_NO_SPAWN !== '1';
const pageUrl = spawnServers ? ownedWebUrl : webUrl;
const expoPort = Number(process.env.EXPO_INTERNAL_PORT ?? 8082);
const companionPort = Number(process.env.STOME_COMPANION_PORT ?? 8787);
const token = process.env.STOME_PAIRING_TOKEN ?? randomBytes(16).toString('hex');

if (!existsSync(puppeteerRoot)) {
  console.error(`puppeteer-core is not installed at ${puppeteerRoot}`);
  console.error('Install it outside this repo so package.json and the lockfile stay unchanged:');
  console.error('  mkdir -p /tmp/stome-browser && cd /tmp/stome-browser && npm init -y && npm install puppeteer-core');
  process.exit(1);
}
if (!existsSync(chromePath)) {
  console.error(`Chrome was not found at ${chromePath}`);
  process.exit(1);
}

const require = createRequire(puppeteerRoot);
const puppeteer = require('puppeteer-core');

const nonce = `bay${Date.now().toString(36)}`;
const roomName = `Smoke room ${nonce}`;
const note = `chlorophyll stores ${nonce}`;
const question = `Why keep ${nonce}`;
const failedPrompt = `This should fail ${nonce}`;
const timeoutPrompt = `This should time out ${nonce}`;
const cancelPrompt = `Stop edit ${nonce}`;
const editPrompt = `Clarify ${nonce}`;
const stalePrompt = `Replace again ${nonce}`;
const humanEdit = `later human edit ${nonce}`;

const children = [];
const serverLog = [];
const steps = [];
const pageErrors = [];
const consoleTail = [];

function redact(value) {
  return JSON.parse(JSON.stringify(value).split(token).join('[redacted]'));
}

function remember(line) {
  const clean = line.split(token).join('[redacted]').trim();
  if (!clean) return;
  serverLog.push(clean);
  if (serverLog.length > 80) serverLog.shift();
}

function sha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

let ownedBrowser = null;
let cleanupPromise = null;
let signalExitStarted = false;

function startProcess(label, args, ownedMarker, extraEnv = {}) {
  const child = spawn(args[0], args.slice(1), {
    cwd: repoRoot,
    env: { ...process.env, BROWSER: 'none', EXPO_NO_TELEMETRY: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.ownedMarker = ownedMarker;
  child.groupMarkers = ownedMarker === 'serve-web.mjs'
    ? ['serve-web.mjs', 'expo start', "npm exec expo", "'expo' start"]
    : [ownedMarker];
  child.spawnError = null;
  children.push(child);
  const take = (chunk) => {
    for (const line of chunk.toString().split('\n')) remember(`${label}: ${line}`);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('error', (error) => {
    child.spawnError = error;
    remember(`${label}: error ${error.message}`);
  });
  child.on('exit', (code, signal) => remember(`${label}: exit ${code ?? signal}`));
  return child;
}

function commandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`).toString().replaceAll('\0', ' ');
  } catch {
    return '';
  }
}

function cmdlineIncludes(pid, marker) {
  return commandLine(pid).includes(marker);
}

function processGroupMembers(pgid) {
  const members = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const commandEnd = stat.lastIndexOf(')');
      const fields = stat.slice(commandEnd + 2).split(' ');
      if (Number(fields[2]) === pgid) members.push(Number(entry));
    } catch {
      // The process exited while the directory was being read.
    }
  }
  return members;
}

function ownedCommand(pid, markers) {
  return markers.some((marker) => cmdlineIncludes(pid, marker));
}

function groupStillOwned(child) {
  if (!child?.pid) return false;
  const markers = child.groupMarkers ?? [child.ownedMarker];
  if (child.exitCode === null && !child.signalCode && cmdlineIncludes(child.pid, child.ownedMarker)) return true;
  return processGroupMembers(child.pid).some((pid) => ownedCommand(pid, markers));
}

function signalOwned(child, signal) {
  if (!child?.pid) return;
  const markers = child.groupMarkers ?? [child.ownedMarker];
  const leaderAlive = child.exitCode === null && !child.signalCode && cmdlineIncludes(child.pid, child.ownedMarker);
  if (leaderAlive) {
    try {
      process.kill(-child.pid, signal);
      console.error(`signaled group ${child.pid} ${signal}`);
      return;
    } catch (error) {
      console.error(`group signal ${child.pid} ${signal} failed: ${error instanceof Error ? error.message : String(error)}`);
      if (error?.code !== 'ESRCH') {
        try {
          if (cmdlineIncludes(child.pid, child.ownedMarker)) child.kill(signal);
        } catch {
          // The owned leader has already exited.
        }
      }
    }
  }
  for (const pid of processGroupMembers(child.pid)) {
    if (!ownedCommand(pid, markers)) continue;
    try {
      process.kill(pid, signal);
    } catch {
      // That group member has already exited.
    }
  }
}

async function stopChildren() {
  const started = Date.now();
  let signal = 'SIGTERM';
  let emptyPasses = 0;
  while (Date.now() - started < 6000) {
    const alive = children.some((child) => groupStillOwned(child));
    if (!alive) {
      emptyPasses += 1;
      if (emptyPasses >= 2) return;
    } else {
      emptyPasses = 0;
      if (Date.now() - started > 4000) signal = 'SIGKILL';
      for (const child of children) signalOwned(child, signal);
    }
    await delay(200);
  }
  for (const child of children) {
    if (groupStillOwned(child)) signalOwned(child, 'SIGKILL');
  }
}

async function cleanupOwned() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const browser = ownedBrowser;
    if (browser) {
      const chrome = typeof browser.process === 'function' ? browser.process() : null;
      await Promise.race([browser.close().catch(() => undefined), delay(4000)]);
      if (chrome && chrome.exitCode === null && !chrome.signalCode) killOwnedBrowser();
    }
    ownedBrowser = null;
    if (spawnServers) await stopChildren();
  })();
  return cleanupPromise;
}

function killOwnedBrowser() {
  const browser = ownedBrowser;
  const chrome = browser && typeof browser.process === 'function' ? browser.process() : null;
  if (!chrome?.pid) return;
  const command = commandLine(chrome.pid);
  const dataDir = /--user-data-dir=(\S+)/.exec(command)?.[1] ?? '';
  try {
    process.kill(-chrome.pid, 'SIGKILL');
  } catch {
    try {
      process.kill(chrome.pid, 'SIGKILL');
    } catch {
      // Chrome has already exited.
    }
  }
  if (!dataDir) return;
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    if (!commandLine(Number(entry)).includes(dataDir)) continue;
    try {
      process.kill(Number(entry), 'SIGKILL');
    } catch {
      // That Chrome process has already exited.
    }
  }
}

function installSignalHandlers() {
  const finish = (signal) => {
    if (signalExitStarted) return;
    signalExitStarted = true;
    const code = signal === 'SIGINT' ? 130 : 143;
    const stayAlive = setInterval(() => {}, 1000);
    console.error(`signal: ${signal}`);
    // Signal handlers can lose the event loop before an async cleanup finishes.
    // Kill the groups this process spawned before returning.
    killOwnedBrowser();
    for (const child of children) signalOwned(child, 'SIGKILL');
    cleanupOwned()
      .then(() => {
        console.error(`signal cleanup done: ${signal}`);
      })
      .catch((error) => {
        console.error(`signal cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        clearInterval(stayAlive);
        process.exit(code);
      });
  };
  process.on('SIGINT', () => finish('SIGINT'));
  process.on('SIGTERM', () => finish('SIGTERM'));
}

function portBusy(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (busy) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(busy);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function assertPortsFree(ports) {
  const busy = [];
  for (const port of ports) {
    if (await portBusy(port)) busy.push(port);
  }
  if (busy.length > 0) {
    throw new Error(
      `spawn mode refused occupied port ${busy.join(', ')}. This script does not kill unrelated listeners.`,
    );
  }
}

function requireChild(child, label) {
  if (child.spawnError) throw new Error(`${label} failed to start: ${child.spawnError.message}`);
  if (child.exitCode !== null || child.signalCode) {
    throw new Error(`${label} exited before it was ready (${child.exitCode ?? child.signalCode})`);
  }
}

function loopbackPort(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
  if (url.port === '') return url.protocol === 'https:' ? 443 : 80;
  const port = Number(url.port);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

function spawnNavigationOwned() {
  return loopbackPort(webUrl) === webPort;
}

function identity() {
  const checkoutSha = sha();
  let productHead = 'unknown';
  try {
    productHead = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    productHead = 'unknown';
  }
  let server;
  if (!spawnServers) {
    server = {
      mode: 'external',
      servedFromCheckout: false,
      servedSha: null,
      note: 'An external server was already running. checkoutSha is this working tree, not the code that server is serving.',
    };
  } else if (!spawnNavigationOwned()) {
    server = {
      mode: 'spawn',
      servedFromCheckout: false,
      servedSha: null,
      note: 'STOME_WEB_URL does not address the document host this command would spawn. This checkout was not served.',
    };
  } else {
    server = { mode: 'spawn', servedFromCheckout: true };
  }
  return { checkoutSha, productHead, server };
}

async function waitFor(label, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await delay(500);
  }
  throw new Error(`${label} was not ready`);
}

function step(name) {
  steps.push({ name, at: new Date().toISOString() });
  console.log(`step: ${name}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fill(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 20000 });
  const filled = await page.$eval(selector, (element, next) => {
    const prototype = Object.getPrototypeOf(element);
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return false;
    const previous = element.value;
    setter.call(element, next);
    const tracker = element._valueTracker;
    if (tracker) tracker.setValue(previous);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return element.value === next;
  }, value);
  assert(filled, `could not fill ${selector}`);
}

async function clickNamed(page, name) {
  const handle = await page.evaluateHandle((wanted) => {
    const nodes = [...document.querySelectorAll('[role="button"], button, a, [role="link"]')];
    return (
      nodes.find((element) => (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim() === wanted) ??
      null
    );
  }, name);
  const element = handle.asElement();
  assert(element, `missing button ${name}`);
  const disabled = await page.evaluate((node) => node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('disabled'), element);
  assert(!disabled, `button ${name} is disabled`);
  await element.click();
}

async function buttonDisabled(page, name) {
  return page.evaluate((wanted) => {
    const nodes = [...document.querySelectorAll('[role="button"], button, a, [role="link"]')];
    const match = nodes.find((element) => (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim() === wanted);
    if (!match) return 'missing';
    return match.getAttribute('aria-disabled') === 'true' || match.hasAttribute('disabled') ? 'disabled' : 'enabled';
  }, name);
}

/**
 * Visible page text. innerText leaves out form fields, and since #38 a saved
 * chunk is shown in its editor (a textarea labelled "Chunk N"), so the editors'
 * values are appended. Without them a negative check such as "the note does not
 * contain Mock edit" would not look at the chunk at all.
 */
async function bodyText(page) {
  return page.evaluate(() => {
    const editors = [...document.querySelectorAll('textarea[aria-label^="Chunk "]')].map((field) => field.value);
    return [document.body.innerText, ...editors].join('\n');
  });
}

async function leavesOutsideHarness(page) {
  return page.evaluate(() => {
    const blocked = ['[data-testid="harness-panel"]', '[data-testid="proposal-card"]']
      .map((selector) => document.querySelector(selector))
      .filter(Boolean);
    const leaves = [];
    for (const element of document.body.querySelectorAll('*')) {
      if (blocked.some((node) => node.contains(element))) continue;
      if (element.childElementCount !== 0) continue;
      const text = element.textContent ?? '';
      if (text.trim().length === 0) continue;
      leaves.push(text);
    }
    return leaves;
  });
}

function assertLeaf(leaves, expected, message) {
  assert(
    leaves.includes(expected),
    `${message}. Saved leaves did not include the complete text (${expected.length} characters).`,
  );
}

async function textOutsideProposal(page) {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelector('[data-testid="proposal-card"]')?.remove();
    clone.querySelector('[data-testid="harness-panel"]')?.remove();
    // Chunk editors are outside the proposal and harness; see bodyText.
    const editors = [...document.querySelectorAll('textarea[aria-label^="Chunk "]')].map((field) => field.value);
    return [clone.innerText ?? '', ...editors].join('\n');
  });
}

async function maskToken(page) {
  await page.evaluate(() => {
    const field = document.querySelector('[data-testid="pairing-token"]');
    if (!field || !(field.value ?? '')) return;
    window.__stomeShotToken = field.value;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
    setter?.call(field, '');
    field.style.setProperty('color', 'transparent', 'important');
    field.style.setProperty('-webkit-text-security', 'disc', 'important');
    field.style.setProperty('background', '#111111', 'important');
  });
}

async function unmaskToken(page) {
  await page.evaluate(() => {
    const field = document.querySelector('[data-testid="pairing-token"]');
    const hidden = window.__stomeShotToken;
    delete window.__stomeShotToken;
    if (!field || typeof hidden !== 'string') return;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
    setter?.call(field, hidden);
    field.style.removeProperty('color');
    field.style.removeProperty('-webkit-text-security');
    field.style.removeProperty('background');
  });
}

async function shot(page, name) {
  await maskToken(page);
  const path = `${outDir}/${name}.png`;
  try {
    await page.screenshot({ path, fullPage: true });
  } finally {
    await unmaskToken(page).catch(() => undefined);
  }
  if (readFileSync(path).includes(Buffer.from(token))) {
    unlinkSync(path);
    throw new Error(`screenshot ${name} contained the pairing token`);
  }
  return path;
}

async function openRoom(page) {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes('Study rooms'), { timeout: 60000 });
}

async function reloadSeen(page, needle) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    (expected) => {
      // innerText leaves out form fields; chunk text is in the #38 chunk editors.
      const editors = [...document.querySelectorAll('textarea[aria-label^="Chunk "]')].map((field) => field.value);
      return [document.body.innerText, ...editors].join('\n').includes(expected);
    },
    { timeout: 30000 },
    needle,
  );
}

async function includeChunk(page) {
  await page.waitForFunction(() => {
    for (const element of document.querySelectorAll('div')) {
      if (element.scrollHeight > element.clientHeight + 20) element.scrollTop = element.scrollHeight;
    }
    return Boolean(document.querySelector('[data-testid^="select-chunk-"]'));
  }, { timeout: 20000 });
  await page.click('[data-testid^="select-chunk-"]');
  await page.waitForFunction(
    () => (document.querySelector('[data-testid^="select-chunk-"]')?.textContent ?? '').includes('Included'),
    { timeout: 10000 },
  );
}

async function pasteToken(page) {
  await fill(page, '[data-testid="pairing-token"]', token);
}

async function ask(page, prompt, buttonText) {
  await fill(page, '[data-testid="ask-input"]', prompt);
  await page.waitForFunction((label) => {
    const button = document.querySelector('[data-testid="ask-button"]');
    return button && button.getAttribute('aria-disabled') !== 'true' && (button.textContent ?? '').includes(label);
  }, { timeout: 10000 }, buttonText);
  await page.click('[data-testid="ask-button"]');
}

async function advanceChunk(page) {
  return page.evaluate(async (marker, replacement) => {
    const starts = [];
    for (const element of [document.getElementById('root'), document.body]) {
      if (!element) continue;
      for (const key of Object.keys(element)) {
        if (key.startsWith('__reactContainer') || key.startsWith('__reactFiber')) starts.push(element[key]);
      }
    }
    const seen = new Set();
    const stack = [...starts];
    const databases = [];
    const keys = ['child', 'sibling', 'stateNode', 'memoizedProps', 'memoizedState', 'pendingProps', 'dependencies', 'firstContext', 'memoizedValue', 'next', 'current', 'value', 'queue', 'baseState'];
    while (stack.length && seen.size < 20000) {
      const node = stack.pop();
      if (!node || (typeof node !== 'object' && typeof node !== 'function')) continue;
      if (seen.has(node) || typeof node.nodeType === 'number') continue;
      seen.add(node);
      if (typeof node.runAsync === 'function' && typeof node.getAllAsync === 'function') {
        databases.push(node);
        continue;
      }
      for (const key of keys) {
        const value = node[key];
        if (value && typeof value === 'object') stack.push(value);
      }
    }
    const attempts = [];
    for (const database of databases) {
      try {
        const rows = await database.getAllAsync('SELECT revision, content FROM chunks WHERE content LIKE ?', [`%${marker}%`]);
        if (!rows?.length) {
          attempts.push({ rows: 0 });
          continue;
        }
        const before = rows.map((row) => row.revision);
        const written = await database.runAsync(
          'UPDATE chunks SET content = ?, revision = revision + 1, updated_at = ? WHERE content LIKE ?',
          [replacement, Date.now(), `%${marker}%`],
        );
        const after = await database.getAllAsync('SELECT revision, content FROM chunks WHERE content = ?', [replacement]);
        return {
          ok: written?.changes === 1 && after.length === 1 && after[0].content === replacement,
          changes: written?.changes ?? null,
          before,
          after: after.map((row) => row.revision),
          databases: databases.length,
        };
      } catch (error) {
        attempts.push({ error: error instanceof Error ? error.message : 'query failed' });
      }
    }
    return { ok: false, databases: databases.length, starts: starts.length, walked: seen.size, attempts };
  }, nonce, humanEdit);
}

async function storageProbe(page) {
  return page.evaluate(async (secret) => {
    const files = [];
    const root = await navigator.storage.getDirectory();
    async function walk(directory, prefix) {
      for await (const [name, handle] of directory.entries()) {
        const path = `${prefix}/${name}`;
        if (handle.kind === 'directory') await walk(handle, path);
        else {
          const file = await handle.getFile();
          files.push({ path, size: file.size });
        }
      }
    }
    await walk(root, 'opfs:');
    const values = [...Object.values(localStorage), ...Object.values(sessionStorage)];
    return {
      origin: location.origin,
      crossOriginIsolated,
      localKeys: Object.keys(localStorage),
      sessionKeys: Object.keys(sessionStorage),
      tokenStored: values.some((value) => String(value).includes(secret)),
      files,
    };
  }, token);
}

async function main() {
  installSignalHandlers();
  mkdirSync(outDir, { recursive: true });
  const runIdentity = identity();
  const screenshots = [];
  try {
  if (spawnServers) {
    if (!spawnNavigationOwned()) {
      const message = `spawn mode refused STOME_WEB_URL ${webUrl}. The browser would not open the document host this command spawns at 127.0.0.1:${webPort}.`;
      const failure = redact({ ok: false, ...runIdentity, message, steps, pageErrors });
      writeFileSync(`${outDir}/report.json`, JSON.stringify(failure, null, 2));
      throw new Error(message);
    }
    step('start mock companion and expo web');
    await assertPortsFree([webPort, expoPort, companionPort]);
    const companionChild = startProcess(
      'companion',
      ['node', '--experimental-strip-types', '--import', './scripts/register-harness.mjs', 'companion/server.ts'],
      'companion/server.ts',
      {
        STOME_APP_ORIGIN: new URL(pageUrl).origin,
        STOME_PAIRING_TOKEN: token,
        STOME_PROVIDER: 'mock',
        STOME_COMPANION_PORT: String(companionPort),
      },
    );
    const webChild = startProcess('web', ['node', 'scripts/serve-web.mjs'], 'serve-web.mjs', {
      STOME_WEB_PORT: String(webPort),
      EXPO_INTERNAL_PORT: String(expoPort),
    });
    await waitFor('companion', async () => {
      requireChild(companionChild, 'companion');
      return serverLog.some((line) => line.startsWith('companion:') && line.includes(`listening on http://127.0.0.1:${companionPort}`));
    }, 30000);
    await waitFor('expo web', async () => {
      requireChild(webChild, 'expo web');
      if (!serverLog.some((line) => line.includes(`Document host http://127.0.0.1:${webPort}`))) return false;
      try {
        const response = await fetch(`http://127.0.0.1:${webPort}/`);
        const text = await response.text();
        requireChild(webChild, 'expo web');
        return (
          response.status === 200 &&
          response.headers.get('cross-origin-opener-policy') === 'same-origin' &&
          response.headers.get('cross-origin-embedder-policy') === 'credentialless' &&
          (text.includes('id="root"') || text.includes('expo-reset') || text.includes('/_expo/'))
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes('exited before')) throw error;
        return false;
      }
    }, 180000);
  }

  ownedBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const browser = ownedBrowser;
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20000);
  page.on('console', (message) => {
    const line = `${message.type()}: ${message.text()}`.split(token).join('[redacted]');
    consoleTail.push(line);
    if (consoleTail.length > 40) consoleTail.shift();
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error.message ?? error).split(token).join('[redacted]'));
  });
  page.on('requestfailed', (request) => {
    consoleTail.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`.split(token).join('[redacted]'));
  });

  try {
    step('open study rooms');
    await openRoom(page);
    const isolated = await page.evaluate(() => ({ origin: location.origin, crossOriginIsolated }));
    assert(isolated.crossOriginIsolated, `crossOriginIsolated is false at ${isolated.origin}`);
    const documentHeaders = await page.evaluate(async () => {
      const response = await fetch(location.href, { cache: 'no-store' });
      return {
        coop: response.headers.get('cross-origin-opener-policy'),
        coep: response.headers.get('cross-origin-embedder-policy'),
      };
    });
    assert(documentHeaders.coop === 'same-origin', `document COOP is ${documentHeaders.coop}`);
    assert(documentHeaders.coep === 'credentialless', `document COEP is ${documentHeaders.coep}`);
    assert(!(await bodyText(page)).includes('Could not open'), 'the local database did not open');

    step('create stays disabled until a room has a name');
    assert((await buttonDisabled(page, 'Create')) === 'disabled', 'Create was enabled with an empty name');

    step('create a room and a note');
    await fill(page, '[aria-label="New room name"]', roomName);
    await page.waitForFunction(() => {
      const match = [...document.querySelectorAll('[role="button"]')].find((element) => (element.textContent || '').trim() === 'Create');
      return match && match.getAttribute('aria-disabled') !== 'true';
    }, { timeout: 10000 });
    await clickNamed(page, 'Create');
    await page.waitForFunction(() => /\/rooms\/[^/]+$/.test(location.pathname), { timeout: 20000 });
    const roomPath = new URL(page.url()).pathname;
    assert(roomPath.startsWith('/rooms/'), `create did not open a room (${roomPath})`);
    await page.waitForSelector('[aria-label="Note content"]');
    await fill(page, '[aria-label="Note content"]', note);
    await clickNamed(page, 'Add note');
    await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 15000 }, note);
    assert(!(await bodyText(page)).includes('No notes in this room yet.'), 'the new note did not replace the empty state');

    step('reload keeps the room and the note');
    await reloadSeen(page, note);
    let visible = await bodyText(page);
    assert(visible.includes(roomName) && visible.includes(note), 'the room or note disappeared after reload');
    assert(!visible.includes('This room was not found.'), 'reload lost the room');
    screenshots.push(await shot(page, 'room-note-reloaded'));

    step('the room list keeps the room after reload');
    await clickNamed(page, '← All rooms');
    await page.waitForFunction(() => document.body.innerText.includes('Study rooms'), { timeout: 20000 });
    await reloadSeen(page, roomName);
    visible = await bodyText(page);
    assert(visible.includes(roomName) && !visible.includes('No rooms yet.'), 'the room list did not keep the room');
    screenshots.push(await shot(page, 'room-list-reloaded'));

    step('Today stays empty when the new note has no review mark');
    await page.click('[data-testid="open-today"]');
    await page.waitForSelector('[data-testid="today-empty"]', { timeout: 20000 });
    visible = await bodyText(page);
    assert(visible.includes('Nothing due today'), 'Today did not show the empty state');
    assert(!visible.includes(note), 'the new note appeared on Today without a review mark');
    assert((await page.$$('[data-testid^="today-item-"]')).length === 0, 'Today listed a due item');
    await page.click('[data-testid="today-refresh"]');
    await page.waitForSelector('[data-testid="today-empty"]', { timeout: 10000 });
    await reloadSeen(page, 'Nothing due today');
    visible = await bodyText(page);
    assert(visible.includes('Today') && visible.includes('Nothing due today') && !visible.includes(note), 'Today did not stay empty after reload');
    assert((await page.$$('[data-testid^="today-item-"]')).length === 0, 'reload put the note on Today');
    screenshots.push(await shot(page, 'today-empty-reloaded'));
    await clickNamed(page, 'Open a room');
    await page.waitForFunction((expected) => document.body.innerText.includes('Study rooms') && document.body.innerText.includes(expected), { timeout: 20000 }, roomName);

    await clickNamed(page, `Open ${roomName}`);
    await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 20000 }, note);

    step('ask without a token does not change the note');
    await includeChunk(page);
    await ask(page, question, 'Ask');
    await page.waitForSelector('[data-testid="harness-error"]', { timeout: 10000 });
    visible = await bodyText(page);
    assert(visible.includes('Paste the pairing token'), 'an empty token did not explain itself');
    assert(visible.includes(note) && !visible.includes('Mock answer ('), 'asking without a token wrote an answer');

    step('pin a mock answer and reload it');
    await pasteToken(page);
    await ask(page, question, 'Ask');
    await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });
    const proposal = await page.$eval('[data-testid="proposal-body"]', (element) => element.textContent ?? '');
    assert(proposal.includes('Mock answer (') && proposal.includes(question), 'the proposal was not the mock answer');
    assert(!proposal.includes(token), 'the proposal contained the pairing token');
    const savedBeforePin = await textOutsideProposal(page);
    assert(savedBeforePin.includes(note) && !savedBeforePin.includes('Mock answer ('), 'the answer was saved before confirm');
    await page.click('[data-testid="confirm-button"]');
    await page.waitForFunction((expected) => {
      if (document.querySelector('[data-testid="proposal-card"]')) return false;
      const text = document.body.innerText;
      return text.includes('AI answer:') && text.includes('Mock answer (') && text.includes(expected);
    }, { timeout: 15000 }, question);
    screenshots.push(await shot(page, 'answer-pinned'));
    await reloadSeen(page, note);
    visible = await bodyText(page);
    assert(visible.includes('AI answer:') && visible.includes(question) && visible.includes(note), 'the pinned answer did not survive reload');
    const tokenValue = await page.$eval('[data-testid="pairing-token"]', (element) => element.value ?? '');
    assert(!tokenValue.includes(token), 'the pairing token was still in the field after reload');
    const stored = await storageProbe(page);
    assert(stored.tokenStored === false, 'the pairing token was written to browser storage');
    assert(stored.files.some((file) => file.path.includes('expo-sqlite') && file.size > 0), 'Expo SQLite did not persist a database file');
    screenshots.push(await shot(page, 'answer-reloaded'));

    step('timeout and provider error leave the note alone');
    await includeChunk(page);
    await pasteToken(page);
    await page.click('[data-testid="scenario-timeout"]');
    await ask(page, timeoutPrompt, 'Ask');
    await page.waitForFunction(() => (document.querySelector('[data-testid="harness-error"]')?.textContent ?? '').includes('timed out'), { timeout: 15000 });
    visible = await bodyText(page);
    assert(visible.includes(note) && visible.includes(question) && !visible.includes(timeoutPrompt), 'a timeout changed the saved note or answer');
    await page.click('[data-testid="scenario-error"]');
    await ask(page, failedPrompt, 'Ask');
    await page.waitForFunction(() => (document.querySelector('[data-testid="harness-error"]')?.textContent ?? '').includes('failed before answering'), { timeout: 15000 });
    visible = await bodyText(page);
    assert(visible.includes(note) && visible.includes(question) && !visible.includes(failedPrompt), 'a provider error changed the saved note or answer');
    screenshots.push(await shot(page, 'ask-errors'));

    step('cancelling a proposed edit does not overwrite the note');
    await page.click('[data-testid="purpose-edit"]');
    await page.click('[data-testid="scenario-cancel"]');
    await ask(page, cancelPrompt, 'Propose edit');
    await page.waitForFunction(() => document.body.innerText.includes('Session: running'), { timeout: 10000 });
    await page.click('[data-testid="cancel-button"]');
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Session: cancelled') && text.includes('You cancelled this question.');
    }, { timeout: 10000 });
    visible = await bodyText(page);
    assert(visible.includes(note) && visible.includes(question) && !visible.includes('Mock edit ('), 'cancel wrote a note edit');
    assert(!visible.includes(cancelPrompt), 'cancel saved the edit prompt');
    assert((await page.$('[data-testid="proposal-card"]')) === null, 'cancel left a proposal on screen');
    screenshots.push(await shot(page, 'edit-cancelled'));

    step('confirming an edit refreshes the note and survives reload');
    await page.click('[data-testid="scenario-success"]');
    await ask(page, editPrompt, 'Propose edit');
    await page.waitForSelector('[data-testid="proposal-after"]', { timeout: 20000 });
    const before = await page.$eval('[data-testid="proposal-before"]', (element) => element.textContent ?? '');
    const after = await page.$eval('[data-testid="proposal-after"]', (element) => element.textContent ?? '');
    assert(before.includes(note), 'the proposal lost the current note');
    assert(after.includes('Mock edit (') && after.includes(editPrompt) && after.includes(note), 'the proposed edit was not the mock edit');
    const duringProposal = await leavesOutsideHarness(page);
    assertLeaf(duringProposal, before, 'the saved chunk was not the complete proposal before text');
    assert(!duringProposal.includes(after), 'the saved chunk already equalled the complete proposal after text');
    screenshots.push(await shot(page, 'edit-proposed'));
    await page.click('[data-testid="confirm-button"]');
    await page.waitForFunction((expected) => {
      const blocked = ['[data-testid="harness-panel"]', '[data-testid="proposal-card"]']
        .map((selector) => document.querySelector(selector))
        .filter(Boolean);
      return [...document.body.querySelectorAll('*')].some((element) => {
        if (blocked.some((node) => node.contains(element))) return false;
        return element.childElementCount === 0 && (element.textContent ?? '') === expected;
      });
    }, { timeout: 15000 }, after);
    assertLeaf(await leavesOutsideHarness(page), after, 'confirm did not put the complete edit on the saved chunk');
    screenshots.push(await shot(page, 'edit-confirmed'));
    await reloadSeen(page, editPrompt);
    assertLeaf(await leavesOutsideHarness(page), after, 'reload did not keep the complete edit on the saved chunk');
    visible = await bodyText(page);
    assert(visible.includes(question) && !visible.includes('This room was not found.'), 'reload lost the pinned answer or the room');
    const tokenAfterEdit = await page.$eval('[data-testid="pairing-token"]', (element) => element.value ?? '');
    assert(!tokenAfterEdit.includes(token), 'the pairing token returned after the edit reload');
    screenshots.push(await shot(page, 'edit-reloaded'));

    step('a stale edit proposal is rejected and does not overwrite');
    await includeChunk(page);
    await pasteToken(page);
    await page.click('[data-testid="purpose-edit"]');
    await page.click('[data-testid="scenario-success"]');
    await ask(page, stalePrompt, 'Propose edit');
    await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });
    const bumped = await advanceChunk(page);
    assert(bumped.ok, `could not apply a later chunk write through the open database: ${JSON.stringify(redact(bumped))}`);
    await page.click('[data-testid="confirm-button"]');
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="harness-error"]')?.textContent ?? '').includes('The chunk changed after the proposal'),
      { timeout: 15000 },
    );
    screenshots.push(await shot(page, 'stale-rejected'));
    await reloadSeen(page, humanEdit);
    const restored = await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 15000 });
    assert(restored, 'reload did not restore the stale proposal');
    const persisted = await leavesOutsideHarness(page);
    assertLeaf(persisted, humanEdit, 'reload did not keep the later chunk text');
    assert(
      !persisted.some((text) => text.includes(stalePrompt) || text.includes('Mock edit (')),
      'the saved chunk contained the rejected proposal after reload',
    );
    await page.click('[data-testid="confirm-button"]');
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="harness-error"]')?.textContent ?? '').includes('The chunk changed after the proposal'),
      { timeout: 15000 },
    );
    const still = await leavesOutsideHarness(page);
    assertLeaf(still, humanEdit, 'confirming the restored proposal changed the later chunk text');
    assert(
      !still.some((text) => text.includes(stalePrompt) || text.includes('Mock edit (')),
      'the stale refusal wrote the proposal onto the saved chunk',
    );
    screenshots.push(await shot(page, 'stale-reloaded'));
    assert(pageErrors.length === 0, `unexpected page error: ${pageErrors.join(' | ')}`);

    const report = redact({
      ok: true,
      ...runIdentity,
      url: pageUrl,
      origin: isolated.origin,
      crossOriginIsolated: isolated.crossOriginIsolated,
      documentHeaders,
      roomPath,
      storage: { ...stored, tokenStored: stored.tokenStored },
      staleSetup: 'direct SQL UPDATE on the open Expo SQLite connection; not a human edit and not a human flow',
      staleBump: bumped,
      screenshots,
      steps,
      pageErrors,
      consoleTail,
      commands: [
        'node --experimental-strip-types --import ./scripts/register-harness.mjs companion/server.ts',
        'node scripts/serve-web.mjs',
        'node scripts/browser-regression.mjs',
      ],
    });
    const serialized = JSON.stringify(report, null, 2);
    assert(!serialized.includes(token), 'the report contained the pairing token');
    writeFileSync(`${outDir}/report.json`, serialized);
    console.log(serialized);
  } catch (error) {
    const failure = redact({
      ok: false,
      ...runIdentity,
      message: error instanceof Error ? error.message : String(error),
      steps,
      pageErrors,
      consoleTail,
      serverLog,
    });
    try {
      screenshots.push(await shot(page, 'failure'));
      failure.screenshots = screenshots;
    } catch {
      // The page may already be gone.
    }
    const serialized = JSON.stringify(failure, null, 2).split(token).join('[redacted]');
    writeFileSync(`${outDir}/report.json`, serialized);
    console.error(serialized);
    throw error;
  }
  } finally {
    await cleanupOwned();
  }
}

main().catch((error) => {
  if (signalExitStarted) return;
  console.error(error instanceof Error ? error.message.split(token).join('[redacted]') : 'browser regression failed');
  process.exit(1);
});
