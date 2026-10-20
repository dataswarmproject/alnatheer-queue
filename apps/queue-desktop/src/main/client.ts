import { app, safeStorage } from 'electron';
import { readFile, writeFile, unlink, mkdir, open } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import type { SignedRelease } from '@saraf/queue-core/update-release';
import path from 'node:path';
import { z } from 'zod';
import { trustedEndpoint, snapshotSchema, roleSchema } from '@saraf/queue-core';
import { assertDeviceMode, deviceModeSchema } from '../setup-contract';
import { connectionFailure } from '../pairing-input';
import { branchFetch, branchTrustSchema, validateBranchTrust } from '@saraf/queue-core/branch-tls';

const connectionSchema = z
  .object({
    url: z.string().max(200),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    role: roleSchema.optional(),
    mode: deviceModeSchema.optional(),
    trust: branchTrustSchema.optional(),
  })
  .strict();
let credentials: z.infer<typeof connectionSchema> | null = null;
const file = () => path.join(app.getPath('userData'), 'connection.enc');
export async function loadConnection() {
  try {
    if (safeStorage.isEncryptionAvailable())
      credentials = connectionSchema.parse(
        JSON.parse(safeStorage.decryptString(await readFile(file()))),
      );
  } catch {
    credentials = null;
  }
}
export function connectionInfo() {
  return {
    configured: !!credentials,
    ...(credentials
      ? { url: credentials.url, role: credentials.role, mode: credentials.mode }
      : {}),
  };
}
// Public certificate only. Device credentials are never returned to the renderer.
export function connectionTrust() {
  return credentials?.trust;
}
export async function connect(input: unknown) {
  const next = connectionSchema.omit({ role: true }).parse(input);
  const url = trustedEndpoint(next.url);
  if (next.trust) validateBranchTrust(next.trust);
  if (url.pathname !== '/') throw new Error('Enter the branch server root URL');
  const old = credentials;
  credentials = { ...next, url: url.origin };
  try {
    const snapshot = snapshotSchema.parse(await request('GET', '/v1/snapshot'));
    if (next.trust && snapshot.branchId !== next.trust.branchId)
      throw new Error('ملف الاقتران لا يطابق هوية خادم الفرع.');
    assertDeviceMode(next.mode, snapshot);
    credentials.role = snapshot.actor.role;
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('OS credential encryption is unavailable');
    await writeFile(file(), safeStorage.encryptString(JSON.stringify(credentials)), {
      mode: 0o600,
    });
  } catch (error) {
    credentials = old;
    throw connectionFailure(error, url.href);
  }
}
export async function disconnect() {
  credentials = null;
  await unlink(file()).catch(() => {});
}
export async function request(
  method: string,
  route: string,
  input?: unknown,
  timeout = 10000,
): Promise<unknown> {
  if (!credentials) throw new Error('Connect this device to its branch');
  return send(credentials, method, route, input, timeout);
}
export async function downloadRelease(release: SignedRelease, progress: (percent: number) => void) {
  const origin = credentials;
  if (!origin || origin.role !== 'manager') throw new Error('Manager connection required');
  const response = await branchFetch(
    new URL('/v1/update-release/download', origin.url),
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(300000),
      headers: { authorization: `Bearer ${origin.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: release.payload.version, sha256: release.payload.sha256 }),
    },
    origin.trust,
  );
  if (!response.ok || !response.body) throw new Error('تعذر تنزيل التحديث من المركز.');
  const directory = path.join(app.getPath('userData'), 'update-downloads');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, randomUUID() + '.exe'),
    handle = await open(file, 'wx', 0o600);
  const reader = response.body.getReader(),
    hash = createHash('sha256');
  let size = 0,
    complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > release.payload.size || credentials !== origin)
        throw new Error('Invalid update stream or changed connection');
      hash.update(value);
      await handle.writeFile(value);
      progress((size / release.payload.size) * 100);
    }
    if (
      size !== release.payload.size ||
      hash.digest('hex') !== release.payload.sha256 ||
      credentials !== origin
    )
      throw new Error('Invalid update digest');
    complete = true;
    return file;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await handle.close();
    if (!complete) await unlink(file).catch(() => {});
  }
}
export async function verifyManager(input: unknown) {
  if (!credentials) throw new Error('Connect this device first');
  const token = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(input);
  const snapshot = snapshotSchema.parse(
    await send({ ...credentials, token }, 'GET', '/v1/snapshot', undefined, 10000),
  );
  if (snapshot.actor.role !== 'manager') throw new Error('Branch manager authorization required');
}
export async function send(
  connection: z.infer<typeof connectionSchema>,
  method: string,
  route: string,
  input: unknown,
  timeout: number,
) {
  const response = await branchFetch(
    new URL(route, connection.url),
    {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      ...(input == null ? {} : { body: JSON.stringify(input) }),
    },
    connection.trust,
  );
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 8 * 1024 * 1024) throw new Error('Branch response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty branch response');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Branch response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const json = JSON.parse(text);
  if (!response.ok)
    throw new Error(
      `[HTTP_${response.status}] ` +
        (typeof json.error?.message === 'string'
          ? json.error.message.slice(0, 120)
          : 'Branch request failed'),
    );
  return json;
}
