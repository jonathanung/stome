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
  const captureOnce = async () => {
    // A fresh session per frame: a hung captureScreenshot on one session would
    // otherwise block every later frame (protocolTimeout).
    const session = await page.createCDPSession();
    try {
      const shot = await Promise.race([
        session.send('Page.captureScreenshot', {
          format: 'jpeg', quality: 65, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true,
        }),
        delay(2000).then(() => { throw new Error('capture timeout'); }),
      ]);
      return Buffer.from(shot.data, 'base64');
    } finally {
      await session.detach().catch(() => undefined);
    }
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
        // Preserve real wall-clock spacing so gaps from a timed-out capture
        // play as a held frame rather than silently speeding the video up.
        const list = [];
        for (let i = 0; i < index; i += 1) {
          const next = i + 1 < index ? stamps[i + 1] : stamps[i] + 300;
          const duration = Math.max(0.05, (next - stamps[i]) / 1000);
          list.push(`file 'frame-${String(i).padStart(5, '0')}.jpg'`);
          list.push(`duration ${duration.toFixed(3)}`);
        }
        list.push(`file 'frame-${String(index - 1).padStart(5, '0')}.jpg'`);
        writeFileSync(`${dir}/concat.txt`, `${list.join('\n')}\n`);
        execFileSync('ffmpeg', [
          '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/concat.txt`,
          '-fps_mode', 'vfr', '-c:v', 'libvpx-vp9', '-b:v', '1M', '-pix_fmt', 'yuv420p', video,
        ]);
        writeFileSync(`${outDir}/cap4-${lane}.recording.json`, JSON.stringify({
          note: 'Low-frame-rate sampled recording (~4 fps target) of the real Chrome page during the UAT lane. '
            + 'Frames are CDP screenshots of the exact bound page target taken while the script drove real mouse/keyboard input; '
            + 'frame durations preserve real wall-clock spacing, so capture gaps appear as held frames.',
          targetId,
          startUrl,
          endUrl,
          frames: index,
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

async function createRoom(page, name) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[aria-label="New room name"], [data-testid="new-room"], [aria-label="New room"]', { timeout: 90000 });
  await delay(800);
  const phoneButton = await page.$('[data-testid="new-room"]');
  if (phoneButton) {
    await phoneButton.evaluate((node) => node.click());
  } else {
    await domClick(page, '[aria-label="New room"]');
  }
  await page.waitForSelector('input[aria-label="New room name"]', { timeout: 20000 });
  const input = await page.$('input[aria-label="New room name"]');
  await input.evaluate((node) => node.focus());
  await page.type('input[aria-label="New room name"]', name);
  await page.keyboard.press('Enter');
  // Enter creates the room and may or may not navigate into it.
  await page.waitForSelector(`[aria-label="Open ${name}"]`, { timeout: 30000 });
  note(`created room ${name}`);
}

async function openRoom(page, name) {
  // Always re-enter through the list so the lane is on a known route and room.
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await domClick(page, `[aria-label="Open ${name}"]`);
  await page.waitForSelector('textarea[aria-label="Note content"]', { timeout: 30000 });
  await delay(600);
  const text = await bodyText(page);
  if (!text.includes(name)) {
    throw new Error(`wrong room open: expected "${name}", header body starts: ${text.slice(0, 160).replace(/\n/g, ' | ')}`);
  }
  note(`opened room ${name} at ${page.url()}`);
}

async function addNote(page, text, phone) {
  if (phone) {
    await page.waitForSelector('[data-testid="room-add-note"]', { timeout: 20000 });
    await domClick(page, '[data-testid="room-add-note"]');
    await delay(600);
  }
  await page.waitForSelector('textarea[aria-label="Note content"]', { timeout: 20000 });
  await page.$eval('textarea[aria-label="Note content"]', (node) => node.focus());
  await page.type('textarea[aria-label="Note content"]', text);
  await delay(200);
  const clicked = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[role="button"], button'));
    const target = nodes.find((node) => node.getAttribute('data-testid') !== 'room-add-note'
      && (node.innerText || '').trim().toLowerCase() === 'add note');
    if (!target) return false;
    target.click();
    return true;
  });
  if (!clicked) throw new Error('Add note submit button not found');
}

async function runLane(browser, width, height, lane, scheme) {
  const page = await browser.newPage();
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
    await openRoom(page, roomName);
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
    await shot(page, `cap4-${lane}-today`);

    // Recent / Search
    await page.goto(`${url}recent`, { waitUntil: 'domcontentloaded' });
    await delay(1000);
    await assertNoCapture(page, `${lane} recent/search`);
    await shot(page, `cap4-${lane}-recent`);

    // Import
    await page.goto(`${url}import`, { waitUntil: 'domcontentloaded' });
    await delay(1000);
    await assertNoCapture(page, `${lane} import`);
    await shot(page, `cap4-${lane}-import`);

    // Companion
    await page.goto(`${url}companion`, { waitUntil: 'domcontentloaded' });
    await delay(1200);
    await assertNoCapture(page, `${lane} companion`);
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
    recordingNote: 'Low-frame-rate (3 fps) sampled recording of the real Chrome page during each lane. Real mouse/keyboard input; not screen-refresh video.',
  }, null, 2));
  await browser.close().catch(() => undefined);
  note(`artifacts: ${outDir}`);
  note(`frames: ${readdirSync(outDir).filter((f) => f.endsWith('.webm')).join(', ') || 'none'}`);
}

if (failure) {
  process.exitCode = 1;
}
