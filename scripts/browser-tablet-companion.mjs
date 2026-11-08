/**
 * Tablet-origin browser check for the laptop companion.
 *
 * Chrome emulates an iPad viewport and user agent. It is not WebKit and not a
 * physical iPad. The page origin is https://192.168.88.8:<port>/, mapped to
 * 127.0.0.1, which is the web:lan address shape an iPad would open.
 *
 *   mkdir -p /tmp/stome-browser && cd /tmp/stome-browser && npm init -y && npm install puppeteer-core
 *   node scripts/browser-tablet-companion.mjs
 *
 * The pairing token is never printed. Screenshots hide token fields.
 */
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = new URL('..', import.meta.url).pathname;
const puppeteerRoot = process.env.STOME_PUPPETEER_ROOT ?? '/tmp/stome-browser/package.json';
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const webPort = Number(process.env.STOME_WEB_PORT ?? 8091);
const expoPort = Number(process.env.EXPO_INTERNAL_PORT ?? 8092);
const companionPort = Number(process.env.STOME_COMPANION_PORT ?? 8791);
const tabletHost = '192.168.88.8';
const origin = `https://${tabletHost}:${webPort}`;
const pageUrl = `${origin}/`;
const outDir = process.env.STOME_TABLET_OUT ?? '/opt/cursor/artifacts/ipad-companion';
const token = randomBytes(16).toString('hex');

if (!existsSync(puppeteerRoot)) {
  console.error(`puppeteer-core is not installed at ${puppeteerRoot}`);
  process.exit(1);
}
if (!existsSync(chromePath)) {
  console.error(`Chrome was not found at ${chromePath}`);
  process.exit(1);
}

const require = createRequire(puppeteerRoot);
const puppeteer = require('puppeteer-core');
const children = [];
const serverLog = [];
const steps = [];
const pageErrors = [];

function redact(value) {
  return String(value).split(token).join('[redacted]');
}

function remember(line) {
  const clean = redact(line).trim();
  if (!clean) return;
  serverLog.push(clean);
  if (serverLog.length > 80) serverLog.shift();
}

function step(name) {
  steps.push(name);
  console.log(`step: ${name}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startProcess(label, args, extraEnv) {
  const child = spawn(args[0], args.slice(1), {
    cwd: repoRoot,
    env: { ...process.env, BROWSER: 'none', EXPO_NO_TELEMETRY: '1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.push(child);
  const take = (chunk) => {
    for (const line of chunk.toString().split('\n')) remember(`${label}: ${line}`);
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('exit', (code, signal) => remember(`${label}: exit ${code ?? signal}`));
  return child;
}

function stopChildren() {
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function httpsStatus(port) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ hostname: '127.0.0.1', port, path: '/', rejectUnauthorized: false, method: 'GET' }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitFor(label, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await delay(400);
  }
  throw new Error(`${label} was not ready`);
}

async function fill(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 20000 });
  const filled = await page.$eval(selector, (element, next) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
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
    return nodes.find((element) => (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim() === wanted) ?? null;
  }, name);
  const element = handle.asElement();
  assert(element, `missing button ${name}`);
  await element.click();
}

async function bodyText(page) {
  return page.evaluate(() => {
    const editors = [...document.querySelectorAll('textarea')].map((field) => field.value);
    return [document.body.innerText, ...editors].join('\n');
  });
}

async function maskTokens(page) {
  await page.evaluate(() => {
    for (const field of document.querySelectorAll('[data-testid="pairing-token"], [data-testid="companion-token"]')) {
      if (!(field instanceof HTMLInputElement)) continue;
      field.dataset.shot = field.value;
      field.value = '';
      field.style.setProperty('color', 'transparent', 'important');
      field.style.setProperty('background', '#111111', 'important');
    }
  });
}

async function unmaskTokens(page) {
  await page.evaluate(() => {
    for (const field of document.querySelectorAll('[data-testid="pairing-token"], [data-testid="companion-token"]')) {
      if (!(field instanceof HTMLInputElement) || field.dataset.shot === undefined) continue;
      field.value = field.dataset.shot;
      delete field.dataset.shot;
      field.style.removeProperty('color');
      field.style.removeProperty('background');
    }
  });
}

async function shot(page, name) {
  await maskTokens(page);
  const path = `${outDir}/${name}.png`;
  try {
    await page.screenshot({ path, fullPage: true });
  } finally {
    await unmaskTokens(page).catch(() => undefined);
  }
  if (readFileSync(path).includes(Buffer.from(token))) {
    throw new Error(`screenshot ${name} contained the pairing token`);
  }
  return path;
}

process.on('SIGINT', () => {
  stopChildren();
  process.exit(1);
});
process.on('SIGTERM', () => {
  stopChildren();
  process.exit(1);
});

const screenshots = [];
let browser;
try {
  mkdirSync(outDir, { recursive: true });
  if (await portOpen(webPort) || await portOpen(expoPort) || await portOpen(companionPort)) {
    throw new Error(`port ${webPort}, ${expoPort}, or ${companionPort} is already in use`);
  }
  step('start mock companion and web:lan');
  startProcess(
    'companion',
    ['node', '--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', './scripts/register-harness.mjs', 'companion/server.ts'],
    {
      STOME_PROVIDER: 'mock',
      STOME_PAIRING_TOKEN: token,
      STOME_COMPANION_PORT: String(companionPort),
      STOME_WEB_PORT: String(webPort),
    },
  );
  startProcess(
    'web',
    ['node', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/serve-web.mjs'],
    {
      STOME_WEB_LAN: '1',
      STOME_WEB_PORT: String(webPort),
      EXPO_INTERNAL_PORT: String(expoPort),
      STOME_COMPANION_PORT: String(companionPort),
    },
  );
  await waitFor('companion', async () => serverLog.some((line) => line.includes(`listening on http://127.0.0.1:${companionPort}`)), 30000);
  await waitFor('web:lan', async () => {
    if (!serverLog.some((line) => line.includes('LAN document host'))) return false;
    try {
      return (await httpsStatus(webPort)) === 200;
    } catch {
      return false;
    }
  }, 180000);

  step('open the https tablet origin in an iPad-sized Chrome page');
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    protocolTimeout: 180000,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--ignore-certificate-errors',
      `--host-resolver-rules=MAP ${tabletHost} 127.0.0.1`,
    ],
  });
  const page = await browser.newPage();
  await page.emulate(puppeteer.KnownDevices['iPad Pro 11']);
  const companionCalls = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/v1/')) companionCalls.push(`${request.method()} ${url.split('?')[0]}`);
  });
  page.on('pageerror', (error) => pageErrors.push(redact(error.message ?? error)));
  await page.goto(`${pageUrl}companion`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes('AI companion'), { timeout: 60000 });
  const context = await page.evaluate(() => ({
    origin: location.origin,
    secure: window.isSecureContext,
    isolated: window.crossOriginIsolated,
    userAgent: navigator.userAgent,
  }));
  assert(context.origin === origin, `page origin was ${context.origin}`);
  assert(context.secure === true, 'the tablet https origin was not a secure context');
  assert(/iPad/.test(context.userAgent), 'the emulated user agent was not an iPad');
  const setup = await page.$eval('[data-testid="companion-setup"]', (element) => element.innerText);
  assert(setup.includes('cannot run npm'), 'the page told the tablet to run npm');
  assert(setup.includes('npm run web:lan'), 'the page did not explain web:lan');
  assert(!/on the iPad, run npm/i.test(setup), 'the page said to run npm on the iPad');
  const address = await page.$eval('[data-testid="companion-address"]', (element) => element.value);
  assert(address === origin, `companion address defaulted to ${address}`);
  screenshots.push(await shot(page, '01-tablet-setup'));

  step('loopback companion address is refused before any request');
  const callsBefore = companionCalls.length;
  await fill(page, '[data-testid="companion-address"]', `http://127.0.0.1:${companionPort}`);
  await fill(page, '[data-testid="companion-token"]', token);
  await clickNamed(page, 'Test connection');
  await page.waitForFunction(() => (document.querySelector('[data-testid="companion-connection-message"]')?.textContent ?? '').includes('cannot run npm'), { timeout: 10000 });
  assert(companionCalls.length === callsBefore, `loopback address sent a companion request: ${companionCalls.slice(callsBefore).join(', ')}`);
  screenshots.push(await shot(page, '02-loopback-refused'));

  step('plain http on the tablet address is refused before any request');
  await fill(page, '[data-testid="companion-address"]', `http://${tabletHost}:${companionPort}`);
  await clickNamed(page, 'Test connection');
  await page.waitForFunction(() => (document.querySelector('[data-testid="companion-connection-message"]')?.textContent ?? '').includes('cannot call an http companion'), { timeout: 10000 });
  assert(companionCalls.length === callsBefore, 'an http companion address was contacted');

  step('a direct browser fetch to the companion http port does not return the mock');
  // Chrome on this laptop can open http://127.0.0.1 from an https page (loopback is not mixed content).
  // That socket is the laptop, not an iPad. The LAN http URL is mixed content. Neither call sends a token.
  const blocked = await page.evaluate(async (port, host) => {
    const urls = [`http://127.0.0.1:${port}/v1/status`, `http://${host}:${port}/v1/status`];
    const results = {};
    for (const url of urls) {
      try {
        const response = await fetch(url);
        results[url] = response.status;
      } catch (error) {
        results[url] = error instanceof Error ? error.name : 'failed';
      }
    }
    return results;
  }, companionPort, tabletHost);
  assert(blocked[`http://${tabletHost}:${companionPort}/v1/status`] !== 200, `LAN http companion returned ${JSON.stringify(blocked)}`);
  assert(blocked[`http://127.0.0.1:${companionPort}/v1/status`] !== 200, `loopback companion returned a tokenless success: ${JSON.stringify(blocked)}`);
  const afterProbe = companionCalls.length;

  step('wrong token is rejected and the real token is not echoed');
  await fill(page, '[data-testid="companion-address"]', origin);
  await fill(page, '[data-testid="companion-token"]', 'wrong-token-value');
  await page.$eval('[data-testid="companion-address"]', (element) => element.scrollIntoView({ block: 'center' }));
  await clickNamed(page, 'Test connection');
  try {
    await page.waitForFunction(() => (document.querySelector('[data-testid="companion-connection-message"]')?.textContent ?? '').includes('does not match'), { timeout: 10000 });
  } catch (error) {
    const detail = await page.evaluate(() => ({
      address: document.querySelector('[data-testid="companion-address"]')?.value ?? '',
      message: document.querySelector('[data-testid="companion-connection-message"]')?.textContent ?? '',
    }));
    throw new Error(`wrong token was not rejected (${detail.message}) at ${detail.address}`);
  }
  const wrongText = await bodyText(page);
  assert(!wrongText.includes(token), 'the page showed the pairing token');
  assert(!wrongText.includes('wrong-token-value'), 'the page echoed the rejected token');
  screenshots.push(await shot(page, '03-wrong-token'));

  step('the page origin proxies to the mock companion');
  await fill(page, '[data-testid="companion-token"]', token);
  await clickNamed(page, 'Test connection');
  await page.waitForFunction(() => (document.querySelector('[data-testid="companion-model-label"]')?.textContent ?? '').includes('Deterministic mock'), { timeout: 10000 });
  const paired = await bodyText(page);
  assert(paired.includes('paired'), 'the connection was not marked paired');
  assert(!paired.includes('cost money'), 'the mock companion was described as a live paid model');
  const appCalls = companionCalls.slice(afterProbe);
  assert(appCalls.some((call) => call === `GET ${origin}/v1/status`), `status did not go through the page origin: ${appCalls.join(', ')}`);
  assert(appCalls.every((call) => call.startsWith('GET https://') || call.startsWith('POST https://')), `a companion call left https: ${appCalls.join(', ')}`);
  screenshots.push(await shot(page, '04-mock-paired'));

  step('ask the mock companion from the room and confirm the answer');
  await page.click('[aria-label="Rooms"]');
  await page.waitForFunction(() => location.pathname === '/' && document.body.innerText.includes('Your rooms'), { timeout: 20000 });
  const roomName = `Tablet room ${Date.now().toString(36)}`;
  const note = 'photosynthesis makes sugar';
  const question = 'Why sugar from this tablet page';
  await clickNamed(page, '+ New room');
  await fill(page, '[aria-label="New room name"]', roomName);
  await page.waitForFunction(() => {
    const match = [...document.querySelectorAll('[role="button"]')].find((element) => (element.textContent || '').trim() === 'Create');
    return match && match.getAttribute('aria-disabled') !== 'true';
  }, { timeout: 10000 });
  await clickNamed(page, 'Create');
  await page.waitForFunction(() => /\/rooms\/[^/]+$/.test(location.pathname), { timeout: 20000 });
  await page.waitForSelector('[aria-label="Note content"]');
  await fill(page, '[aria-label="Note content"]', note);
  await clickNamed(page, 'Add note');
  await page.waitForFunction((expected) => document.body.innerText.includes(expected), { timeout: 15000 }, note);
  await page.waitForFunction(() => {
    for (const element of document.querySelectorAll('div')) {
      if (element.scrollHeight > element.clientHeight + 20) element.scrollTop = element.scrollHeight;
    }
    return Boolean(document.querySelector('[data-testid^="select-chunk-"]'));
  }, { timeout: 20000 });
  await page.click('[data-testid^="select-chunk-"]');
  const reloadedAddress = await page.$eval('[data-testid="companion-url"]', (element) => element.value);
  assert(reloadedAddress === origin, `room companion address was ${reloadedAddress}`);
  await fill(page, '[data-testid="pairing-token"]', token);
  await fill(page, '[data-testid="ask-input"]', question);
  await page.$eval('[data-testid="ask-button"]', (element) => element.scrollIntoView({ block: 'center' }));
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });
  assert(
    companionCalls.slice(afterProbe).some((call) => call === `POST ${origin}/v1/tool`),
    `the question did not go through the page origin: ${companionCalls.slice(afterProbe).join(', ')}`,
  );
  const proposal = await page.$eval('[data-testid="proposal-body"]', (element) => element.textContent ?? '');
  assert(proposal.includes('Mock answer'), 'the proposal was not the deterministic mock');
  assert(proposal.includes(question), 'the proposal did not use the question');
  assert(!proposal.includes(token), 'the proposal contained the pairing token');
  assert(!proposal.includes('Anthropic') && !proposal.includes('OpenAI') && !proposal.includes('xAI'), 'the mock proposal named a live provider');
  screenshots.push(await shot(page, '05-mock-proposal'));
  await page.$eval('[data-testid="confirm-button"]', (element) => element.scrollIntoView({ block: 'center' }));
  await page.click('[data-testid="confirm-button"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="proposal-card"]') && document.body.innerText.includes('Mock answer'), { timeout: 20000 });
  screenshots.push(await shot(page, '06-mock-saved'));
  assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

  const report = {
    ok: true,
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    browser: 'Google Chrome with iPad Pro 11 emulation. Not WebKit. Not a physical iPad.',
    origin,
    secureContext: context.secure,
    crossOriginIsolated: context.isolated,
    userAgent: context.userAgent,
    directHttpBlocked: blocked,
    companionCalls: companionCalls.slice(afterProbe),
    model: 'Deterministic mock',
    live: false,
    screenshots,
    steps,
    pageErrors,
  };
  const serialized = JSON.stringify(report, null, 2);
  assert(!serialized.includes(token), 'the report contained the pairing token');
  writeFileSync(`${outDir}/report.json`, serialized);
  console.log(serialized);
} catch (error) {
  const message = redact(error instanceof Error ? error.stack ?? error.message : error);
  const report = { ok: false, message, steps, pageErrors, serverLog };
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  console.error(message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  stopChildren();
  await delay(300);
}
