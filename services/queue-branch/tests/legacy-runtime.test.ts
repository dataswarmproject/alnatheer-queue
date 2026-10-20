import { it, expect } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { legacyFetch } from '@saraf/queue-core/legacy-runtime';

async function listen(server: http.Server | https.Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}
async function close(server: http.Server | https.Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

it('streams queue responses, preserves authentication, refuses redirects and aborts timed out requests', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/private' }).end();
      return;
    }
    if (req.url === '/slow') return;
    if (req.url === '/large') {
      res.end(Buffer.alloc(8 * 1024 * 1024 + 1));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ authorization: req.headers.authorization }));
  });
  const port = await listen(server),
    base = `http://127.0.0.1:${port}`;
  try {
    const response = await legacyFetch(base, { headers: { authorization: 'Bearer test-only' } });
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ authorization: 'Bearer test-only' });
    await expect(
      legacyFetch(base + '/redirect', { headers: { authorization: 'Bearer test-only' } }),
    ).rejects.toThrow('redirects');
    await expect(
      legacyFetch(base + '/slow', { signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow();
    await expect((await legacyFetch(base + '/large')).json()).rejects.toThrow('Response too large');
    await expect(legacyFetch('https://user:password@localhost')).rejects.toThrow('Unsupported');
  } finally {
    await close(server);
  }
});

it('rejects an untrusted HTTPS certificate and accepts the same certificate only with explicit approved trust', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-legacy-tls-'));
  let server: https.Server | undefined;
  try {
    const key = path.join(directory, 'test.key'),
      cert = path.join(directory, 'test.crt');
    const openssl =
      process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    execFileSync(
      openssl,
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    const pem = await readFile(cert, 'utf8');
    server = https.createServer({ key: await readFile(key), cert: pem }, (_req, res) =>
      res.end('{"ok":true}'),
    );
    const port = await listen(server),
      url = `https://127.0.0.1:${port}`;
    await expect(legacyFetch(url)).rejects.toThrow();
    expect(await (await legacyFetch(url, {}, [pem])).json()).toEqual({ ok: true });
  } finally {
    if (server) await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});
