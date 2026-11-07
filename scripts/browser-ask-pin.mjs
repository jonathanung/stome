import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/tmp/stome-browser/package.json');
const puppeteer = require('puppeteer-core');

const token = process.env.STOME_PAIRING_TOKEN ?? '';
const url = process.env.STOME_WEB_URL ?? 'http://localhost:8081/';
const outDir = '/opt/cursor/artifacts';
mkdirSync(outDir, { recursive: true });

if (token.length < 8) {
  throw new Error('STOME_PAIRING_TOKEN is missing');
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1100 });
const logs = [];
page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

function shot(name) {
  return page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
}

async function clickLabel(label) {
  const clicked = await page.evaluate((wanted) => {
    const nodes = [...document.querySelectorAll('[role="button"], button, a, [role="checkbox"]')];
    const match = nodes.find((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === wanted);
    if (!match) return false;
    match.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`Could not find ${label}`);
}

async function fill(selector, value) {
  const field = await page.waitForSelector(selector, { timeout: 30000 });
  await field.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value.length > 0) await page.type(selector, value);
}

async function hideToken() {
  await page.evaluate(() => {
    const field = document.querySelector('[data-testid="pairing-token"]');
    if (!(field instanceof HTMLInputElement)) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(field, '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function annotationTexts() {
  return page.$$eval('[data-testid^="annotation-"]', (nodes) => nodes.map((node) => node.textContent ?? ''));
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const isolated = await page.evaluate(() => ({ origin: location.origin, crossOriginIsolated }));
  if (!isolated.crossOriginIsolated) throw new Error(`crossOriginIsolated is false at ${isolated.origin}`);

  await fill('[aria-label="New room name"]', 'Biology');
  await clickLabel('Create');
  await fill('[aria-label="Note content"]', 'photosynthesis makes sugar');
  await clickLabel('Add note');
  await page.waitForFunction(() => document.body.innerText.includes('photosynthesis makes sugar'), { timeout: 15000 });
  await fill('[aria-label="Note content"]', 'a green leaf');
  await clickLabel('Add note');
  await page.waitForFunction(() => document.body.innerText.includes('a green leaf'), { timeout: 15000 });

  const selects = await page.$$('[data-testid^="select-chunk-"]');
  if (selects.length !== 2) throw new Error(`expected two chunks, saw ${selects.length}`);
  for (const select of selects) await select.click();
  await fill('[data-testid="pairing-token"]', token);
  await fill('[data-testid="ask-input"]', 'Why does this matter?');
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });

  const citationButtons = await page.$$('[role="button"][data-testid^="citation-"]');
  if (citationButtons.length !== 2) throw new Error(`expected two source citations, saw ${citationButtons.length}`);
  const anchoredId = await page.evaluate(() => {
    const quote = document.querySelector('[data-testid^="citation-quote-"]');
    return quote?.getAttribute('data-testid')?.replace('citation-quote-', '') ?? '';
  });
  if (!anchoredId) throw new Error('the answer did not cite a passage');
  const quote = await page.$eval(`[data-testid="citation-quote-${anchoredId}"]`, (node) =>
    (node.textContent ?? '').replace(/^Cited passage:\s*/, ''),
  );
  const bodies = ['photosynthesis makes sugar', 'a green leaf'];
  if (!bodies.some((body) => quote.length > 0 && body.slice(0, quote.length) === quote)) {
    throw new Error('the citation quote is not the chunk text');
  }
  await page.click(`[data-testid="citation-${anchoredId}"]`);
  await page.waitForSelector('[data-testid="cited-anchor"]', { timeout: 5000 });
  const highlighted = await page.$eval('[data-testid="cited-anchor"]', (node) => node.textContent ?? '');
  if (highlighted !== quote) throw new Error('the highlighted passage does not match the citation');
  await hideToken();
  await shot('ask-citations');

  await page.click('[data-testid="confirm-button"]');
  await page.waitForSelector('[data-testid^="annotation-"]', { timeout: 15000 });
  const pinned = (await annotationTexts()).join('\n');
  if (!pinned.includes('Why does this matter?') || !pinned.includes(quote)) {
    throw new Error('the pinned answer did not keep the question and the cited passage');
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid^="annotation-"][data-testid$="-cite"]', { timeout: 20000 });
  const tokenAfterReload = await page.$eval('[data-testid="pairing-token"]', (element) =>
    element instanceof HTMLInputElement ? element.value : '',
  );
  if (tokenAfterReload.includes(token)) throw new Error('the pairing token was still on screen after reload');
  const stored = await page.evaluate((secret) => {
    const blob = `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`;
    return blob.includes(secret);
  }, token);
  if (stored) throw new Error('the pairing token was written to browser storage');
  await page.click('[data-testid^="annotation-"][data-testid$="-cite"]');
  await page.waitForSelector('[data-testid="cited-anchor"]', { timeout: 5000 });
  const afterReload = await page.$eval('[data-testid="cited-anchor"]', (node) => node.textContent ?? '');
  if (afterReload !== quote) throw new Error('the pinned citation did not highlight the same passage after reload');
  await shot('ask-pinned');

  const beforeDecline = (await annotationTexts()).length;
  await fill('[data-testid="pairing-token"]', token);
  for (const select of await page.$$('[data-testid^="select-chunk-"]')) await select.click();
  await fill('[data-testid="ask-input"]', 'Do not keep this');
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });
  await clickLabel('Decline without writing');
  await page.waitForFunction(() => document.body.innerText.includes('Nothing was written'), { timeout: 10000 });
  if ((await annotationTexts()).length !== beforeDecline) throw new Error('decline wrote an annotation');
  if ((await annotationTexts()).join('\n').includes('Do not keep this')) throw new Error('decline kept the answer');

  await page.click('[data-testid="scenario-cancel"]');
  await fill('[data-testid="ask-input"]', 'Stop this question');
  await page.click('[data-testid="ask-button"]');
  await page.waitForFunction(() => document.body.innerText.includes('Session: running'), { timeout: 10000 });
  await page.click('[data-testid="cancel-button"]');
  await page.waitForFunction(() => document.body.innerText.includes('cancelled'), { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="proposal-card"]'), { timeout: 10000 });
  if ((await annotationTexts()).length !== beforeDecline) throw new Error('cancel wrote an annotation');
  if ((await annotationTexts()).join('\n').includes('Stop this question')) throw new Error('a late answer was kept');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const cancelKept = await page.evaluate(() => document.body.innerText.includes('You cancelled this question. Saved chunks were not changed.'));
  if (!cancelKept) throw new Error('a late result replaced the cancel message');
  await hideToken();
  await shot('ask-cancelled');

  await page.click('[data-testid="scenario-success"]');
  await fill('[data-testid="pairing-token"]', token);
  await fill('[data-testid="ask-input"]', 'Hold this proposal');
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });
  const heldQuote = await page.$eval('[data-testid^="citation-quote-"]', (node) =>
    (node.textContent ?? '').replace(/^Cited passage:\s*/, ''),
  );
  if (!heldQuote) throw new Error('the open proposal has no passage');
  const stillOld = await page.evaluate((prefix) => document.body.innerText.includes(prefix), heldQuote);
  if (!stillOld) throw new Error('the open proposal lost the current passage');
  await page.evaluate(() => { window.__staleMark = 'open'; });
  const mutated = await page.evaluate(async (prefix) => {
    const root = document.getElementById('root') ?? document.body;
    const key = Object.keys(root).find((name) => name.startsWith('__reactContainer'));
    let fiber = key ? root[key] : null;
    if (fiber && fiber.stateNode && fiber.stateNode.current) fiber = fiber.stateNode.current;
    const seen = new Set();
    const stack = fiber ? [fiber] : [];
    let database = null;
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      const value = node.memoizedProps ? node.memoizedProps.value : null;
      if (value && typeof value.runAsync === 'function' && typeof value.getAllAsync === 'function') {
        database = value;
        break;
      }
      if (node.child) stack.push(node.child);
      if (node.sibling) stack.push(node.sibling);
    }
    if (!database) return { ok: false, reason: 'no-db' };
    const rows = await database.getAllAsync('SELECT id, content FROM chunks');
    const row = rows.find((item) => typeof item.content === 'string' && item.content.startsWith(prefix));
    if (!row) return { ok: false, reason: 'no-row', count: rows.length };
    const next = `${'Q'.repeat(prefix.length)}${row.content.slice(prefix.length)}`;
    await database.runAsync(
      'UPDATE chunks SET content = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
      next,
      Date.now(),
      row.id,
    );
    return { ok: true, after: next.slice(0, prefix.length) };
  }, heldQuote);
  if (!mutated.ok) throw new Error(`could not change the chunk under the open proposal (${mutated.reason})`);
  const beforeConfirm = await page.evaluate((prefix) => document.body.innerText.includes(prefix), heldQuote);
  if (!beforeConfirm) throw new Error('the screen refreshed before confirm');
  await page.click('[data-testid="confirm-button"]');
  await page.waitForFunction(() => {
    const message = document.querySelector('[data-testid="harness-error"]')?.textContent ?? '';
    return message.includes('Stale revision');
  }, { timeout: 15000 });
  await page.waitForFunction((prefix) => document.body.innerText.includes(prefix), { timeout: 15000 }, mutated.after);
  const stayed = await page.evaluate(() => window.__staleMark);
  if (stayed !== 'open') throw new Error('confirm reloaded the page');
  const showedNew = await page.evaluate((prefix) => document.body.innerText.includes(prefix), mutated.after);
  if (!showedNew) throw new Error('the rejected confirm left the old chunk on screen');
  await hideToken();
  await page.evaluate(() => {
    document.querySelector('[data-testid="harness-error"]')?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  });
  await shot('ask-stale-confirm');
  const failures = logs.filter((line) => line.startsWith('pageerror:'));
  if (failures.length > 0) throw new Error(failures.join('\n'));
  process.stdout.write('browser ask/cite/pin/reload/cancel/stale-confirm passed\n');
} catch (error) {
  await hideToken().catch(() => undefined);
  await shot('ask-failed').catch(() => undefined);
  const safe = logs
    .filter((line) => !line.includes(token))
    .slice(-20)
    .join('\n');
  process.stderr.write(`${error instanceof Error ? error.message : 'browser flow failed'}\n${safe}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
