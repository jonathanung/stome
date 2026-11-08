// Forwards same-origin /v1 companion calls to the loopback companion.
// The pairing token is required and is never written to a log.

import { request as forward } from 'node:http';

import { COMPANION_RAW_BODY_LIMIT, evaluateCompanionProxy } from '../src/harness/companionAddress.ts';

function single(value) {
  if (typeof value !== 'string') return undefined;
  if (value.includes('\r') || value.includes('\n') || value.includes(',')) return undefined;
  return value;
}

function tokenPresent(value) {
  if (typeof value !== 'string' || Array.isArray(value)) return false;
  if (value.length < 1 || value.length > 256) return false;
  return !/[\r\n,]/.test(value);
}

function sendJson(response, status, message) {
  const code =
    status === 401 ? 'unauthorized' : status === 404 ? 'not_found' : status === 413 ? 'request_limit' : status === 502 ? 'provider_error' : 'forbidden';
  const payload = JSON.stringify({ ok: false, error: { code, message } });
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
  });
  response.end(payload);
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {{ secure: boolean, companionPort: number }} options
 * @returns {boolean} true when this request was handled
 */
export function proxyCompanion(request, response, options) {
  const decision = evaluateCompanionProxy({
    method: request.method,
    target: request.url,
    host: single(request.headers.host),
    origin: single(request.headers.origin),
    hasToken: tokenPresent(request.headers['x-stome-token']),
    secure: options.secure === true,
    localPort: request.socket?.localPort ?? 0,
  });
  if (decision.action === 'ignore') return false;
  if (decision.action === 'reject') {
    sendJson(response, decision.status, decision.message);
    request.resume();
    return true;
  }
  const token = request.headers['x-stome-token'];
  const port = options.companionPort;
  const upstream = forward(
    {
      hostname: '127.0.0.1',
      port,
      method: decision.method,
      path: decision.path,
      headers: {
        host: `127.0.0.1:${port}`,
        origin: decision.origin,
        'content-type': 'application/json',
        'x-stome-token': token,
      },
    },
    (incoming) => {
      const headers = {
        'cache-control': 'no-store',
        'cross-origin-resource-policy': 'same-origin',
      };
      if (typeof incoming.headers['content-type'] === 'string') headers['content-type'] = incoming.headers['content-type'];
      if (typeof incoming.headers['content-length'] === 'string') headers['content-length'] = incoming.headers['content-length'];
      response.writeHead(incoming.statusCode ?? 502, headers);
      incoming.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) {
      sendJson(
        response,
        502,
        'The laptop companion is not running. Start it on the laptop with npm run companion. This device cannot run it.',
      );
      return;
    }
    response.destroy();
  });
  const chunks = [];
  let size = 0;
  let blocked = false;
  request.on('data', (chunk) => {
    if (blocked) return;
    size += chunk.length;
    if (size > COMPANION_RAW_BODY_LIMIT) {
      blocked = true;
      upstream.destroy();
      if (!response.headersSent) sendJson(response, 413, 'The request is over the limit');
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (blocked) return;
    upstream.end(Buffer.concat(chunks));
  });
  request.on('error', () => upstream.destroy());
  request.on('aborted', () => upstream.destroy());
  return true;
}
