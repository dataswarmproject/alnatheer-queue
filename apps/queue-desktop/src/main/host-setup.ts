import { app, safeStorage } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile, unlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { networkInterfaces, hostname } from 'node:os';
import { createServer } from 'node:net';
import { z } from 'zod';
import { snapshotSchema, trustedEndpoint } from '@saraf/queue-core';
import { hostSetupSchema, type HostSetup } from '../setup-contract';
import { connect, connectionInfo, send } from './client';
import { installLocalVoice, localVoiceAvailable } from './local-voice-library';

const exec = promisify(execFile);
const storedSchema = z
  .object({ settings: hostSetupSchema, token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const configFile = () => path.join(app.getPath('userData'), 'branch-host.enc');
const defaultDirectory = () => path.join(app.getPath('userData'), 'branch-server');
const chosen = new Map<string, Set<string>>();
let creating = false;
export function approveSetupPath(kind: string, value: string) {
  const paths = chosen.get(kind) ?? new Set<string>();
  paths.add(path.resolve(value));
  chosen.set(kind, paths);
}
export function localAddresses() {
  return [
    ...new Set(
      Object.values(networkInterfaces())
        .flat()
        .filter(a => a?.family === 'IPv4' && !a.internal)
        .map(a => a!.address),
    ),
  ];
}
async function readConfig() {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable');
  return storedSchema.parse(JSON.parse(safeStorage.decryptString(await readFile(configFile()))));
}
export async function hostSetupInfo() {
  let configured = false;
  try {
    await stat(configFile());
    configured = true;
  } catch {}
  return {
    directory: defaultDirectory(),
    configured,
    startupSupported: app.isPackaged && process.platform === 'win32',
    addresses: localAddresses(),
    localVoiceAvailable: await localVoiceAvailable(),
  };
}
function runtime() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'branch')
    : path.resolve(__dirname, '../../../../services/queue-branch/dist');
}
async function ready(settings: HostSetup, token: string) {
  try {
    const snapshot = snapshotSchema.parse(
      await send({ url: settings.url, token }, 'GET', '/v1/snapshot', undefined, 1500),
    );
    return snapshot.branchId === settings.branchId && snapshot.actor.role === 'manager';
  } catch {
    return false;
  }
}
async function start(settings: HostSetup, token: string) {
  const freeVoiceRequested = await localVoiceAvailable();
  try {
    await installLocalVoice(settings.directory);
  } catch {
    console.warn(
      'Local voice installation failed; branch service will continue without this library.',
    );
  }
  if (await ready(settings, token)) return;
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('QUEUE_')) delete env[name];
  Object.assign(env, {
    ELECTRON_RUN_AS_NODE: '1',
    QUEUE_BRANCH_ID: settings.branchId,
    QUEUE_DATA_DIR: path.join(settings.directory, 'data'),
    QUEUE_REPORT_DIR: path.join(settings.directory, 'reports'),
    QUEUE_BACKUP_DIR: path.join(settings.directory, 'backups'),
    QUEUE_LISTEN_HOST: settings.host,
    QUEUE_LISTEN_PORT: String(settings.port),
    QUEUE_TLS_CERT: settings.cert ?? '',
    QUEUE_TLS_KEY: settings.key ?? '',
    QUEUE_SYNC_URL: settings.syncUrl ?? '',
    QUEUE_SYNC_KEY: settings.syncKey ?? '',
    QUEUE_SPEECH_VOICE_ID: settings.speechVoiceId ?? '',
    QUEUE_SPEECH_API_KEY: freeVoiceRequested ? '' : (settings.speechApiKey ?? ''),
    QUEUE_SPEECH_CACHE_DIR: path.join(settings.directory, 'speech-cache'),
  });
  const child = spawn(process.execPath, [path.join(runtime(), 'main.js')], {
    env,
    cwd: settings.directory,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  let failed = false;
  child.on('error', () => {
    failed = true;
  });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await ready(settings, token)) return;
    if (failed || child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  // Preserve the database/configuration for recovery; never reset or delete them.
  throw new Error('تعذر بدء خادم الفرع. تحقق من المنفذ وشهادة الشبكة ثم استأنف الإعداد.');
}
function startup(enabled: boolean) {
  if (!app.isPackaged || process.platform !== 'win32') {
    if (enabled) throw new Error('Automatic startup requires the installed Windows application');
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--queue-host-only'] });
}
export async function startSavedHost() {
  try {
    await stat(configFile());
  } catch {
    return false;
  }
  const stored = await readConfig();
  await start(stored.settings, stored.token);
  return true;
}
export async function ownsConnectedHost(branchId: string) {
  try {
    const { settings } = await readConfig();
    return settings.branchId === branchId && new URL(settings.url).origin === connectionInfo().url;
  } catch {
    return false;
  }
}
export async function ownedHostProcess(branchId: string) {
  if (!(await ownsConnectedHost(branchId))) throw new Error('Owned branch host required');
  const { settings } = await readConfig();
  const file = path.join(settings.directory, 'data/.queue-host.lock');
  if ((await stat(file)).size > 4096) throw new Error('Invalid host process lock');
  const lock = z
    .object({ pid: z.number().int().positive(), instance: z.string().uuid(), hostname: z.string() })
    .passthrough()
    .parse(JSON.parse(await readFile(file, 'utf8')));
  if (lock.hostname !== hostname() || lock.pid === process.pid)
    throw new Error('Invalid owned host process');
  return async () => {
    try {
      process.kill(lock.pid, 0);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') return true;
    }
    try {
      await stat(file);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  };
}
export async function ownedHostFolder(kind: 'database' | 'backup' | 'report') {
  const { settings } = await readConfig();
  const root = await realpath(settings.directory);
  const folder = path.join(root, { database: 'data', backup: 'backups', report: 'reports' }[kind]);
  // Only fixed operational folders in this account's configured local host.
  await mkdir(folder, { recursive: true });
  const physical = await realpath(folder);
  if (!physical.startsWith(root + path.sep) || !(await stat(physical)).isDirectory())
    throw new Error('Host folder must stay inside the configured branch directory');
  return physical;
}
export async function resumeHost() {
  if (connectionInfo().configured) throw new Error('Disconnect before changing device setup');
  const stored = await readConfig();
  await start(stored.settings, stored.token);
  startup(stored.settings.openAtLogin);
  await connect({ url: stored.settings.url, token: stored.token, mode: 'manager' });
}
export async function createHost(input: unknown) {
  if (creating) throw new Error('Server setup is already running');
  creating = true;
  try {
    if (connectionInfo().configured) throw new Error('Disconnect before changing device setup');
    const settings = hostSetupSchema.parse(input);
    let directory = path.resolve(settings.directory);
    if (directory !== defaultDirectory() && !chosen.get('directory')?.has(directory))
      throw new Error('Choose the data folder using the folder picker');
    if (directory.startsWith(path.sep.repeat(2)))
      throw new Error('Use a local disk for the branch database');
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('OS credential encryption is unavailable');
    if (settings.openAtLogin && (!app.isPackaged || process.platform !== 'win32'))
      throw new Error('Automatic startup requires the installed Windows application');
    const endpoint = trustedEndpoint(settings.url);
    if (
      endpoint.pathname !== '/' ||
      Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)) !== settings.port
    )
      throw new Error('Use the branch root address with the selected port');
    if (!['127.0.0.1', ...localAddresses()].includes(settings.host))
      throw new Error('Choose this computer’s local network address');
    if (settings.host === '127.0.0.1') {
      if (settings.url !== `http://127.0.0.1:${settings.port}` || settings.cert || settings.key)
        throw new Error('Use the local loopback URL for this-computer mode');
    } else {
      if (endpoint.protocol !== 'https:' || !settings.cert || !settings.key)
        throw new Error('Branch network access requires a trusted TLS certificate and private key');
      for (const kind of ['cert', 'key'] as const) {
        if (!chosen.get(kind)?.has(path.resolve(settings[kind]!)))
          throw new Error('Select certificate files using the file picker');
        if ((await stat(settings[kind]!)).size > 1024 * 1024)
          throw new Error('Certificate file too large');
      }
    }
    if (!!settings.syncUrl !== !!settings.syncKey)
      throw new Error('Supply both headquarters URL and branch sync key');
    if (settings.syncUrl && trustedEndpoint(settings.syncUrl).protocol !== 'https:')
      throw new Error('Headquarters synchronization requires HTTPS');
    try {
      await stat(configFile());
      throw new Error('استأنف إعداد الخادم الموجود بدل إنشاء قاعدة أخرى.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    directory = await realpath(directory);
    if (directory.startsWith(path.sep.repeat(2)))
      throw new Error('Use a physical local disk for the branch database');
    if ((await readdir(directory)).length)
      throw new Error('اختر مجلدًا فارغًا. قواعد البيانات الموجودة لا تُستبدل.');
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(settings.port, settings.host, resolve);
    });
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const pairing = path.join(directory, 'initial-manager.queue-pairing.json');
    await exec(
      process.execPath,
      [
        path.join(runtime(), 'setup.js'),
        '--directory',
        path.join(directory, 'data'),
        '--branch',
        settings.branchId,
        '--output',
        pairing,
      ],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        timeout: 60000,
      },
    ).catch(() => {
      throw new Error('تعذر إنشاء قاعدة الفرع. لم تُستبدل أي قاعدة موجودة.');
    });
    const actor = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .passthrough()
      .parse(JSON.parse(await readFile(pairing, 'utf8')));
    await writeFile(
      configFile(),
      safeStorage.encryptString(
        JSON.stringify({ settings: { ...settings, directory }, token: actor.token }),
      ),
      { flag: 'wx', mode: 0o600 },
    );
    await unlink(pairing);
    await resumeHost();
  } finally {
    creating = false;
  }
}
