import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(
  new URL('../../../apps/queue-desktop/scripts/test-branch-connection.ps1', import.meta.url),
);
it.runIf(process.platform === 'win32')(
  'checks a real host read-only without requesting device secrets',
  async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url!);
      expect(request.headers.authorization).toBeUndefined();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true, version: '0.4.2' }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const { stdout } = await run('powershell.exe', [
        '-NoProfile',
        '-File',
        script,
        '-BranchUrl',
        `http://127.0.0.1:${port}`,
      ]);
      expect(JSON.parse(stdout)).toMatchObject({
        tcp: 'passed',
        health: 'passed',
        version: '0.4.2',
        certificateChecks: 'loopback-http',
      });
      expect(paths).toEqual(['/healthz']);
      for (const url of [
        'http://10.8.0.12:4318',
        `http://127.0.0.1:${port}/admin`,
        `https://user:secret@localhost:${port}`,
      ])
        await expect(
          run('powershell.exe', ['-NoProfile', '-File', script, '-BranchUrl', url]),
        ).rejects.toThrow('Use a root HTTPS branch URL');
      expect(paths).toEqual(['/healthz']);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  },
  30000,
);
