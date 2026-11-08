import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { startCompanion } from '../companion/server.ts';
import { proxyCompanion } from './companion-proxy.mjs';
import {
  companionOriginAllowed,
  companionSetup,
  decideCompanionAddress,
  defaultCompanionUrl,
  devWebPorts,
  evaluateCompanionProxy,
  type CompanionContext,
} from '../src/harness/companionAddress.ts';
import { companionProvider, fetchCompanionStatus } from '../src/harness/companionClient.ts';
import { SCAFFOLD_ROOM_ID } from '../src/harness/contract.ts';
import { mockProvider } from '../src/harness/provider.ts';

const LAPTOP: CompanionContext = { pageOrigin: 'http://127.0.0.1:8081', native: false };
const TABLET: CompanionContext = { pageOrigin: 'https://192.168.88.8:8081', native: false };
const DEVICE: CompanionContext = { pageOrigin: null, native: true };
const PUBLIC: CompanionContext = { pageOrigin: 'https://example.com', native: false };

const TOOL_BODY = JSON.stringify({
  tool: 'notes.proposeAnnotation',
  scenario: 'success',
  input: {
    roomId: SCAFFOLD_ROOM_ID,
    prompt: 'Why?',
    chunks: [{ id: 'note:1', roomId: SCAFFOLD_ROOM_ID, text: 'photosynthesis makes sugar' }],
    priorMessages: [],
  },
});

function hiddenToken(): string {
  return randomBytes(16).toString('hex');
}

test('desktop companion URLs stay on loopback http, and a tablet cannot use them', () => {
  assert.equal(decideCompanionAddress('http://127.0.0.1:8787/ignored', LAPTOP).ok, true);
  assert.equal(decideCompanionAddress('http://[::1]:8787', LAPTOP).ok, true);
  assert.equal(decideCompanionAddress('https://127.0.0.1:8787', LAPTOP).ok, false);
  assert.equal(decideCompanionAddress('http://192.168.88.8:8787', LAPTOP).ok, false);
  assert.equal(decideCompanionAddress('http://user:pass@127.0.0.1:8787', LAPTOP).ok, false);

  const loopbackOnTablet = decideCompanionAddress('http://127.0.0.1:8787', TABLET);
  assert.equal(loopbackOnTablet.ok, false);
  if (!loopbackOnTablet.ok) assert.match(loopbackOnTablet.message, /iPad cannot run npm run companion/);
  const cleartext = decideCompanionAddress('http://192.168.88.8:8787', TABLET);
  assert.equal(cleartext.ok, false);
  if (!cleartext.ok) assert.match(cleartext.message, /cannot call an http companion/);
  const otherHost = decideCompanionAddress('https://evil.example:8081', TABLET);
  assert.equal(otherHost.ok, false);
  const sameOrigin = decideCompanionAddress('https://192.168.88.8:8081/ignored', TABLET);
  assert.deepEqual(sameOrigin, { ok: true, origin: 'https://192.168.88.8:8081' });
  assert.equal(decideCompanionAddress('https://192.168.88.8:8787', TABLET).ok, false);

  const device = decideCompanionAddress('http://127.0.0.1:8787', DEVICE);
  assert.equal(device.ok, false);
  if (!device.ok) assert.match(device.message, /cannot run the companion/);
  assert.equal(decideCompanionAddress('https://example.com', PUBLIC).ok, false);
  assert.equal(defaultCompanionUrl(LAPTOP), 'http://127.0.0.1:8787');
  assert.equal(defaultCompanionUrl(TABLET), 'https://192.168.88.8:8081');
  assert.equal(defaultCompanionUrl({ pageOrigin: null, native: false }), 'http://127.0.0.1:8787');
});

test('setup copy tells a tablet to use the laptop, and keeps the desktop address', () => {
  const tablet = companionSetup(TABLET);
  assert.match(tablet.steps.join('\n'), /cannot run npm/);
  assert.match(tablet.steps.join('\n'), /npm run companion/);
  assert.match(tablet.steps.join('\n'), /npm run web:lan/);
  assert.match(tablet.addressHint, /https:\/\/192\.168\.88\.8:8081/);
  assert.doesNotMatch(tablet.steps.join('\n'), /On the iPad, run npm/);
  const laptop = companionSetup(LAPTOP);
  assert.match(laptop.addressHint, /127\.0\.0\.1:8787/);
  assert.match(laptop.steps.join('\n'), /iPad cannot run/);
  const device = companionSetup(DEVICE);
  assert.match(device.steps.join('\n'), /cannot run npm/);
  assert.match(device.addressHint, /Safari/);
});

test('private https app origins are allowed on the web port, and cleartext LAN origins are not', () => {
  const ports = devWebPorts('http://localhost:8081');
  assert.deepEqual(ports, [8081]);
  assert.equal(companionOriginAllowed('http://localhost:8081', 'http://localhost:8081', ports), true);
  assert.equal(companionOriginAllowed('https://192.168.1.40:8081', 'http://localhost:8081', ports), true);
  assert.equal(companionOriginAllowed('https://10.1.2.3:8081', 'http://localhost:8081', ports), true);
  assert.equal(companionOriginAllowed('https://172.16.5.5:8081', 'http://localhost:8081', ports), true);
  assert.equal(companionOriginAllowed('https://169.254.1.1:8081', 'http://localhost:8081', ports), true);
  assert.equal(companionOriginAllowed('https://127.0.0.1:8081', 'http://localhost:8081', ports), true);
  assert.equal(companionOriginAllowed('http://192.168.1.40:8081', 'http://localhost:8081', ports), false);
  assert.equal(companionOriginAllowed('https://8.8.8.8:8081', 'http://localhost:8081', ports), false);
  assert.equal(companionOriginAllowed('https://172.15.5.5:8081', 'http://localhost:8081', ports), false);
  assert.equal(companionOriginAllowed('https://172.32.0.1:8081', 'http://localhost:8081', ports), false);
  assert.equal(companionOriginAllowed('https://192.168.1.40:9999', 'http://localhost:8081', ports), false);
  assert.equal(companionOriginAllowed('https://192.168.01.40:8081', 'http://localhost:8081', ports), false);
  assert.equal(companionOriginAllowed('https://3232235876:8081', 'http://localhost:8081', ports), false);
  assert.equal(companionOriginAllowed('https://evil.example:8081', 'http://localhost:8081', ports), false);
  assert.equal(companionOriginAllowed('http://localhost:8081.evil.example', 'http://localhost:8081', ports), false);
  assert.equal(devWebPorts('http://localhost:8081', ['9090']).includes(9090), true);
});

test('the proxy forwards only same-origin companion calls that include a token', () => {
  const base = {
    host: '192.168.88.8:8081',
    origin: 'https://192.168.88.8:8081',
    hasToken: true,
    secure: true,
    localPort: 8081,
  };
  const forwarded = evaluateCompanionProxy({ ...base, method: 'GET', target: '/v1/status' });
  assert.equal(forwarded.action, 'forward');
  if (forwarded.action === 'forward') assert.equal(forwarded.origin, 'https://192.168.88.8:8081');
  const omitted = evaluateCompanionProxy({ ...base, origin: undefined, method: 'GET', target: '/v1/status' });
  assert.equal(omitted.action, 'forward');
  if (omitted.action === 'forward') assert.equal(omitted.origin, 'https://192.168.88.8:8081');
  assert.equal(evaluateCompanionProxy({ ...base, method: 'POST', target: '/v1/tool' }).action, 'forward');
  assert.equal(evaluateCompanionProxy({ ...base, method: 'GET', target: '/' }).action, 'ignore');
  assert.equal(evaluateCompanionProxy({ ...base, method: 'GET', target: '/v1/status?x=1' }).action, 'reject');
  assert.equal(evaluateCompanionProxy({ ...base, hasToken: false, method: 'GET', target: '/v1/status' }).action, 'reject');
  assert.equal(
    evaluateCompanionProxy({ ...base, origin: 'https://evil.example', method: 'GET', target: '/v1/status' }).action,
    'reject',
  );
  assert.equal(
    evaluateCompanionProxy({ ...base, secure: false, method: 'GET', target: '/v1/status' }).action,
    'reject',
  );
  assert.equal(
    evaluateCompanionProxy({
      method: 'GET',
      target: '/v1/status',
      host: '127.0.0.1:8081',
      origin: 'http://127.0.0.1:8081',
      hasToken: true,
      secure: false,
      localPort: 8081,
    }).action,
    'forward',
  );
});

test('the client does not send the token off the allowed address', async () => {
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    fetches += 1;
    return new Response(JSON.stringify({ ok: true, output: { roomId: 'x' }, status: { provider: 'mock', model: null, live: false, tools: [] } }), {
      status: 200,
    });
  }) as typeof fetch;
  const input = {
    tool: 'notes.proposeAnnotation' as const,
    input: { roomId: SCAFFOLD_ROOM_ID, prompt: 'x', chunks: [], priorMessages: [] },
    scenario: 'success' as const,
  };
  try {
    await assert.rejects(
      () => companionProvider({ baseUrl: 'http://127.0.0.1:8787', token: hiddenToken(), context: TABLET }).complete(input, new AbortController().signal),
      /iPad cannot run npm/,
    );
    await assert.rejects(
      () => companionProvider({ baseUrl: 'http://192.168.88.8:8787', token: hiddenToken(), context: TABLET }).complete(input, new AbortController().signal),
      /http companion/,
    );
    await assert.rejects(
      () => companionProvider({ baseUrl: 'http://127.0.0.1:8787', token: hiddenToken(), context: DEVICE }).complete(input, new AbortController().signal),
      /cannot run the companion/,
    );
    assert.equal(fetches, 0);
    await companionProvider({ baseUrl: 'https://192.168.88.8:8081/ignored', token: hiddenToken(), context: TABLET }).complete(
      input,
      new AbortController().signal,
    );
    assert.equal(fetches, 1);
    await companionProvider({ baseUrl: 'http://127.0.0.1:8787', token: hiddenToken(), context: LAPTOP }).complete(
      input,
      new AbortController().signal,
    );
    assert.equal(fetches, 2);
  } finally {
    globalThis.fetch = original;
  }
});

function certMaterial(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'stome-companion-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-keyout', keyPath, '-out', certPath,
      '-subj', '/CN=stome tablet test',
      '-addext', 'subjectAltName=IP:127.0.0.1,IP:192.168.88.8,DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

function loopbackListen(port: number): boolean {
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
  return readFileSync('/proc/net/tcp', 'utf8')
    .split('\n')
    .some((line) => {
      const cols = line.trim().split(/\s+/);
      return cols[1] === `0100007F:${hexPort}` && cols[3] === '0A';
    });
}

type RawResponse = { status: number; text: string };

function rawRequest(input: {
  tls: boolean;
  port: number;
  method: string;
  path: string;
  host: string;
  origin: string;
  token?: string;
  body?: string;
}): Promise<RawResponse> {
  const request = input.tls ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: input.host, origin: input.origin };
    if (input.token) headers['x-stome-token'] = input.token;
    if (input.body) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(input.body));
    }
    const req = request(
      {
        hostname: '127.0.0.1',
        port: input.port,
        method: input.method,
        path: input.path,
        headers,
        ...(input.tls ? { rejectUnauthorized: false } : {}),
      },
      (response) => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end(input.body);
  });
}

function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('proxy test server has no port'));
        return;
      }
      resolve(address.port);
    });
  });
}

test('the https proxy reaches the loopback companion and refuses an open unauthenticated call', async () => {
  const token = hiddenToken();
  const webPorts: number[] = [];
  const logs: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    logs.push(Buffer.from(chunk).toString('utf8'));
    return write(chunk, encoding as BufferEncoding, callback);
  }) as typeof process.stdout.write;
  const companion = await startCompanion({
    origin: 'http://localhost:8081',
    token,
    expiresAt: Date.now() + 60_000,
    provider: mockProvider,
    webPorts,
  });
  const tls = certMaterial();
  const httpsServer = createHttpsServer(tls, (request, response) => {
    proxyCompanion(request, response, { secure: true, companionPort: companion.port });
  });
  const httpServer = createHttpServer((request, response) => {
    proxyCompanion(request, response, { secure: false, companionPort: companion.port });
  });
  try {
    const httpsPort = await listen(httpsServer);
    const httpPort = await listen(httpServer);
    webPorts.push(httpsPort, httpPort, 8081);
    assert.equal(new URL(companion.url).hostname, '127.0.0.1');
    assert.equal(loopbackListen(companion.port), true);

    const missing = await rawRequest({
      tls: true,
      port: httpsPort,
      method: 'GET',
      path: '/v1/status',
      host: `192.168.88.8:${httpsPort}`,
      origin: `https://192.168.88.8:${httpsPort}`,
    });
    assert.equal(missing.status, 401);
    assert.equal(missing.text.includes(token), false);

    const wrongToken = await rawRequest({
      tls: true,
      port: httpsPort,
      method: 'GET',
      path: '/v1/status',
      host: `192.168.88.8:${httpsPort}`,
      origin: `https://192.168.88.8:${httpsPort}`,
      token: 'wrong-token-value',
    });
    assert.equal(wrongToken.status, 401);
    assert.equal(wrongToken.text.includes(token), false);
    assert.equal(wrongToken.text.includes('wrong-token-value'), false);

    const wrongOrigin = await rawRequest({
      tls: true,
      port: httpsPort,
      method: 'GET',
      path: '/v1/status',
      host: `192.168.88.8:${httpsPort}`,
      origin: 'https://evil.example',
      token,
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.text.includes(token), false);

    const cleartextLan = await rawRequest({
      tls: false,
      port: httpPort,
      method: 'GET',
      path: '/v1/status',
      host: `192.168.88.8:${httpPort}`,
      origin: `http://192.168.88.8:${httpPort}`,
      token,
    });
    assert.equal(cleartextLan.status, 403);

    const status = await rawRequest({
      tls: true,
      port: httpsPort,
      method: 'GET',
      path: '/v1/status',
      host: `192.168.88.8:${httpsPort}`,
      origin: `https://192.168.88.8:${httpsPort}`,
      token,
    });
    assert.equal(status.status, 200);
    assert.match(status.text, /"provider":"mock"/);
    assert.match(status.text, /"live":false/);
    assert.equal(status.text.includes(token), false);

    const tool = await rawRequest({
      tls: true,
      port: httpsPort,
      method: 'POST',
      path: '/v1/tool',
      host: `192.168.88.8:${httpsPort}`,
      origin: `https://192.168.88.8:${httpsPort}`,
      token,
      body: TOOL_BODY,
    });
    assert.equal(tool.status, 200);
    assert.match(tool.text, /Mock answer/);
    assert.equal(tool.text.includes(token), false);

    const desktopProxy = await rawRequest({
      tls: false,
      port: httpPort,
      method: 'GET',
      path: '/v1/status',
      host: `127.0.0.1:${httpPort}`,
      origin: `http://127.0.0.1:${httpPort}`,
      token,
    });
    assert.equal(desktopProxy.status, 200);
    assert.match(desktopProxy.text, /"live":false/);

    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('origin', 'http://localhost:8081');
      return realFetch(input, { ...init, headers });
    }) as typeof fetch;
    try {
      const direct = await fetchCompanionStatus({
        baseUrl: companion.url,
        token,
        context: { pageOrigin: null, native: false },
      });
      assert.equal(direct.live, false);
      assert.equal(direct.provider, 'mock');
    } finally {
      globalThis.fetch = realFetch;
    }

    await companion.close();
    const stopped = await rawRequest({
      tls: true,
      port: httpsPort,
      method: 'GET',
      path: '/v1/status',
      host: `192.168.88.8:${httpsPort}`,
      origin: `https://192.168.88.8:${httpsPort}`,
      token,
    });
    assert.equal(stopped.status, 502);
    assert.match(stopped.text, /npm run companion/);
    assert.match(stopped.text, /cannot run it/);
    assert.equal(stopped.text.includes(token), false);
    assert.equal(logs.join('').includes(token), false);
  } finally {
    process.stdout.write = write;
    httpsServer.close();
    httpServer.close();
    await companion.close().catch(() => undefined);
  }
});
