/**
 * Opens the production web export in Chrome and fails on a render or runtime
 * crash. Serves dist/ with the COOP/COEP headers browser SQLite needs.
 * This is the laptop browser, not an iOS or Android runtime.
 *
 *   STOME_PUPPETEER_ROOT=/tmp/stome-browser/package.json node scripts/render-smoke-web.mjs
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const distDir = path.resolve(process.env.STOME_WEB_DIST ?? path.join(repoRoot, 'dist'));
const outDir = path.resolve(process.env.STOME_RENDER_OUT ?? path.join(repoRoot, 'render-smoke-web'));
const puppeteerRoot = process.env.STOME_PUPPETEER_ROOT ?? '/tmp/stome-browser/package.json';
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/local/bin/google-chrome',
].filter(Boolean);

const routes = [
  { path: '/', text: 'Study rooms' },
  { path: '/today', text: 'Due notes from this device.' },
  { path: '/notes', text: 'Notes stay on this device.' },
  { path: '/recent', text: 'Recent notes' },
  { path: '/import', text: 'Bring your notes' },
];

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.css', 'text/css; charset=utf-8'],
]);

function chromePath() {
  const found = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Chrome was not found. Tried ${chromeCandidates.join(', ')}`);
  }
  return found;
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function startServer(root) {
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let relative = decodeURIComponent(url.pathname);
    if (relative.endsWith('/')) relative += 'index.html';
    let file = path.normalize(path.join(root, relative));
    if (file !== root && !file.startsWith(rootPrefix)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (!isFile(file)) file = path.join(root, 'index.html');
    try {
      const body = readFileSync(file);
      response.writeHead(200, {
        'content-type': types.get(path.extname(file)) ?? 'application/octet-stream',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'credentialless',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function fatalText(text) {
  const hits = [];
  if (text.includes('Could not open the local database.')) hits.push('database error boundary');
  if (/\bUncaught\b/.test(text)) hits.push('uncaught error text');
  return hits;
}

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error(`web render smoke needs ${path.join(distDir, 'index.html')}. Run npx expo export --platform web --output-dir dist`);
  process.exit(1);
}
if (!existsSync(puppeteerRoot)) {
  console.error(`puppeteer-core is not installed at ${puppeteerRoot}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const require = createRequire(puppeteerRoot);
const puppeteer = require('puppeteer-core');
const { server, origin } = await startServer(distDir);
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
let failed = false;
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(20_000);
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error instanceof Error ? error.message : String(error));
  });

  for (const route of routes) {
    const errorsBefore = pageErrors.length;
    const shot = path.join(outDir, `${route.path === '/' ? 'home' : route.path.slice(1)}.png`);
    let text = '';
    let isolated = false;
    let routeError = '';
    try {
      await page.goto(`${origin}${route.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction((expected) => document.body?.innerText.includes(expected), {}, route.text);
      text = await page.evaluate(() => document.body.innerText);
      isolated = await page.evaluate(() => globalThis.crossOriginIsolated === true);
    } catch (error) {
      text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      isolated = await page.evaluate(() => globalThis.crossOriginIsolated === true).catch(() => false);
      routeError = error instanceof Error ? error.message : String(error);
    }
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    const newErrors = pageErrors.slice(errorsBefore);
    const fatals = fatalText(text);
    const problems = [];
    if (routeError) problems.push(routeError);
    if (!text.includes(route.text)) problems.push(`missing visible text ${JSON.stringify(route.text)}`);
    if (route.path === '/' && !isolated) problems.push('page is not cross-origin isolated');
    problems.push(...fatals);
    if (newErrors.length > 0) problems.push(`pageerror: ${newErrors.join(' | ')}`);
    if (problems.length > 0) failed = true;
    results.push({ path: route.path, isolated, problems, screenshot: shot });
    console.log(`${problems.length === 0 ? 'ok' : 'fail'} ${route.path}${problems.length ? ` — ${problems.join('; ')}` : ''}`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify({ origin, routes: results }, null, 2)}\n`);
if (failed) {
  console.error('web render smoke failed');
  process.exit(1);
}
console.log(`web render smoke ok: ${routes.map((route) => route.path).join(', ')}`);
