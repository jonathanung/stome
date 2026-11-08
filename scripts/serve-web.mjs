import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request as forward } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

const expoPort = Number(process.env.EXPO_INTERNAL_PORT ?? 8082);
const webPort = Number(process.env.STOME_WEB_PORT ?? 8081);

// LAN mode serves other devices on the network (an iPad, a phone). Browsers only expose
// navigator.storage, which browser SQLite needs, in a secure context: https, or http on localhost.
// So LAN mode serves https with a self-signed certificate.
const lan = process.env.STOME_WEB_LAN === '1';

// Safari has no COEP `credentialless`, so LAN mode uses `require-corp`. Every subresource is
// served from this origin, so it isolates the page the same way.
const isolationHeaders = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': lan ? 'require-corp' : 'credentialless',
};

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
    .sort();
}

// The certificate lives in .expo/ (gitignored). It is regenerated when the LAN addresses change,
// because a certificate only matches the addresses listed in its subjectAltName.
function lanCertificate(addresses) {
  const dir = join(process.cwd(), '.expo', 'web-cert');
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');
  const namesPath = join(dir, 'names.json');
  const names = ['DNS:localhost', 'IP:127.0.0.1', ...addresses.map((address) => `IP:${address}`)];
  const current = existsSync(namesPath) ? readFileSync(namesPath, 'utf8') : '';
  if (!existsSync(certPath) || !existsSync(keyPath) || current !== JSON.stringify(names)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365',
      '-keyout', keyPath, '-out', certPath,
      '-subj', '/CN=stome local dev',
      '-addext', `subjectAltName=${names.join(',')}`,
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'extendedKeyUsage=serverAuth',
    ], { stdio: 'ignore' });
    writeFileSync(namesPath, JSON.stringify(names));
  }
  return { cert: readFileSync(certPath), key: readFileSync(keyPath), certPath };
}

const addresses = lan ? lanAddresses() : [];
const tls = lan ? lanCertificate(addresses) : null;

const expo = spawn('npx', ['expo', 'start', '--web', '--port', String(expoPort)], {
  env: { ...process.env, BROWSER: 'none', EXPO_NO_TELEMETRY: '1' },
  stdio: 'inherit',
});

const handler = (request, response) => {
  const upstream = forward(
    {
      hostname: '127.0.0.1',
      port: expoPort,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, {
        ...incoming.headers,
        ...isolationHeaders,
      });
      incoming.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end('Expo web is not ready');
  });
  request.pipe(upstream);
};

const server = tls ? createHttpsServer({ cert: tls.cert, key: tls.key }, handler) : createHttpServer(handler);

server.on('upgrade', (request, socket, head) => {
  const upstream = connect(expoPort, '127.0.0.1', () => {
    const lines = [`${request.method} ${request.url} HTTP/1.1`];
    for (const [key, value] of Object.entries(request.headers)) {
      if (value == null) {
        continue;
      }
      for (const item of Array.isArray(value) ? value : [value]) {
        lines.push(`${key}: ${item}`);
      }
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

function stop() {
  server.close();
  expo.kill('SIGTERM');
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
expo.on('exit', (code) => {
  server.close();
  process.exit(code ?? 0);
});

const host = lan ? '0.0.0.0' : '127.0.0.1';
server.listen(webPort, host, () => {
  const coep = isolationHeaders['cross-origin-embedder-policy'];
  if (!tls) {
    process.stdout.write(
      `Document host http://127.0.0.1:${webPort} adds Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: ${coep}\n`,
    );
    return;
  }
  const urls = ['localhost', ...addresses].map((name) => `  https://${name}:${webPort}`).join('\n');
  process.stdout.write(
    `LAN document host (Cross-Origin-Embedder-Policy: ${coep}) on:\n${urls}\n` +
      `Self-signed certificate: ${tls.certPath}\n` +
      'Trust it on the device (AirDrop it, install the profile, then enable it under Settings > General > About > Certificate Trust Settings).\n',
  );
});
