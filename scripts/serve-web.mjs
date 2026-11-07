import { spawn } from 'node:child_process';
import { createServer, request as forward } from 'node:http';
import { connect } from 'node:net';

const expoPort = Number(process.env.EXPO_INTERNAL_PORT ?? 8082);
const webPort = Number(process.env.STOME_WEB_PORT ?? 8081);

const isolationHeaders = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'credentialless',
};

const expo = spawn('npx', ['expo', 'start', '--web', '--port', String(expoPort)], {
  env: { ...process.env, BROWSER: 'none', EXPO_NO_TELEMETRY: '1' },
  stdio: 'inherit',
});

const server = createServer((request, response) => {
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
});

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

server.listen(webPort, '127.0.0.1', () => {
  process.stdout.write(
    `Document host http://127.0.0.1:${webPort} adds Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: credentialless\n`,
  );
});
