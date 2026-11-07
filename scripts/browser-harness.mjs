import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('/tmp/stome-browser/package.json');
const puppeteer = require('puppeteer-core');

const token = process.env.STOME_PAIRING_TOKEN ?? 'hackathon-pair-token';
const url = process.env.STOME_WEB_URL ?? 'http://localhost:8081/';
const outDir = '/opt/cursor/artifacts';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1400 });
const logs = [];
page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

function shot(name) {
  return page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
}

async function text(selector) {
  const handle = await page.$(selector);
  if (!handle) {
    return null;
  }
  return page.evaluate((element) => element.textContent, handle);
}

async function annotationCount() {
  return page.$$eval('[data-testid^="annotation-"]', (nodes) => nodes.length);
}

async function pasteToken() {
  const field = await page.waitForSelector('[data-testid="pairing-token"]');
  await field.click({ clickCount: 3 });
  await page.type('[data-testid="pairing-token"]', token);
}

async function replaceQuestion(value) {
  const field = await page.waitForSelector('[data-testid="ask-input"]');
  await field.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('[data-testid="ask-input"]', value);
}

try {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('[data-testid="note-title-input"]', { timeout: 30000 });
  const isolated = await page.evaluate(() => ({
    origin: location.origin,
    crossOriginIsolated,
    headersNeeded: 'checked by the document response',
  }));
  if (!isolated.crossOriginIsolated) {
    throw new Error(`crossOriginIsolated is false at ${isolated.origin}`);
  }
  const failure = await text('[role="alert"]');
  if (failure && failure.includes('Could not open')) {
    throw new Error(failure);
  }

  await page.click('[data-testid="note-title-input"]');
  await page.type('[data-testid="note-title-input"]', 'Leaf');
  await page.click('[data-testid="note-body-input"]');
  await page.type('[data-testid="note-body-input"]', 'photosynthesis makes sugar');
  await page.click('[data-testid="add-note-button"]');
  await page.waitForFunction(() => document.body.innerText.includes('Leaf'), { timeout: 15000 });
  const select = await page.waitForSelector('[data-testid^="select-note-"]');
  await select.click();
  await page.click('[data-testid="pairing-token"]');
  await page.type('[data-testid="pairing-token"]', token);
  await page.click('[data-testid="ask-input"]');
  await page.type('[data-testid="ask-input"]', 'Why does this matter?');
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });
  const proposal = await text('[data-testid="proposal-body"]');
  if (!proposal?.includes('Mock answer') || !proposal.includes('Why does this matter?')) {
    throw new Error(`unexpected proposal: ${proposal}`);
  }
  await shot('harness-proposal');
  await page.click('[data-testid="confirm-button"]');
  await page.waitForSelector('[data-testid^="annotation-"]', { timeout: 15000 });
  const beforeReload = await page.evaluate(() => document.body.innerText);
  if (!beforeReload.includes('photosynthesis makes sugar') || !beforeReload.includes('Leaf')) {
    throw new Error('the saved note disappeared after confirm');
  }
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid^="annotation-"]', { timeout: 20000 });
  const afterReload = await page.evaluate(() => document.body.innerText);
  if (!afterReload.includes('photosynthesis makes sugar') || !afterReload.includes(proposal)) {
    throw new Error('the annotation or note did not survive reload');
  }
  const tokenAfterReload = await page.$eval('[data-testid="pairing-token"]', (element) => element.value ?? element.textContent ?? '');
  if (tokenAfterReload.includes(token)) {
    throw new Error('the pairing token was still on screen after reload');
  }
  await shot('harness-persisted');

  await page.waitForFunction(() => document.body.innerText.includes('Session: completed'), { timeout: 15000 });
  await pasteToken();
  await replaceQuestion('Say more about sugar');
  const continueDisabled = await page.$eval('[data-testid="continue-button"]', (element) => element.getAttribute('aria-disabled'));
  if (continueDisabled === 'true') {
    throw new Error('Continue stayed disabled after a confirmed answer reloaded');
  }
  await page.click('[data-testid="continue-button"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="proposal-body"]')?.textContent?.includes('Say more about sugar'),
    { timeout: 20000 },
  );
  const secondProposal = await text('[data-testid="proposal-body"]');
  await page.click('[data-testid="confirm-button"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="annotation-"]').length >= 2, { timeout: 15000 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="annotation-"]').length >= 2, { timeout: 20000 });
  const afterSecond = await page.evaluate(() => document.body.innerText);
  if (!afterSecond.includes(proposal) || !afterSecond.includes('Say more about sugar') || !afterSecond.includes('photosynthesis makes sugar')) {
    throw new Error(`continuation did not keep both answers: ${afterSecond.slice(0, 500)}`);
  }
  await shot('harness-continued');

  const noteCount = await page.$$eval('[data-testid^="note-"]', (nodes) => nodes.length);
  await pasteToken();
  await page.click('[data-testid^="select-note-"]');
  await page.click('[data-testid="scenario-error"]');
  await replaceQuestion('This should fail');
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="harness-error"]', { timeout: 15000 });
  const afterError = await page.evaluate(() => document.body.innerText);
  if (!afterError.includes('photosynthesis makes sugar')) {
    throw new Error('an error changed the saved note');
  }
  if ((await page.$$eval('[data-testid^="note-"]', (nodes) => nodes.length)) !== noteCount) {
    throw new Error('an error added or removed a note');
  }

  const answersBeforeCancel = await annotationCount();
  await page.click('[data-testid="scenario-cancel"]');
  await page.click('[data-testid="ask-button"]');
  await page.waitForFunction(() => document.body.innerText.includes('Session: running'), { timeout: 10000 });
  await page.click('[data-testid="cancel-button"]');
  await page.waitForFunction(() => document.body.innerText.includes('cancelled'), { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="proposal-card"]'), { timeout: 10000 });
  const afterCancel = await page.evaluate(() => document.body.innerText);
  if (!afterCancel.includes('photosynthesis makes sugar') || !afterCancel.includes(proposal) || !afterCancel.includes('Say more about sugar')) {
    throw new Error('cancellation changed the saved note or a confirmed answer');
  }
  if ((await annotationCount()) !== answersBeforeCancel) {
    throw new Error('a late cancellation wrote an annotation');
  }
  await shot('harness-cancel');

  await page.click('[data-testid="scenario-cancel"]');
  await replaceQuestion('Leave this running');
  await page.click('[data-testid="ask-button"]');
  await page.waitForFunction(() => document.body.innerText.includes('Session: running'), { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('when the app restarted'), { timeout: 20000 });
  const afterInterrupt = await page.evaluate(() => document.body.innerText);
  if (!afterInterrupt.includes(proposal) || !afterInterrupt.includes('Say more about sugar') || !afterInterrupt.includes('photosynthesis makes sugar')) {
    throw new Error('reopening an interrupted run changed saved notes or answers');
  }
  if (afterInterrupt.includes('Leave this running')) {
    throw new Error('the interrupted run still saved an answer');
  }
  await shot('harness-interrupted');

  await pasteToken();
  await page.click('[data-testid^="select-note-"]');
  await page.click('[data-testid="scenario-success"]');
  await replaceQuestion('Once more');
  await page.click('[data-testid="ask-button"]');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 20000 });
  const beforeDuplicate = await annotationCount();
  const duplicate = await page.evaluate(() => new Promise((resolve) => {
    const confirm = document.querySelector('[data-testid="confirm-button"]');
    confirm?.click();
    requestAnimationFrame(() => {
      const discard = document.querySelector('[data-testid="discard-button"]');
      const disabled = !discard || discard.getAttribute('aria-disabled') === 'true' || discard.disabled === true;
      if (discard && !disabled) {
        discard.click();
      }
      confirm?.click();
      resolve({ discardDisabled: disabled, discardPresent: Boolean(discard) });
    });
  }));
  if (!duplicate.discardDisabled) {
    throw new Error('Discard stayed enabled while confirmation was in progress');
  }
  await page.waitForFunction(
    (previous) => document.querySelectorAll('[data-testid^="annotation-"]').length === previous + 1,
    { timeout: 15000 },
    beforeDuplicate,
  );
  const afterDuplicate = await annotationCount();
  if (afterDuplicate !== beforeDuplicate + 1) {
    throw new Error(`duplicate confirmation wrote ${afterDuplicate - beforeDuplicate} annotations`);
  }
  const afterDuplicateText = await page.evaluate(() => document.body.innerText);
  if (!afterDuplicateText.includes('Once more') || !afterDuplicateText.includes('photosynthesis makes sugar')) {
    throw new Error('the duplicate confirmation lost the note or the new answer');
  }
  await shot('harness-duplicate-confirm');

  const storage = await page.evaluate(async () => {
    const local = { ...localStorage };
    const session = { ...sessionStorage };
    const files = [];
    const root = await navigator.storage.getDirectory();
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        const path = `${prefix}/${name}`;
        if (handle.kind === 'directory') {
          await walk(handle, path);
        } else {
          const file = await handle.getFile();
          const header = new TextDecoder().decode(await file.slice(0, 120).arrayBuffer());
          files.push({ path, size: file.size, header: header.replaceAll('\u0000', '') });
        }
      }
    }
    await walk(root, 'opfs:');
    return {
      origin: location.origin,
      crossOriginIsolated,
      local,
      session,
      files,
      runtime: document.querySelector('[data-testid="harness-runtime"]')?.textContent ?? '',
    };
  });
  const blob = JSON.stringify(storage);
  if (blob.includes(token)) {
    throw new Error('the pairing token was written to browser storage');
  }
  const report = {
    proposal,
    secondProposal,
    duplicate,
    answersBeforeCancel,
    afterDuplicate,
    storage,
    logs: logs.slice(-40),
  };
  writeFileSync(`${outDir}/harness-browser-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await shot('harness-failure').catch(() => undefined);
  console.log(JSON.stringify({ logs: logs.slice(-40) }, null, 2));
  throw error;
} finally {
  await browser.close();
}
