import http from 'node:http';
import https from 'node:https';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { Blob } from 'node:buffer';
import * as streams from 'node:stream/web';
import { serialize, deserialize } from 'node:v8';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';

const marker = Symbol.for('alnatheer.queue.legacy-runtime');
export const isLegacyRuntime = () => Number(process.versions.electron?.split('.')[0]) === 22;
export const legacyRuntimeActive = () =>
  isLegacyRuntime() && (globalThis as Record<symbol, unknown>)[marker] === true;

function windowsRoots() {
  const extra: string[] = [];
  if (process.env.NODE_EXTRA_CA_CERTS) {
    if (statSync(process.env.NODE_EXTRA_CA_CERTS).size > 8 * 1024 * 1024)
      throw new Error('Configured extra certificate store is too large');
    const contents = readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8');
    for (const certificate of contents.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    ) ?? [])
      extra.push(new X509Certificate(certificate).toString());
    if (!extra.length)
      throw new Error('Configured extra certificate store contains no certificates');
  }
  if (process.platform !== 'win32') return [...rootCertificates, ...extra];
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  // Read existing enterprise trust only. Never install certificates or disable TLS validation.
  const command =
    "$ErrorActionPreference='Stop'; foreach ($location in @([System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser,[System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)) { $store=New-Object System.Security.Cryptography.X509Certificates.X509Store -ArgumentList @('Root',$location); try { $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly); foreach ($cert in $store.Certificates) { [Convert]::ToBase64String($cert.RawData) } } finally { $store.Close() } }";
  const output = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const roots = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(encoded => {
      if (!/^[a-zA-Z0-9+/=]+$/.test(encoded))
        throw new Error('Invalid Windows certificate response');
      return new X509Certificate(Buffer.from(encoded, 'base64')).toString();
    });
  return [...new Set([...rootCertificates, ...roots, ...extra])];
}

// Limited Fetch surface used by queue APIs. Node HTTP keeps TLS validation, aborts,
// and streaming backpressure without introducing an obsolete third-party Fetch dependency.
export function legacyFetch(
  input: string | URL | Request,
  options: RequestInit = {},
  ca?: string[],
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      reject(new Error('Unsupported legacy network address'));
      return;
    }
    const headers = options.headers as Record<string, string> | undefined;
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: options.method || 'GET',
        headers,
        signal: options.signal ?? undefined,
        ...(url.protocol === 'https:' ? { ca, rejectUnauthorized: true } : {}),
      },
      response => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new Error('Network redirects are not allowed'));
          return;
        }
        const body = new streams.ReadableStream<Uint8Array>({
          start(controller) {
            response.on('data', (chunk: Buffer) => {
              controller.enqueue(new Uint8Array(chunk));
              if ((controller.desiredSize ?? 0) <= 0) response.pause();
            });
            response.on('end', () => controller.close());
            response.on('error', error => controller.error(error));
          },
          pull() {
            response.resume();
          },
          cancel() {
            response.destroy();
          },
        });
        const read = async () => {
          const reader = body.getReader(),
            chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              size += next.value.length;
              if (size > 8 * 1024 * 1024) {
                await reader.cancel();
                throw new Error('Response too large');
              }
              chunks.push(next.value);
            }
            return Buffer.concat(chunks);
          } finally {
            reader.releaseLock();
          }
        };
        resolve({
          status,
          ok: status >= 200 && status < 300,
          body,
          headers: {
            get(name: string) {
              const value = response.headers[name.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : (value ?? null);
            },
          },
          async json() {
            return JSON.parse((await read()).toString('utf8'));
          },
          async text() {
            return (await read()).toString('utf8');
          },
          async arrayBuffer() {
            return new Uint8Array(await read()).buffer;
          },
        } as unknown as Response);
      },
    );
    request.once('error', reject);
    if (options.body != null) request.write(options.body);
    request.end();
  });
}

export function installLegacyRuntime() {
  if (!isLegacyRuntime() || legacyRuntimeActive()) return;
  const ca = windowsRoots();
  for (const [name, value] of Object.entries(streams))
    if (!(name in globalThis))
      Object.defineProperty(globalThis, name, { value, configurable: true });
  if (!globalThis.Blob)
    Object.defineProperty(globalThis, 'Blob', { value: Blob, configurable: true });
  if (!globalThis.structuredClone)
    globalThis.structuredClone = value => deserialize(serialize(value));
  if (!AbortSignal.any) {
    AbortSignal.any = signals => {
      const controller = new AbortController();
      const listeners = new Map<AbortSignal, () => void>();
      for (const signal of signals) {
        const abort = () => {
          controller.abort(signal.reason);
          for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
        };
        if (signal.aborted) {
          abort();
          break;
        }
        listeners.set(signal, abort);
        signal.addEventListener('abort', abort, { once: true });
      }
      return controller.signal;
    };
  }
  globalThis.fetch = (input, options) => legacyFetch(input, options, ca);
  (globalThis as Record<symbol, unknown>)[marker] = true;
}
