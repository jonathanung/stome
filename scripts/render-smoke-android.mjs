/**
 * Builds and launches the Android debug app on a connected emulator, then
 * fails if a screen does not show its real text or logcat reports a fatal
 * runtime error. This is not a browser viewport and not a Metro web export.
 *
 * GitHub Actions starts the emulator first. Locally, an emulator must already
 * be the only adb device.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outDir = path.resolve(process.env.STOME_RENDER_OUT ?? path.join(repoRoot, 'render-smoke-android'));
mkdirSync(outDir, { recursive: true });

const routes = [
  { name: 'home', text: 'Study rooms' },
  { name: 'today', url: 'stome://today', text: 'Due notes from this device.' },
  { name: 'notes', url: 'stome://notes', text: 'Notes stay on this device.' },
  { name: 'recent', url: 'stome://recent', text: 'Recent notes' },
  { name: 'import', url: 'stome://import', text: 'Bring your notes' },
];

const fatalPattern = /FATAL EXCEPTION|JavascriptException|Unable to load script|\[(?:TypeError|ReferenceError|SyntaxError):|Invariant Violation/;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function adb(args) {
  const result = await run('adb', args);
  if (result.code !== 0) {
    throw new Error(`adb ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function fatalLines(log) {
  return log.split('\n').filter((line) => fatalPattern.test(line));
}

function metroFatalLines() {
  return fatalLines(buildLog.join(''));
}

async function uiXml() {
  await adb(['shell', 'uiautomator', 'dump', '/sdcard/uidump.xml']);
  return adb(['exec-out', 'cat', '/sdcard/uidump.xml']);
}

async function waitForText(expected) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 90_000) {
    if (metroFatalLines().length > 0) return last;
    last = await uiXml().catch((error) => String(error));
    if (last.includes(`text="${expected}"`) || last.includes(`content-desc="${expected}"`) || last.includes(expected)) {
      return last;
    }
    await delay(2000);
  }
  return last;
}

function screenshot(name) {
  const file = path.join(outDir, `${name}.png`);
  const result = spawnSync('adb', ['exec-out', 'screencap', '-p'], { cwd: repoRoot });
  if (result.status === 0 && result.stdout?.length > 100) writeFileSync(file, result.stdout);
  return file;
}

const buildLog = [];
const child = spawn('npx', ['expo', 'run:android', '--port', '8081'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    EXPO_NO_TELEMETRY: '1',
    CI: '1',
    REACT_NATIVE_PACKAGER_HOSTNAME: 'localhost',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function remember(chunk) {
  buildLog.push(chunk.toString());
  if (buildLog.join('').length > 200_000) buildLog.shift();
  process.stdout.write(chunk);
}
child.stdout.on('data', remember);
child.stderr.on('data', remember);

let launched = false;
const launchWait = (async () => {
  const started = Date.now();
  while (Date.now() - started < 30 * 60_000) {
    if (launched) return;
    if (buildLog.join('').includes('Logs for your project will appear below.')) {
      launched = true;
      return;
    }
    if (child.exitCode != null) {
      throw new Error(`expo run:android exited ${child.exitCode} before launch`);
    }
    await delay(2000);
  }
  throw new Error('expo run:android did not launch within 30 minutes');
})();

const results = [];
let failed = false;
try {
  await launchWait;
  await delay(3000);
  for (const route of routes) {
    const overlay = await uiXml().catch(() => '');
    if (overlay.includes('React Native Dev Menu')) {
      await adb(['shell', 'input', 'keyevent', '4']).catch(() => {});
      await delay(500);
    }
    await adb(['logcat', '-c']).catch(() => {});
    if (route.url) {
      await adb(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', route.url]);
      await delay(1500);
    }
    const xml = await waitForText(route.text);
    const shot = await screenshot(route.name);
    const log = await adb(['logcat', '-d', '-t', '400']);
    writeFileSync(path.join(outDir, `${route.name}.logcat.txt`), log);
    const problems = [];
    if (!xml.includes(route.text)) problems.push(`missing visible text ${JSON.stringify(route.text)}`);
    const fatals = [...metroFatalLines(), ...fatalLines(log)];
    if (fatals.length > 0) problems.push(`runtime: ${fatals.slice(0, 3).join(' | ')}`);
    if (problems.length > 0) failed = true;
    results.push({ name: route.name, url: route.url ?? 'launcher', problems, screenshot: shot });
    console.log(`${problems.length === 0 ? 'ok' : 'fail'} ${route.name}${problems.length ? ` — ${problems.join('; ')}` : ''}`);
    if (fatals.length > 0) break;
  }
} catch (error) {
  failed = true;
  results.push({ name: 'launch', problems: [error instanceof Error ? error.message : String(error)] });
  console.error(error instanceof Error ? error.message : error);
} finally {
  writeFileSync(path.join(outDir, 'build.log'), buildLog.join('').slice(-200_000));
  writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify({ results }, null, 2)}\n`);
  if (child.exitCode == null) child.kill('SIGTERM');
  await delay(1000);
  if (child.exitCode == null) child.kill('SIGKILL');
}

if (failed) {
  console.error('android render smoke failed');
  process.exit(1);
}
console.log(`android render smoke ok: ${routes.map((route) => route.name).join(', ')}`);
