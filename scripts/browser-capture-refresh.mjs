/**
 * Browser regression for #114: saving from the global Quick Capture while a
 * room is focused must update the rendered note list and the Ask chunk picker
 * without a reload. Assertions are DOM-based, not screenshot-based.
 *
 * Supplementary evidence, not UAT. Puppeteer is loaded from outside the repo so
 * package.json and the lockfile stay unchanged, like scripts/browser-regression.mjs.
 *
 *   mkdir -p /tmp/stome-browser && cd /tmp/stome-browser && npm init -y && npm install puppeteer-core
 *   cd /path/to/stome && npm run web:sqlite   # in another terminal
 *   node scripts/browser-capture-refresh.mjs
 *
 * Environment:
 *   CHROME_PATH            Chrome binary (default: /usr/bin/google-chrome)
 *   STOME_PUPPETEER_ROOT   package.json of the puppeteer-core install
 *   STOME_WEB_URL          page URL (default: http://127.0.0.1:8081/)
 *   STOME_CAPTURE_OUT      screenshots/log directory (default: /tmp/stome-browser/artifacts)
 *
 * The script creates its own rooms, so it does not depend on existing data.
 * It exercises both required viewports: 390x844 and 1280x900.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const puppeteerRoot = process.env.STOME_PUPPETEER_ROOT ?? '/tmp/stome-browser/package.json';
const require = createRequire(puppeteerRoot);
const puppeteer = require('puppeteer-core');

const chromePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const url = process.env.STOME_WEB_URL ?? 'http://127.0.0.1:8081/';
const outDir = process.env.STOME_CAPTURE_OUT ?? '/tmp/stome-browser/artifacts';
mkdirSync(outDir, { recursive: true });

const log = [];
function note(line) {
  log.push(line);
  process.stdout.write(`${line}\n`);
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function waitForText(page, text, timeout = 20000) {
  await page.waitForFunction(
    (wanted) => document.body && document.body.innerText.includes(wanted),
    { timeout },
    text,
  );
}

async function chunkCards(page) {
  return page.$$eval('[data-testid^="chunk-"]', (nodes) => nodes
    .filter((node) => node.getAttribute('data-testid') !== 'chunk-list')
    .map((node) => node.getAttribute('data-testid')));
}

async function askCheckboxes(page) {
  return page.$$eval('[data-testid^="select-chunk-"]', (nodes) => nodes.map((node) => node.getAttribute('data-testid')));
}

/** Fixed overlays and shell chrome can cover a control in the headless layout. */
async function clickVisible(page, selector) {
  const el = await page.waitForSelector(selector, { timeout: 20000 });
  await el.evaluate((node) => node.click());
}

async function createRoom(page, name) {
  // Phone header uses a round + button; the desktop grid uses the dashed card.
  const phoneButton = await page.$('[data-testid="new-room"]');
  if (phoneButton) {
    await phoneButton.click();
  } else {
    await page.waitForSelector('[aria-label="New room"]', { timeout: 30000 });
    await page.click('[aria-label="New room"]');
  }
  await page.waitForSelector('input[aria-label="New room name"]', { timeout: 20000 });
  await page.click('input[aria-label="New room name"]');
  await page.type('input[aria-label="New room name"]', name);
  await page.keyboard.press('Enter');
  await page.waitForSelector(`[aria-label="Open ${name}"]`, { timeout: 20000 });
  // On the phone list, Enter on the name field can land straight in the new room.
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function openRoomIfNeeded(page, name) {
  if (!new URL(page.url()).pathname.startsWith('/rooms/')) {
    await clickVisible(page, `[aria-label="Open ${name}"]`);
  }
  await page.waitForSelector('[data-testid="chunk-list"]', { timeout: 20000 });
}

async function runLane(browser, width, height, label) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const name = `Refresh ${label} ${Date.now().toString(36)}`;
  const body = `photo-synthesis ${label}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[aria-label="New room name"], [data-testid="new-room"], [aria-label="New room"]', { timeout: 60000 });
    await createRoom(page, name);
    await openRoomIfNeeded(page, name);
    await waitForText(page, 'No notes in this room yet');
    assert((await chunkCards(page)).length === 0, 'empty room should start with no chunks');

    // The shell opens the panel; the shortcut is the same path on both viewports.
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyN');
    await page.keyboard.up('Alt');
    await page.waitForSelector('[data-testid="quick-capture-input"]', { timeout: 10000 });
    await page.click('[data-testid="quick-capture-input"]');
    await page.type('[data-testid="quick-capture-input"]', body);
    await clickVisible(page, '[data-testid="quick-capture-save"]');

    // No reload between the save and these assertions.
    await page.waitForFunction(
      (wanted) => document.body.innerText.includes(wanted),
      { timeout: 15000 },
      body,
    );
    const withoutReload = await chunkCards(page);
    const boxes = await askCheckboxes(page);
    const emptyState = await page.evaluate(() => document.body.innerText.includes('No notes in this room yet'));
    assert(withoutReload.length === 1, `expected 1 chunk card without reload at ${width}x${height}, saw ${withoutReload.length}`);
    assert(!emptyState, 'empty state still visible after the capture landed');
    assert(boxes.length === 1, `expected the Ask picker to offer 1 chunk without reload, saw ${boxes.length}`);
    // The new chunk must be selectable in Ask, not merely present.
    const checkbox = await page.$('[data-testid^="select-chunk-"]');
    await checkbox.evaluate((node) => node.click());
    const checkboxText = await page.$eval('[data-testid^="select-chunk-"]', (node) => node.innerText);
    assert(checkboxText.includes('Included'), `the new chunk was not selectable in Ask at ${width}x${height} (${JSON.stringify(checkboxText)})`);
    const subtitle = await page.evaluate(() => {
      const plate = document.querySelector('[data-testid="room-ask-panel"]');
      return plate ? plate.innerText : '';
    });
    if (width >= 900) note(`  ask panel subtitle: ${JSON.stringify(subtitle.split('\n').find((line) => line.includes('chunk')) ?? '')}`);
    note(`  ${width}x${height} save without reload: ${withoutReload.length} chunk card, Ask chunk selectable`);
    await page.screenshot({ path: `${outDir}/capture-refresh-${label}-after-save.png` });

    // A reload is the separate persistence check.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="chunk-list"], input[aria-label="New room name"], [data-testid="new-room"], [aria-label="New room"]', { timeout: 60000 });
    await openRoomIfNeeded(page, name);
    await waitForText(page, body);
    const afterReload = await chunkCards(page);
    const boxesAfterReload = await askCheckboxes(page);
    assert(afterReload.length === 1, `expected exactly 1 chunk after reload, saw ${afterReload.length}`);
    assert(boxesAfterReload.length === 1, `expected exactly 1 Ask checkbox after reload, saw ${boxesAfterReload.length}`);
    const duplicateBody = await page.evaluate((wanted) => document.body.innerText.split(wanted).length - 1, body);
    assert(duplicateBody === 1, `chunk text appeared ${duplicateBody} times after reload`);
    note(`  ${width}x${height} after reload: ${afterReload.length} chunk card, ${boxesAfterReload.length} Ask checkbox`);
    await page.screenshot({ path: `${outDir}/capture-refresh-${label}-after-reload.png` });
  } finally {
    await page.close();
  }
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  await runLane(browser, 390, 844, 'phone');
  await runLane(browser, 1280, 900, 'desktop');
  note('PASS: capture refresh at 390x844 and 1280x900');
} finally {
  await browser.close();
  writeFileSync(`${outDir}/capture-refresh.log`, `${log.join('\n')}\n`);
}
