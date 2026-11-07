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

const replacement = 'XXXXXXXXXXXX';
const rewritePrompt = `Replace the first 12 characters with ${replacement}.`;

function noteBody(number) {
  const title = `Note ${String(number).padStart(2, '0')} opening line for the list`;
  const lines = [];
  for (let index = 0; index < 28; index += 1) lines.push(`Pad ${number}.${index}`);
  if (number === 2) lines.push('DEEP-ANCHOR.');
  for (let index = 0; index < 8; index += 1) lines.push(`End ${number}.${index}`);
  return [title, ...lines].join('\n');
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700 });
const logs = [];
page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

function shot(name) {
  return page.screenshot({ path: `${outDir}/${name}.png` });
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

async function setField(selector, value) {
  await page.waitForSelector(selector, { timeout: 30000 });
  const wrote = await page.evaluate((sel, next) => {
    const field = document.querySelector(sel);
    if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) return false;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(field, next);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, selector, value);
  if (!wrote) throw new Error(`Could not fill ${selector}`);
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

async function readText(selector) {
  for (let step = 0; step < 30; step += 1) {
    const text = await page.evaluate((sel) => {
      const node = document.querySelector(sel);
      return node ? node.textContent ?? '' : null;
    }, selector);
    if (text !== null) return text;
    await page.evaluate((index) => {
      const list = document.querySelector('[data-testid="chunk-list"]');
      const scroller = list && list.scrollHeight > list.clientHeight + 20 ? list : document.scrollingElement;
      if (!scroller) return;
      scroller.scrollTop = Math.round((index / 29) * scroller.scrollHeight);
    }, step);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Could not find ${selector}`);
}

async function scrollListToEnd() {
  await page.evaluate(() => {
    const nodes = [document.scrollingElement, ...document.querySelectorAll('div')];
    for (const node of nodes) {
      if (node && node.scrollHeight > node.clientHeight + 40) node.scrollTop = node.scrollHeight;
    }
  });
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const isolated = await page.evaluate(() => ({ origin: location.origin, crossOriginIsolated }));
  if (!isolated.crossOriginIsolated) throw new Error(`crossOriginIsolated is false at ${isolated.origin}`);

  await setField('[aria-label="New room name"]', 'Deep citations');
  await clickLabel('Create');
  await page.waitForSelector('[aria-label="Note content"]', { timeout: 20000 });

  for (let number = 1; number <= 8; number += 1) {
    const body = noteBody(number);
    await page.waitForFunction(() => {
      const field = document.querySelector('[aria-label="Note content"]');
      return field instanceof HTMLTextAreaElement && field.value === '';
    }, { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await setField('[aria-label="Note content"]', body);
    await page.waitForFunction((expected) => {
      const field = document.querySelector('[aria-label="Note content"]');
      const button = [...document.querySelectorAll('[role="button"], button')].find((node) => (node.textContent ?? '').trim() === 'Add note');
      return field instanceof HTMLTextAreaElement && field.value === expected && button?.getAttribute('aria-disabled') !== 'true';
    }, { timeout: 15000 }, body);
    await clickLabel('Add note');
    await page.waitForFunction(() => {
      const field = document.querySelector('[aria-label="Note content"]');
      return field instanceof HTMLTextAreaElement && field.value === '';
    }, { timeout: 15000 });
  }

  // Adding a note scrolls to the composer below the notes, so search from the top.
  await page.evaluate(() => {
    let node = document.querySelector('[data-testid="chunk-list"]');
    while (node) {
      if (node.scrollHeight > node.clientHeight + 40) node.scrollTop = 0;
      node = node.parentElement;
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  let targetId = '';
  for (let attempt = 0; attempt < 10 && !targetId; attempt += 1) {
    targetId = await page.evaluate(() => {
      const card = [...document.querySelectorAll('[data-testid^="chunk-"]')]
        .filter((node) => node.getAttribute('data-testid') !== 'chunk-list')
        .find((node) => (node.textContent ?? '').includes('Note 02 opening'));
      return card?.getAttribute('data-testid')?.slice('chunk-'.length) ?? '';
    });
    if (targetId) break;
    await page.evaluate(() => {
      const start = document.querySelector('[data-testid="chunk-list"]');
      let node = start;
      while (node) {
        if (node.scrollHeight > node.clientHeight + 40) {
          node.scrollTop += 500;
          return;
        }
        node = node.parentElement;
      }
      document.scrollingElement?.scrollBy(0, 500);
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (!targetId) throw new Error('the long target note was not rendered');

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await scrollListToEnd();
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  await page.waitForSelector('[data-testid="ask-button"]', { timeout: 15000 });
  const mountedAtFooter = await page.$(`[data-testid="chunk-${targetId}"]`);
  if (mountedAtFooter) {
    const metrics = await page.evaluate((id) => {
      const list = document.querySelector('[data-testid="chunk-list"]');
      return {
        mounted: [...document.querySelectorAll('[data-testid^="chunk-"]')]
          .map((node) => node.getAttribute('data-testid'))
          .filter((value) => value && value !== 'chunk-list'),
        targetMounted: Boolean(document.querySelector(`[data-testid="chunk-${id}"]`)),
        list: list ? { top: list.scrollTop, height: list.scrollHeight, client: list.clientHeight } : null,
      };
    }, targetId);
    throw new Error(`the far card was still mounted when the ask panel was on screen ${JSON.stringify(metrics)}`);
  }

  await page.click(`[data-testid="select-chunk-${targetId}"]`);
  await setField('[data-testid="pairing-token"]', token);
  await setField('[data-testid="ask-input"]', 'Cite the deep passage.');
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector(`[data-testid="citation-${targetId}"]`, { timeout: 20000 });
  const stillUnmounted = await page.$(`[data-testid="chunk-${targetId}"]`);
  if (stillUnmounted) throw new Error('the cited card mounted before the citation was opened');
  const quote = await page.$eval(`[data-testid="citation-quote-${targetId}"]`, (node) =>
    (node.textContent ?? '').replace(/^Cited passage:\s*/, ''),
  );
  if (quote !== 'DEEP-ANCHOR.') throw new Error(`the citation did not use the deep marker (saw ${JSON.stringify(quote)})`);

  await page.click(`[data-testid="citation-${targetId}"]`);
  const placed = await page.waitForFunction(() => {
    const span = document.querySelector('[data-testid="cited-anchor"]');
    if (!span) return null;
    const rect = span.getBoundingClientRect();
    const card = span.closest('[data-testid^="chunk-"]');
    const cardRect = card?.getBoundingClientRect();
    if (!cardRect || rect.height <= 0) return null;
    if (rect.top < 0 || rect.bottom > window.innerHeight) return null;
    if (cardRect.top >= -20) return null;
    if (cardRect.height <= window.innerHeight) return null;
    return {
      text: span.textContent ?? '',
      top: rect.top,
      bottom: rect.bottom,
      cardTop: cardRect.top,
      cardHeight: cardRect.height,
      viewHeight: window.innerHeight,
    };
  }, { timeout: 8000 });
  const proof = await placed.jsonValue();
  if (proof.text !== 'DEEP-ANCHOR.') throw new Error('the visible span is not the deep marker');
  await hideToken();
  await shot('ask-deep-anchor');

  await page.click('[data-testid="discard-button"]');
  await page.waitForFunction(() => document.body.innerText.includes('Nothing was written'), { timeout: 10000 });
  await setField('[data-testid="pairing-token"]', token);
  await setField('[data-testid="ask-input"]', 'Why does this matter?');
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });
  const opening = await page.$eval(`[data-testid="citation-quote-${targetId}"]`, (node) =>
    (node.textContent ?? '').replace(/^Cited passage:\s*/, ''),
  );
  if (opening !== 'Note 02 open') throw new Error('the pin quote is not the original opening');
  await page.click('[data-testid="confirm-button"]');
  const pinnedQuote = await readText('[data-testid^="annotation-"][data-testid$="-cite"]');
  if (!pinnedQuote.includes(opening)) throw new Error('the pin did not keep the original opening');

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reloadedQuote = await readText('[data-testid^="annotation-"][data-testid$="-cite"]');
  if (!reloadedQuote.includes(opening)) throw new Error('reload lost the original cited opening');

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await scrollListToEnd();
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  await page.waitForSelector(`[data-testid="select-chunk-${targetId}"]`, { timeout: 15000 });
  await page.click(`[data-testid="select-chunk-${targetId}"]`);
  await page.click('[data-testid="purpose-edit"]');
  await setField('[data-testid="pairing-token"]', token);
  await setField('[data-testid="ask-input"]', rewritePrompt);
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="proposal-after"]', { timeout: 20000 });
  const after = await page.$eval('[data-testid="proposal-after"]', (node) => node.textContent ?? '');
  if (!after.startsWith(replacement)) throw new Error('the edit did not rewrite the opening');
  await page.click('[data-testid="confirm-button"]');
  await readText('[data-testid^="annotation-"][data-testid$="-error"]');
  await page.waitForFunction(
    (prefix) => document.body.innerText.includes(prefix),
    { timeout: 15000 },
    replacement,
  );

  async function assertStale(prefix, saved) {
    return page.evaluate((nextPrefix, savedQuote) => {
      const cite = document.querySelector('[data-testid^="annotation-"][data-testid$="-cite"]');
      const error = document.querySelector('[data-testid^="annotation-"][data-testid$="-error"]');
      const savedNode = document.querySelector('[data-testid^="annotation-"][data-testid$="-saved"]');
      const savedText = savedNode?.textContent ?? '';
      const citedText = cite?.textContent ?? '';
      return {
        verified: Boolean(cite),
        citedText,
        error: error?.textContent ?? '',
        savedText,
        prefixShownAsCitation: citedText.includes(nextPrefix) || savedText.includes(nextPrefix),
        keptOriginal: savedText.includes(savedQuote),
        bodyHasPrefix: document.body.innerText.includes(nextPrefix),
      };
    }, prefix, saved);
  }

  const beforeReload = await assertStale(replacement, opening);
  if (beforeReload.verified) throw new Error('the edited opening was still offered as the citation');
  if (beforeReload.prefixShownAsCitation) throw new Error('the new opening was attributed as the saved passage');
  if (!beforeReload.keptOriginal) throw new Error(`the original passage was not kept on the pin ${JSON.stringify(beforeReload)}`);
  if (!beforeReload.bodyHasPrefix) throw new Error('the edited opening was not rendered');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await readText('[data-testid^="annotation-"][data-testid$="-saved"]');
  const afterReload = await assertStale(replacement, opening);
  if (afterReload.verified) throw new Error('reload presented the edited opening as the original citation');
  if (afterReload.prefixShownAsCitation) throw new Error('reload attributed the new opening as the saved passage');
  if (!afterReload.keptOriginal) throw new Error('reload dropped the original saved passage');
  if (!afterReload.error.includes('no longer matches')) throw new Error('reload hid the stale-passage warning');
  await hideToken();
  await page.evaluate(() => {
    document.querySelector('[data-testid^="annotation-"][data-testid$="-saved"]')?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  });
  await shot('ask-stale-pin');

  const failures = logs.filter((line) => line.startsWith('pageerror:'));
  if (failures.length > 0) throw new Error(failures.join('\n'));
  process.stdout.write(
    `deep anchor visible at top ${Math.round(proof.top)} in a ${Math.round(proof.viewHeight)}px view; card top ${Math.round(proof.cardTop)}; stale pin kept ${opening}\n`,
  );
} catch (error) {
  await hideToken().catch(() => undefined);
  await shot('ask-scroll-failed').catch(() => undefined);
  const debug = await page.evaluate(() => {
    const field = document.querySelector('[aria-label="Note content"]');
    const buttons = [...document.querySelectorAll('[role="button"], button')].map((node) => (node.textContent ?? '').trim().slice(0, 48));
    const alert = document.querySelector('[data-testid="harness-error"]')?.textContent ?? '';
    return {
      chunks: [...document.querySelectorAll('[data-testid^="chunk-"]')].filter((node) => node.getAttribute('data-testid') !== 'chunk-list').length,
      noteLength: field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement ? field.value.length : -1,
      buttons: buttons.slice(0, 12),
      alert: alert.slice(0, 240),
    };
  }).catch(() => ({ chunks: -1, noteLength: -1, buttons: [] }));
  const safe = logs
    .filter((line) => !line.includes(token))
    .slice(-20)
    .join('\n');
  process.stderr.write(`${error instanceof Error ? error.message : 'browser flow failed'}\n${JSON.stringify(debug)}\n${safe}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
