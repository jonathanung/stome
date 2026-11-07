import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/tmp/stome-browser/package.json');
const puppeteer = require('puppeteer-core');

const url = process.env.STOME_WEB_URL ?? 'http://127.0.0.1:8081/';
const outDir = '/opt/cursor/artifacts';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const logs = [];
page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

await page.evaluateOnNewDocument(() => {
  const Original = globalThis.Worker;
  const captured = [];
  function WrappedWorker(spec, opts) {
    const worker = new Original(spec, opts);
    captured.push(worker);
    return worker;
  }
  WrappedWorker.prototype = Original.prototype;
  globalThis.Worker = WrappedWorker;
  globalThis.__sqliteWorkers = captured;
});

function shot(name, options = {}) {
  return page.screenshot({ path: `${outDir}/${name}.png`, ...options });
}

async function shotScreen(name, testId) {
  const screen = await page.waitForSelector(`[data-testid="${testId}"]`);
  return screen.screenshot({ path: `${outDir}/${name}.png` });
}

async function bodyText() {
  return page.evaluate(() => document.body.innerText);
}

async function assertNoPairingToken(testId) {
  const inside = await page.$eval(`[data-testid="${testId}"]`, (root) => Boolean(root.querySelector('[data-testid="pairing-token"]')));
  if (inside) throw new Error('pairing token field is on this screen');
}

async function execSql(source) {
  return page.evaluate(async (sql) => {
    const workers = globalThis.__sqliteWorkers ?? [];
    const worker = workers[0];
    if (!worker) throw new Error(`no sqlite worker (${workers.length})`);
    const id = 1_000_000 + Math.floor(Math.random() * 100_000);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.removeEventListener('message', onMessage);
        reject(new Error('sqlite exec timed out'));
      }, 8000);
      function onMessage(event) {
        if (!event.data || event.data.id !== id) return;
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        if (event.data.error) reject(new Error(String(event.data.error)));
        else resolve(event.data.result ?? null);
      }
      worker.addEventListener('message', onMessage);
      worker.postMessage({
        type: 'exec',
        id,
        isSync: false,
        data: { nativeDatabaseId: 0, source: sql },
      });
    });
  }, source);
}

async function clickButton(label) {
  await page.waitForFunction((name) => {
    return [...document.querySelectorAll('[role="button"], a')].some((node) => {
      return node.getAttribute('aria-label') === name || node.textContent?.trim() === name;
    });
  }, { timeout: 15000 }, label);
  const handle = await page.evaluateHandle((name) => {
    return [...document.querySelectorAll('[role="button"], a')].find((node) => {
      return node.getAttribute('aria-label') === name || node.textContent?.trim() === name;
    });
  }, label);
  await handle.click();
}

async function addNote(text) {
  const field = await page.waitForSelector('[aria-label="Note content"]');
  await field.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('[aria-label="Note content"]', text);
  await clickButton('Add note');
  await page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 15000 }, text);
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('[aria-label="New room name"]', { timeout: 90000 });
  const failure = await page.$('[role="alert"]');
  if (failure) {
    const message = await page.evaluate((element) => element.textContent, failure);
    if (message && message.includes('Could not open')) throw new Error(message);
  }

  await page.click('[aria-label="New room name"]');
  await page.type('[aria-label="New room name"]', 'Biology');
  await clickButton('Create');
  await page.waitForFunction(() => document.body.innerText.includes('Stone stage: stonehenge'), { timeout: 20000 });
  const roomUrl = page.url();

  await addNote('recover me');
  await page.click('[data-testid="open-review"]');
  await page.waitForFunction(() => document.body.innerText.includes('recover me') && document.body.innerText.includes('Revision 1'), { timeout: 15000 });
  await page.evaluate(() => { globalThis.__stomeLoseNextReviewReport = true; });
  await clickButton('Missed');
  await page.waitForFunction(() => document.body.innerText.includes('Retry the same choice'), { timeout: 15000 });
  await execSql("UPDATE chunks SET content = 'recover me edited', revision = revision + 1 WHERE content = 'recover me'");
  await page.click('[data-testid="review-back"]');
  await page.waitForSelector('[data-testid="open-review"]', { timeout: 15000 });
  await page.click('[data-testid="open-review"]');
  await page.waitForFunction(() => document.body.innerText.includes('recover me edited') && document.body.innerText.includes('Revision 2'), { timeout: 15000 });
  await assertNoPairingToken('review-screen');
  await shotScreen('review-r2-open', 'review-screen');
  await clickButton('Missed');
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('recover me edited')
      && text.includes('Revision 2')
      && text.includes('This note is still open.')
      && text.includes('Note 1 of 1');
  }, { timeout: 15000 });
  await shotScreen('review-r2-still-open', 'review-screen');
  await clickButton('Got it');
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Saved Got it.') && !text.includes('recover me edited');
  }, { timeout: 15000 });
  await page.click('[data-testid="review-back"]');
  await page.waitForSelector('[aria-label="Note content"]', { timeout: 15000 });

  await addNote('alpha missed note');
  await addNote('beta unclear note');
  await addNote('gamma got it note');
  await page.click('[data-testid="open-review"]');
  await page.waitForSelector('[data-testid="review-screen"]', { timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes('alpha missed note'), { timeout: 15000 });
  await assertNoPairingToken('review-screen');
  const opened = await bodyText();
  if (!opened.includes('Revision 1')) throw new Error(`expected the original revision\n${opened}`);
  if (!opened.includes('What should you remember from this note?')) throw new Error(`expected the question\n${opened}`);
  if (!opened.includes('Note 1 of 3')) throw new Error(`expected three notes\n${opened}`);
  await shotScreen('review-question', 'review-screen');

  await clickButton('Missed');
  await page.waitForFunction(() => document.body.innerText.includes('Saved Missed.') && document.body.innerText.includes('beta unclear note'), { timeout: 15000 });
  await clickButton('Unclear');
  await page.waitForFunction(() => document.body.innerText.includes('Saved Unclear.') && document.body.innerText.includes('gamma got it note'), { timeout: 15000 });
  await clickButton('Got it');
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Saved Got it.') && text.includes('This room is now brick.') && text.includes('Stone stage: brick') && text.includes('Nothing is due right now.');
  }, { timeout: 15000 });
  await assertNoPairingToken('review-screen');
  const scheduled = await page.$eval('[data-testid="review-schedule"]', (element) => element.innerText);
  if (!scheduled.includes('Missed') || !scheduled.includes('Unclear') || !scheduled.includes('Got it') || !scheduled.includes('due')) {
    throw new Error(`schedule missing due times\n${scheduled}`);
  }
  await shotScreen('review-brick', 'review-screen');

  const reviewUrl = page.url();
  await page.click('[data-testid="review-back"]');
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return !location.pathname.includes('/review')
      && text.includes('Stone stage: brick')
      && text.includes('Review notes')
      && text.includes('Add note');
  }, { timeout: 15000 });
  const token = await page.$('[data-testid="pairing-token"]');
  if (token) {
    const box = await token.boundingBox();
    if (box && box.y < 640) throw new Error('pairing token is inside the room stage shot');
  }
  await shot('room-stage', { clip: { x: 0, y: 0, width: 1280, height: 640 } });
  await page.click('[data-testid="open-review"]');
  await page.waitForSelector('[data-testid="review-schedule"]', { timeout: 15000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="review-stage"]', { timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes('Nothing is due right now.') && document.body.innerText.includes('Stone stage: brick'), { timeout: 15000 });
  const reloaded = await page.$eval('[data-testid="review-schedule"]', (element) => element.innerText);
  if (reloaded !== scheduled) throw new Error(`schedule changed after reload\n${reloaded}\n${scheduled}`);
  await assertNoPairingToken('review-screen');
  await shotScreen('review-reloaded', 'review-screen');

  await page.click('[data-testid="review-back"]');
  await page.waitForSelector('[aria-label="Note content"]', { timeout: 20000 });
  await addNote('delta stale note');
  await page.click('[data-testid="open-review"]');
  await page.waitForFunction(() => document.body.innerText.includes('delta stale note') && document.body.innerText.includes('Revision 1'), { timeout: 15000 });
  await execSql("UPDATE chunks SET content = 'delta changed', revision = revision + 1 WHERE content = 'delta stale note'");
  await clickButton('Got it');
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Nothing was saved and it did not count') && text.includes('delta changed') && text.includes('Revision 2');
  }, { timeout: 15000 });
  const staleText = await bodyText();
  if (staleText.includes('Saved Got it.')) throw new Error('stale mark was saved');
  if (staleText.includes('This room is now brick.')) throw new Error('stale mark credited a promotion');
  await assertNoPairingToken('review-screen');
  await shotScreen('review-stale', 'review-screen');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('delta changed') && document.body.innerText.includes('Revision 2') && document.body.innerText.includes('Stone stage: brick'), { timeout: 15000 });
  const afterStale = await bodyText();
  if (afterStale.includes('Nothing is due right now.')) throw new Error('stale note left the queue as if it had been marked');

  await execSql("UPDATE chunks SET content = '' WHERE content = 'delta changed'");
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Could not make a question for this empty note'), { timeout: 15000 });
  await assertNoPairingToken('review-screen');
  await shotScreen('review-question-error', 'review-screen');
  await clickButton('Skip this note');
  await page.waitForFunction(() => document.body.innerText.includes('Nothing is due right now.'), { timeout: 15000 });

  await page.goto(new URL('/today', url).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="today-screen"]', { timeout: 20000 });
  await page.evaluate(() => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + 11 * 60 * 1000;
  });
  await page.click('[data-testid="today-refresh"]');
  await page.waitForFunction(() => document.body.innerText.includes('alpha missed note'), { timeout: 15000 });
  const todayDue = await bodyText();
  if (todayDue.includes('beta unclear note') || todayDue.includes('gamma got it note') || todayDue.includes('delta changed')) {
    throw new Error(`Today showed notes that are not due\n${todayDue}`);
  }
  await assertNoPairingToken('today-screen');
  await shotScreen('today-due', 'today-screen');

  const beforeTap = page.url();
  await page.click('[data-testid^="today-item-"]');
  await page.waitForFunction(() => location.pathname.includes('/review') && location.search.includes('chunk='), { timeout: 15000 });
  await page.waitForFunction(() => document.body.innerText.includes('alpha missed note') && document.body.innerText.includes('Revision'), { timeout: 15000 });
  await assertNoPairingToken('review-screen');
  await shotScreen('today-opened-review', 'review-screen');
  await page.evaluate(() => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    globalThis.__stomeDeferReviewMark = gate;
    globalThis.__releaseReviewMark = release;
    globalThis.__stomeDeferReviewMarkEntered = false;
    globalThis.__spa = 1;
  });
  await clickButton('Got it');
  await page.waitForFunction(() => globalThis.__stomeDeferReviewMarkEntered === true, { timeout: 15000 });
  const savedEarly = await page.$eval('[data-testid="review-saved"]', (element) => element.textContent).catch(() => '');
  if (savedEarly.includes('Saved')) throw new Error('the paused mark painted before browser back');
  await page.evaluate(() => { history.back(); });
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return globalThis.__spa === 1
      && location.pathname.endsWith('/today')
      && text.includes('alpha missed note')
      && !text.includes('Saved Got it.');
  }, { timeout: 15000 });
  if (!page.url().includes('/today') && beforeTap) {
    throw new Error(`browser back did not return to Today: ${page.url()}`);
  }
  await assertNoPairingToken('today-screen');
  await shotScreen('today-pending', 'today-screen');
  await page.evaluate(() => { globalThis.__releaseReviewMark(); });
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Nothing due today') && !text.includes('alpha missed note');
  }, { timeout: 15000 });
  const painted = await page.evaluate(() => document.querySelector('[data-testid="review-saved"]')?.textContent ?? '');
  if (painted.includes('Saved')) throw new Error(`late report painted after browser back: ${painted}`);
  const todayAfter = await bodyText();
  if (todayAfter.includes('alpha missed note')) throw new Error('the reviewed note is still due');
  await assertNoPairingToken('today-screen');
  await shotScreen('today-refreshed', 'today-screen');

  const pageErrors = logs.filter((line) => line.startsWith('pageerror:'));
  if (pageErrors.length) throw new Error(pageErrors.join('\n'));
  console.log(JSON.stringify({
    roomUrl,
    reviewUrl,
    scheduled,
    today: page.url(),
    screenshots: [
      'review-r2-open.png',
      'review-r2-still-open.png',
      'review-question.png',
      'review-brick.png',
      'review-reloaded.png',
      'review-stale.png',
      'review-question-error.png',
      'today-due.png',
      'today-opened-review.png',
      'today-pending.png',
      'today-refreshed.png',
      'room-stage.png',
    ],
  }, null, 2));
} catch (error) {
  await shot('review-failure', { fullPage: true }).catch(() => undefined);
  console.error(error);
  console.error(logs.slice(-30).join('\n'));
  try {
    console.error(await bodyText());
  } catch {
    // The page may already be closed.
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
