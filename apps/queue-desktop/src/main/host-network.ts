import { safeStorage } from 'electron';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { z } from 'zod';
import { snapshotSchema, trustedEndpoint } from '@saraf/queue-core';
import { backupSummarySchema } from '@saraf/queue-core/server';
import { hostNetworkSchema, hostSetupSchema, type HostNetworkInfo } from '../setup-contract';
import { connectionFailure } from '../pairing-input';
import { connectionInfo, connect, send } from './client';
import {
  readHostConfig,
  hostConfigFile,
  ownsConnectedHost,
  ownedHostProcess,
  localAddresses,
  approvedSetupPath,
  startHost,
} from './host-setup';
import { waitForHostExit } from '../process-exit';

const leaseSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/), until: z.string().datetime() })
  .strict();
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
let applying = false;

export async function hostNetworkInfo(): Promise<HostNetworkInfo> {
  try {
    const { settings } = await readHostConfig();
    const available = settings.host === '127.0.0.1' && (await ownsConnectedHost(settings.branchId));
    return { available, url: settings.url, addresses: localAddresses(), port: settings.port };
  } catch {
    return { available: false, url: connectionInfo().url ?? '', addresses: [], port: 4318 };
  }
}

async function replaceConfig(value: Buffer) {
  const temporary = hostConfigFile() + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, value, { flag: 'wx', mode: 0o600 });
    await rename(temporary, hostConfigFile());
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

// Verify certificate trust, hostname, DNS routing and the exact listening endpoint
// before taking the live database offline. The probe handles no queue credentials.
async function probeNetwork(input: z.infer<typeof hostNetworkSchema>) {
  const nonce = randomUUID();
  const sockets = new Set<Duplex>();
  const server = https.createServer(
    { cert: await readFile(input.cert), key: await readFile(input.key) },
    (_req, res) => {
      res.setHeader('connection', 'close');
      res.end(nonce);
    },
  );
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(input.port, input.host, resolve);
    });
    const result = await fetch(new URL('/healthz', input.url), {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok || (await result.text()) !== nonce)
      throw new Error(
        'عنوان HTTPS لا يصل إلى واجهة شبكة هذا الخادم. تحقق من DNS والعنوان والمنفذ.',
      );
  } catch (error) {
    throw connectionFailure(error, input.url);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

export async function enableHostNetwork(input: unknown, closeDisplays: () => Promise<void>) {
  if (applying) throw new Error('جارٍ تغيير اتصال الخادم.');
  applying = true;
  try {
    const network = hostNetworkSchema.parse(input);
    const prior = await readHostConfig();
    if (!(await ownsConnectedHost(prior.settings.branchId)) || prior.settings.host !== '127.0.0.1')
      throw new Error(
        'يُفعّل اتصال الشبكة من كمبيوتر الخادم المحلي الذي أُعدّ لهذا الكمبيوتر فقط.',
      );
    const origin = { url: prior.settings.url, token: prior.token };
    const endpoint = trustedEndpoint(network.url);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.pathname !== '/' ||
      Number(endpoint.port || 443) !== network.port ||
      !localAddresses().includes(network.host)
    )
      throw new Error('اختر عنوان LAN/VPN لهذا الكمبيوتر وعنوان HTTPS كاملًا بالمنفذ نفسه.');
    for (const kind of ['cert', 'key'] as const) {
      if (!approvedSetupPath(kind, network[kind]) || (await stat(network[kind])).size > 1024 * 1024)
        throw new Error('اختر ملفات شهادة الشبكة ومفتاحها من زر تصفح.');
    }
    const next = {
      settings: hostSetupSchema.parse({ ...prior.settings, ...network, url: endpoint.origin }),
      token: prior.token,
    };
    await probeNetwork(network);
    const originalConfig = await readFile(hostConfigFile());
    const snapshot = snapshotSchema.parse(
      await send(origin, 'GET', '/v1/snapshot', undefined, 10000),
    );
    if (snapshot.branchId !== prior.settings.branchId || snapshot.actor.role !== 'manager')
      throw new Error('تغير اتصال الفرع.');
    const alive = await ownedHostProcess(snapshot.branchId);
    await closeDisplays();
    const lease = leaseSchema.parse(await send(origin, 'POST', '/v1/maintenance/start', {}, 10000));
    let shutdown = false,
      replaced = false;
    const lock = path.join(prior.settings.directory, 'data/.queue-host.lock');
    const lockExists = async () =>
      stat(lock).then(
        () => true,
        error => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      );
    try {
      const backup = backupSummarySchema.parse(
        await send(origin, 'POST', '/v1/backups', {}, 120000),
      );
      await send(
        origin,
        'POST',
        '/v1/operations',
        { action: 'verify_backup', filename: backup.filename },
        120000,
      );
      if (connectionInfo().url !== origin.url || Date.now() >= Date.parse(lease.until))
        throw new Error('تغير الاتصال أو انتهت مهلة الصيانة.');
      await send(origin, 'POST', '/v1/shutdown', { token: lease.token }, 10000);
      shutdown = true;
      await waitForHostExit(alive, delay);
      await replaceConfig(safeStorage.encryptString(JSON.stringify(next)));
      replaced = true;
      await startHost(next.settings, next.token);
      await connect({ url: next.settings.url, token: next.token, mode: 'manager' });
      return { url: next.settings.url, backup: backup.filename };
    } catch (error) {
      if (replaced && (await lockExists())) {
        // A candidate process may be running: ask it to drain before restoring
        // old settings. Never force-kill PostgreSQL or start two database owners.
        try {
          const candidate = { url: next.settings.url, token: next.token };
          const current = snapshotSchema.parse(
            await send(candidate, 'GET', '/v1/snapshot', undefined, 5000),
          );
          if (
            current.branchId !== prior.settings.branchId ||
            current.actor.id !== snapshot.actor.id
          )
            throw new Error('Changed branch');
          const recoveryLease = leaseSchema.parse(
            await send(candidate, 'POST', '/v1/maintenance/start', {}, 5000),
          );
          await send(candidate, 'POST', '/v1/shutdown', { token: recoveryLease.token }, 5000);
          await waitForHostExit(lockExists, delay);
        } catch {
          throw new Error(
            'حُفظ إعداد الشبكة وقاعدة البيانات. تعذر إرجاع الاتصال بأمان؛ استأنف إعداد خادم الفرع دون إنشاء قاعدة جديدة.',
          );
        }
      }
      if (replaced) await replaceConfig(originalConfig);
      if (shutdown && !(await lockExists())) {
        await startHost(prior.settings, prior.token);
        await connect({ ...origin, mode: 'manager' });
      } else if (!replaced)
        await send(origin, 'POST', '/v1/maintenance/end', { token: lease.token }, 5000).catch(
          () => {},
        );
      throw error;
    }
  } finally {
    applying = false;
  }
}
