/** HTTPS-only board endpoint for native devices. Model keys never enter the app. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type ServerOptions } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

import { parseBoardReply, parseBoardRequest } from '../src/whiteboard/assistant.ts';
import { mockBoardProvider, openAiBoardProvider, type BoardProvider } from './board-provider.ts';

const MAX_BODY_BYTES = 40_000;

export interface BoardServiceOptions {
  tls: ServerOptions;
  token: string;
  expiresAt: number;
  provider: BoardProvider;
  allowedWebOrigin?: string;
  host?: string;
  port?: number;
}

function equalToken(provided: string, expected: string): boolean {
  const left = Buffer.from(provided), right = Buffer.from(expected);
  if (left.length !== right.length) { timingSafeEqual(right, right); return false; }
  return timingSafeEqual(left, right);
}

function send(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
  res.end(data);
}

async function bodyText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new Error('Board request is too large');
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function startBoardService(options: BoardServiceOptions): Promise<{ port: number; close(): Promise<void> }> {
  if (!options.token || options.token.length < 12) throw new Error('Board service token must have at least 12 characters');
  const server = createServer(options.tls, (req, res) => { void handle(req, res, options); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 8790, options.host ?? '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { reject(new Error('Board service did not bind a TCP port')); return; }
      resolve({ port: address.port, close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())) });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, options: BoardServiceOptions): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (origin && origin !== options.allowedWebOrigin) { send(res, 403, { ok: false, error: 'Origin is not allowed' }); return; }
  if (req.method === 'OPTIONS' && origin) {
    res.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-stome-token', vary: 'Origin' }); res.end(); return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/board') { send(res, 404, { ok: false, error: 'Unknown route' }, origin); return; }
  if (Date.now() >= options.expiresAt) { send(res, 401, { ok: false, error: 'Pairing token expired' }, origin); return; }
  const header = req.headers['x-stome-token'];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token || !equalToken(token, options.token)) { send(res, 401, { ok: false, error: 'Invalid pairing token' }, origin); return; }
  let input;
  try { input = parseBoardRequest(JSON.parse(await bodyText(req))); }
  catch (error) { send(res, 400, { ok: false, error: error instanceof Error ? error.message : 'Invalid board request' }, origin); return; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    const output = parseBoardReply(await options.provider.respond(input, controller.signal), input);
    if (!res.writableEnded) send(res, 200, { ok: true, provider: options.provider.name, output }, origin);
  } catch {
    if (!res.writableEnded) send(res, 502, { ok: false, error: 'Board provider failed' }, origin);
  } finally { clearTimeout(timer); }
}

async function main(): Promise<void> {
  const keyPath = process.env.STOME_BOARD_TLS_KEY_FILE, certPath = process.env.STOME_BOARD_TLS_CERT_FILE;
  if (!keyPath || !certPath) throw new Error('Board service needs STOME_BOARD_TLS_KEY_FILE and STOME_BOARD_TLS_CERT_FILE');
  const apiKey = process.env.STOME_BOARD_API_KEY ?? process.env.OPENAI_API_KEY;
  const provider = process.env.STOME_BOARD_PROVIDER === 'mock' ? mockBoardProvider
    : apiKey ? openAiBoardProvider({ apiKey, model: process.env.STOME_BOARD_MODEL ?? 'gpt-4o-mini' })
      : (() => { throw new Error('Board service needs STOME_BOARD_API_KEY or OPENAI_API_KEY'); })();
  const token = process.env.STOME_BOARD_TOKEN ?? randomBytes(24).toString('hex');
  const ttl = Number(process.env.STOME_BOARD_TOKEN_TTL_MS ?? 2 * 60 * 60 * 1000);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('Board token TTL must be positive');
  const port = Number(process.env.STOME_BOARD_PORT ?? 8790);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Board service port is invalid');
  const host = process.env.STOME_BOARD_HOST ?? '127.0.0.1';
  const service = await startBoardService({ tls: { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    token, expiresAt: Date.now() + ttl, provider, allowedWebOrigin: process.env.STOME_BOARD_APP_ORIGIN, host, port });
  process.stdout.write(`Board service listening on HTTPS port ${service.port} at ${host}\nPairing token: ${token}\nProvider: ${provider.name}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
