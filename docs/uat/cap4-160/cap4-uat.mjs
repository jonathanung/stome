/**
 * Real-browser UAT for #160 (CAP.4 remove global Quick Capture).
 *
 * Drives a visible Chrome window against the real dev server, at 390x844 and
 * 1280x900, exercising: rooms home, Today, a room, Recent/Search, Import,
 * Companion, Alt+N / Ctrl+Alt+N, and in-room Add note with reload persistence.
 *
 * Records a sampled CDP screencast per lane (JPEG frames -> webm) plus
 * screenshots and a JSON log. The screencast is a real recording of the
 * interactions but is frame-sampled, so it is labelled as such.
 *
 *   node /tmp/stome-browser/cap4-uat.mjs
 *
 * Requires `npm run web:sqlite` (here: STOME_WEB_PORT=8091).
 */
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire('/tmp/stome-browser/package.json');
const puppeteer = require('puppeteer-core');

const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.env.STOME_WEB_URL ?? 'http://127.0.0.1:8091/';
const outDir = process.env.CAP4_OUT ?? '/tmp/stome-browser/artifacts/cap4';
const repoRoot = process.env.CAP4_REPO ?? '/Users/nick/DEV/stome-worktrees/chore/remove-quick-capture';
const nonce = `cap4${Date.now().toString(36)}`;

mkdirSync(outDir, { recursive: true });

const log = [];
const assertions = [];
function note(line) {
  log.push(line);
  process.stdout.write(`${line}\n`);
}
function check(name, ok, detail = '') {
  assertions.push({ name, ok: Boolean(ok), detail });
  note(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) throw new Error(`assertion failed: ${name} ${detail}`);
}

async function waitForText(page, text, timeout = 30000) {
  await page.waitForFunction(
    (wanted) => document.body && document.body.innerText.includes(wanted),
    { timeout },
    text,
  );
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

const CAPTURE_SELECTORS = [
  '[data-testid="quick-capture"]',
  '[data-testid="quick-capture-button"]',
  '[data-testid="quick-capture-panel"]',
  '[data-testid="quick-capture-sheet-layer"]',
  '[data-testid="tab-capture"]',
  '[data-testid^="quick-capture-"]',
];

async function captureArtifacts(page) {
  const found = [];
  for (const selector of CAPTURE_SELECTORS) {
    const count = await page.$$eval(selector, (nodes) => nodes.length).catch(() => 0);
    if (count) found.push(`${selector} x${count}`);
  }
  return found;
}

async function assertNoCapture(page, label) {
  const found = await captureArtifacts(page);
  check(`${label}: no capture testIDs`, found.length === 0, found.join(', '));
  const text = await bodyText(page);
  check(`${label}: no "Quick capture" copy`, !/quick\s*capture/i.test(text));
  check(`${label}: no Alt+N hint`, !text.includes('Alt+N'));
}

async function shot(page, name) {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

/**
 * Record the lane by screenshotting the real page on a fixed cadence.
 * Chrome's CDP screencast only emits frames for dirty regions and stops
 * early on long lanes, so a fixed-cadence sampler gives a complete, honestly
 * labelled low-frame-rate recording of the whole interaction.
 */
async function startSampler(page, lane) {
  const dir = `${outDir}/frames-${lane}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Bind the recorder to this exact page/target, and record its identity so the
  // artifact can be tied back to the tab that was driven.
  const target = page.target();
  const targetId = typeof target._targetId === 'string' ? target._targetId : 'unknown';
  const startUrl = page.url();
  let index = 0;
  let stopped = false;
  const startedAt = Date.now();
  const stamps = [];
  let firstError = null;
  let session = await page.createCDPSession();
  const captureOnce = async () => {
    const shot = await Promise.race([
      session.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 65, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true,
      }),
      delay(3000).then(() => { throw new Error('capture timeout'); }),
    ]);
    return Buffer.from(shot.data, 'base64');
  };
  const resetSession = async () => {
    const stale = session;
    session = await page.createCDPSession();
    await stale.detach().catch(() => undefined);
  };
  const loop = (async () => {
    while (!stopped) {
      try {
        const jpeg = await captureOnce();
        writeFileSync(`${dir}/frame-${String(index).padStart(5, '0')}.jpg`, jpeg);
        stamps.push(Date.now());
        index += 1;
      } catch (error) {
        firstError ??= error instanceof Error ? error.message : String(error);
        // A hung captureScreenshot would block every later frame on this
        // session, so start a clean one.
        await resetSession().catch(() => undefined);
      }
      await delay(250);
    }
  })();
  return {
    async stop() {
      stopped = true;
      await loop.catch(() => undefined);
      const video = `${outDir}/cap4-${lane}.webm`;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      const endUrl = page.url();
      if (index > 1) {
        // Encode at the observed average capture rate so the video's wall-clock
        // length matches the lane; capture gaps become held frames.
        const span = Math.max(0.5, (stamps[stamps.length - 1] - stamps[0]) / 1000);
        const fps = Math.max(0.5, Number((index / span).toFixed(2)));
        execFileSync('ffmpeg', [
          '-y', '-loglevel', 'error', '-framerate', String(fps),
          '-i', `${dir}/frame-%05d.jpg`,
          '-c:v', 'libvpx-vp9', '-b:v', '1M', '-pix_fmt', 'yuv420p', video,
        ]);
        writeFileSync(`${outDir}/cap4-${lane}.recording.json`, JSON.stringify({
          note: 'Low-frame-rate sampled recording (~4 fps target) of the real Chrome page during the UAT lane. '
            + 'Frames are CDP screenshots of the exact bound page target taken while the script drove real mouse/keyboard input; '
            + 'frame durations preserve real wall-clock spacing, so capture gaps appear as held frames.',
          targetId,
          startUrl,
          endUrl,
          frames: index,
          fps,
          laneSeconds: seconds,
          videoSeconds: (stamps[stamps.length - 1] - stamps[0]) / 1000,
          viewport: lane,
          firstCaptureError: firstError,
        }, null, 2));
      } else {
        note(`recording ${lane}: only ${index} frame(s); firstError=${firstError}`);
      }
      rmSync(dir, { recursive: true, force: true });
      return index ? video : null;
    },
  };
}

async function domClick(page, selector) {
  const handle = await page.waitForSelector(selector, { timeout: 30000 });
  await handle.evaluate((node) => node.click());
}

async function clickText(page, text) {
  const clicked = await page.evaluate((wanted) => {
    const nodes = Array.from(document.querySelectorAll('[role="button"], [role="link"], button, a'));
    const target = nodes.find((node) => (node.innerText || '').trim().toLowerCase() === wanted.toLowerCase());
    if (!target) return false;
    target.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`clickable text not found: ${text}`);
}

async function assertAnchor(page, label, anchor) {
  await waitForText(page, anchor, 30000);
  check(`${label}: shows "${anchor}"`, (await bodyText(page)).includes(anchor));
}

async function createRoom(page, name) {
  const phoneButton = await page.$('[data-testid="new-room"]');
  if (phoneButton) {
    await phoneButton.evaluate((node) => node.click());
  } else {
    await domClick(page, '[aria-label="New room"]');
  }
  await page.waitForSelector('input[aria-label="New room name"]', { timeout: 20000 });
  const field = await visibleCenter(page, 'input[aria-label="New room name"]');
  if (!field) throw new Error('new room field is not visible');
  await page.mouse.click(field.x, field.y);
  await page.keyboard.type(name, { delay: 10 });
  await page.keyboard.press('Enter');
  // Enter creates the room and may or may not navigate into it.
  await Promise.race([
    page.waitForSelector(`[aria-label="Open ${name}"]`, { timeout: 30000 }),
    page.waitForSelector('textarea[aria-label="Note content"]', { timeout: 30000 }),
  ]);
  note(`created room ${name}`);
}

async function openRoom(page, name, phone) {
  // Navigate back to the list in-app (client-side routing) so the lane does not
  // churn the OPFS database with full document reloads before the deliberate
  // persistence reload.
  if (phone) {
    await domClick(page, '[data-testid="tab-rooms"]');
  } else {
    await clickTextReal(page, 'Rooms');
  }
  await page.waitForSelector(`[aria-label="Open ${name}"]`, { timeout: 30000 });
  await domClick(page, `[aria-label="Open ${name}"]`);
  await page.waitForSelector('textarea[aria-label="Note content"]', { timeout: 30000 });
  await delay(600);
  const text = await bodyText(page);
  if (!text.includes(name)) {
    throw new Error(`wrong room open: expected "${name}", header body starts: ${text.slice(0, 160).replace(/\n/g, ' | ')}`);
  }
  note(`opened room ${name} at ${page.url()}`);
}

async function visibleCenter(page, selector) {
  return page.evaluate((sel) => {
    const nodes = Array.from(document.querySelectorAll(sel));
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  }, selector);
}

/** Real mouse click on the first visible control whose exact text matches. */
async function clickTextReal(page, text, skipTestId) {
  const point = await page.evaluate(({ wanted, skip }) => {
    const nodes = Array.from(document.querySelectorAll('[role="button"], button, [role="link"], a'));
    for (const node of nodes) {
      if (skip && node.getAttribute('data-testid') === skip) continue;
      if ((node.innerText || '').trim().toLowerCase() !== wanted.toLowerCase()) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  }, { wanted: text, skip: skipTestId ?? null });
  if (!point) throw new Error(`visible clickable text not found: ${text}`);
  await page.mouse.click(point.x, point.y);
}

async function addNote(page, text, phone) {
  if (phone) {
    await page.waitForSelector('[data-testid="room-add-note"]', { timeout: 20000 });
    await domClick(page, '[data-testid="room-add-note"]');
    await delay(600);
  }
  await page.waitForSelector('textarea[aria-label="Note content"]', { timeout: 20000 });
  const field = await visibleCenter(page, 'textarea[aria-label="Note content"]');
  if (!field) throw new Error('note composer is not visible');
  await page.mouse.click(field.x, field.y);
  await page.keyboard.type(text, { delay: 10 });
  await delay(400);
  await clickTextReal(page, 'Add note', 'room-add-note');
}

async function runLane(browser, width, height, lane, scheme) {
  // A fresh browser context per lane gives each lane its own OPFS/SQLite
  // storage, so lanes never contend for the same access handle and every lane
  // starts from an empty database.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  page.on('pageerror', (error) => note(`pageerror:${lane}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') note(`console:${lane}: ${message.text().slice(0, 300)}`);
  });
  const roomName = `UAT ${lane} ${nonce}`;
  const noteText = `photosynthesis ${nonce} ${lane}`;
  const video = await startSampler(page, lane);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[aria-label="New room name"], [data-testid="new-room"], [aria-label="New room"]', { timeout: 90000 });
    await delay(1200);

    // Rooms home
    await assertNoCapture(page, `${lane} rooms home`);
    check(`${lane}: rooms home loaded`, (await bodyText(page)).includes('Your rooms')
      || Boolean(await page.$('input[aria-label="search rooms"]')));
    await shot(page, `cap4-${lane}-rooms-home`);

    // Sidebar / tab bar chrome
    if (width >= 760) {
      const sidebarText = await bodyText(page);
      check(`${lane}: sidebar has no Quick capture row`, !/quick capture/i.test(sidebarText));
      check(`${lane}: sidebar shows Companion`, sidebarText.includes('Companion'));
    } else {
      check(`${lane}: phone tab bar has no centre + button`, (await captureArtifacts(page)).length === 0);
      for (const tab of ['today', 'rooms', 'recent', 'search']) {
        check(`${lane}: tab-${tab} present`, Boolean(await page.$(`[data-testid="tab-${tab}"]`)));
      }
    }

    // Alt+N and Ctrl+Alt+N do nothing
    const beforeUrl = page.url();
    const beforeText = await bodyText(page);
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyN');
    await page.keyboard.up('Alt');
    await delay(500);
    check(`${lane}: Alt+N opens nothing`, (await captureArtifacts(page)).length === 0 && page.url() === beforeUrl);
    await page.keyboard.down('Control');
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyN');
    await page.keyboard.up('Alt');
    await page.keyboard.up('Control');
    await delay(500);
    check(`${lane}: Ctrl+Alt+N opens nothing`, (await captureArtifacts(page)).length === 0 && page.url() === beforeUrl);
    check(`${lane}: key presses do not change the page`, (await bodyText(page)) === beforeText);
    await shot(page, `cap4-${lane}-after-shortcuts`);

    // Create a room and add an in-room note
    await createRoom(page, roomName);
    await openRoom(page, roomName, width < 760);
    await assertNoCapture(page, `${lane} room`);
    await shot(page, `cap4-${lane}-room`);
    await addNote(page, noteText, width < 760);
    await waitForText(page, noteText);
    await shot(page, `cap4-${lane}-room-after-add-note`);
    check(`${lane}: in-room note visible after save`, (await bodyText(page)).includes(noteText));
    check(`${lane}: chunk card exists`, Boolean(await page.$('[data-testid^="chunk-"]')));

    // Reload persistence
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForText(page, noteText, 60000);
    await shot(page, `cap4-${lane}-room-after-reload`);
    check(`${lane}: in-room note persists across reload`, (await bodyText(page)).includes(noteText));

    // Today
    await page.goto(`${url}today`, { waitUntil: 'domcontentloaded' });
    await delay(1200);
    await assertNoCapture(page, `${lane} today`);
    await assertAnchor(page, `${lane} today`, 'Nothing due today');
    check(`${lane}: today keeps "Capture a note"`, (await bodyText(page)).includes('Capture a note'));
    await shot(page, `cap4-${lane}-today`);

    // Today's "Capture a note" still opens /notes
    await clickTextReal(page, 'Capture a note');
    await page.waitForFunction(() => window.location.pathname === '/notes', { timeout: 20000 });
    await assertAnchor(page, `${lane} notes`, 'Stome');
    await shot(page, `cap4-${lane}-notes`);

    // Recent / Search
    await page.goto(`${url}recent`, { waitUntil: 'domcontentloaded' });
    await delay(1000);
    await assertNoCapture(page, `${lane} recent/search`);
    await assertAnchor(page, `${lane} recent/search`, 'Recent notes');
    await shot(page, `cap4-${lane}-recent`);

    // Import
    await page.goto(`${url}import`, { waitUntil: 'domcontentloaded' });
    await delay(1000);
    await assertNoCapture(page, `${lane} import`);
    await assertAnchor(page, `${lane} import`, 'bring your notes');
    await shot(page, `cap4-${lane}-import`);

    // Companion
    await page.goto(`${url}companion`, { waitUntil: 'domcontentloaded' });
    await delay(1200);
    await assertNoCapture(page, `${lane} companion`);
    await assertAnchor(page, `${lane} companion`, 'Pairing');
    await shot(page, `cap4-${lane}-companion`);

    note(`lane ${lane} complete`);
    return { lane, roomName, noteText, video: await video.stop() };
  } catch (error) {
    await shot(page, `cap4-${lane}-FAILURE`);
    note(`lane ${lane} FAILED: ${error.message}`);
    const stopped = await video.stop();
    throw Object.assign(error, { stopped });
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: false,
  defaultViewport: null,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-infobars', '--window-size=1400,1000'],
});

const results = [];
let failure = null;
try {
  results.push(await runLane(browser, 390, 844, 'phone-390x844-dark', 'dark'));
  results.push(await runLane(browser, 1280, 900, 'desktop-1280x900-dark', 'dark'));
  results.push(await runLane(browser, 390, 844, 'phone-390x844-light', 'light'));
  results.push(await runLane(browser, 1280, 900, 'desktop-1280x900-light', 'light'));
} catch (error) {
  failure = error.message;
} finally {
  writeFileSync(`${outDir}/cap4-uat.log`, log.join('\n'));
  writeFileSync(`${outDir}/cap4-uat.json`, JSON.stringify({
    issue: 160,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    branch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    url,
    chrome: chromePath,
    startedAt: new Date().toISOString(),
    results,
    assertions,
    failure,
    recordingNote: 'Low-frame-rate sampled (~4 fps target) recording of the real Chrome page during each lane, one per isolated browser context. Frame durations preserve wall-clock spacing; capture gaps are held frames.',
  }, null, 2));
  await browser.close().catch(() => undefined);
  note(`artifacts: ${outDir}`);
  note(`frames: ${readdirSync(outDir).filter((f) => f.endsWith('.webm')).join(', ') || 'none'}`);
}

if (failure) {
  process.exitCode = 1;
}
