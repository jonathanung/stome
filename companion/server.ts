import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

import { PAIRING_TTL_MS, PROVIDER_LIMITS, HarnessError, type HarnessErrorCode } from '../src/harness/contract.ts';
import { createProvider, type Provider, type ProviderRequest } from '../src/harness/provider.ts';

const LOOPBACK_HOST = '127.0.0.1';
const RAW_BODY_LIMIT = PROVIDER_LIMITS.maxRequestChars + 2_000;

type CompanionOptions = {
  origin: string;
  token: string;
  expiresAt: number;
  provider: Provider;
};

export type CompanionHandle = {
  url: string;
  port: number;
  token: string;
  origin: string;
  close: () => Promise<void>;
};

function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1' || address === '::1';
}

function statusFor(code: HarnessErrorCode): number {
  if (code === 'request_limit') {
    return 413;
  }
  if (code === 'timeout') {
    return 408;
  }
  if (code === 'cancelled') {
    return 499;
  }
  if (code === 'invalid_shape' || code === 'scope_rejected' || code === 'bad_anchor') {
    return 400;
  }
  return 422;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: { ok: true; provider: 'mock'; output: unknown } | { ok: false; error: { code: string; message: string } },
  extraHeaders: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'cross-origin',
    ...extraHeaders,
  });
  response.end(payload);
}

function corsHeaders(origin: string | undefined, allowed: string): Record<string, string> | null {
  if (origin !== allowed) {
    return null;
  }
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-stome-token',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += buffer.length;
    if (size > RAW_BODY_LIMIT) {
      throw new HarnessError('request_limit', 'The request is over the limit');
    }
    parts.push(buffer);
  }
  return Buffer.concat(parts).toString('utf8');
}

export function startCompanion(options: CompanionOptions): Promise<CompanionHandle> {
  const server = createServer((request, response) => {
    void handle(request, response, options);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string' || address.address !== LOOPBACK_HOST) {
        reject(new Error('The companion must listen on 127.0.0.1'));
        return;
      }
      resolve({
        url: `http://${LOOPBACK_HOST}:${address.port}`,
        port: address.port,
        token: options.token,
        origin: options.origin,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
    server.listen(0, LOOPBACK_HOST);
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, options: CompanionOptions): Promise<void> {
  const origin = request.headers.origin;
  const cors = corsHeaders(typeof origin === 'string' ? origin : undefined, options.origin);
  const remote = request.socket.remoteAddress;
  if (!isLoopback(remote)) {
    sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'The companion accepts loopback clients only' } }, {});
    return;
  }
  const host = request.headers.host;
  const port = request.socket.localPort;
  if (host !== `${LOOPBACK_HOST}:${port}` && host !== `localhost:${port}`) {
    sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'The companion rejects that host' } }, {});
    return;
  }
  if (!cors) {
    sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'The companion rejects that app origin' } }, {});
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors);
    response.end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/tool') {
    sendJson(response, 404, { ok: false, error: { code: 'not_found', message: 'Unknown companion route' } }, cors);
    return;
  }
  if (Date.now() >= options.expiresAt) {
    sendJson(response, 401, { ok: false, error: { code: 'token_expired', message: 'The pairing token has expired' } }, cors);
    return;
  }
  const header = request.headers['x-stome-token'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided || !tokenMatches(provided, options.token)) {
    sendJson(response, 401, { ok: false, error: { code: 'unauthorized', message: 'The pairing token does not match' } }, cors);
    return;
  }
  const controller = new AbortController();
  const stop = () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  };
  request.on('aborted', stop);
  response.on('close', stop);
  try {
    const raw = await readBody(request);
    const parsed = JSON.parse(raw) as ProviderRequest;
    const output = await options.provider.complete(parsed, controller.signal);
    if (response.writableEnded) {
      return;
    }
    sendJson(response, 200, { ok: true, provider: 'mock', output }, cors);
  } catch (error) {
    if (response.writableEnded) {
      return;
    }
    if (error instanceof HarnessError) {
      sendJson(response, statusFor(error.code), { ok: false, error: { code: error.code, message: error.message } }, cors);
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { ok: false, error: { code: 'invalid_shape', message: 'The request body is not JSON' } }, cors);
      return;
    }
    sendJson(response, 422, { ok: false, error: { code: 'provider_error', message: 'The companion failed before answering' } }, cors);
  }
}

function main(): void {
  const origin = process.env.STOME_APP_ORIGIN ?? 'http://localhost:8081';
  const token = process.env.STOME_PAIRING_TOKEN ?? randomBytes(16).toString('hex');
  const ttl = Number(process.env.STOME_PAIRING_TTL_MS ?? PAIRING_TTL_MS);
  const kind = process.env.STOME_PROVIDER === 'api-key' ? 'api-key' : 'mock';
  const provider = createProvider(kind);
  const server = createServer((request, response) => {
    void handle(request, response, {
      origin,
      token,
      expiresAt: Date.now() + ttl,
      provider,
    });
  });
  const port = Number(process.env.STOME_COMPANION_PORT ?? 8787);
  server.listen(port, LOOPBACK_HOST, () => {
    const minutes = Math.round(ttl / 60_000);
    process.stdout.write(
      [
        `Stome companion listening on http://${LOOPBACK_HOST}:${port}`,
        `App origin: ${origin}`,
        `Pairing token (expires in ${minutes} minutes, keep it out of browser storage): ${token}`,
        'Provider: deterministic mock. No live model call.',
        '',
      ].join('\n'),
    );
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main();
}
