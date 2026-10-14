import { app } from 'electron';
import { NsisUpdater } from 'electron-updater';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { snapshotSchema } from '@saraf/queue-core';
import { backupSummarySchema } from '@saraf/queue-core/server';
import { UpdateController, type UpdateEngine } from '../update-controller';
import { connectionInfo, request, downloadRelease } from './client';
import { SignedReleaseEngine } from '../signed-release-engine';
import { queueReleasePublicKey } from '@saraf/queue-core/release-trust';
import { ownsConnectedHost, ownedHostProcess, startSavedHost } from './host-setup';
import { waitForHostExit } from '../process-exit';

const preferencesSchema = z
  .object({
    ignoredVersion: z.string().nullable(),
    scheduledVersion: z.string().nullable(),
    scheduledAt: z.string().datetime().nullable(),
  })
  .strict();
const empty = { ignoredVersion: null, scheduledVersion: null, scheduledAt: null };
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function launchInstaller(file: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      file,
      ['--updated', '/S', '--force-run', '/currentuser', `/D=${path.dirname(app.getPath('exe'))}`],
      { detached: true, windowsHide: true, stdio: 'ignore' },
    );
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  app.quit();
}
class SignedInstallerEngine extends EventEmitter implements UpdateEngine {
  private installer: string | null = null;
  constructor(
    private updater: NsisUpdater,
    private publisher: string,
  ) {
    super();
    updater.on('download-progress', value => this.emit('download-progress', value));
    updater.on('error', error => this.emit('error', error));
  }
  checkForUpdates() {
    return this.updater.checkForUpdates();
  }
  async downloadUpdate() {
    const files = await this.updater.downloadUpdate();
    this.installer = files.length === 1 ? files[0] : null;
    return files;
  }
  async quitAndInstall() {
    if (!this.installer) throw new Error('Verified installer not downloaded');
    if (await this.updater.verifyUpdateCodeSignature([this.publisher], this.installer))
      throw new Error('تغير ملف المثبّت أو توقيعه؛ أُلغيت عملية التثبيت.');
    // Per-user NSIS update: await a successful process spawn before quitting.
    // The updater's default quitAndInstall can quit before an async spawn error arrives.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.installer!,
        [
          '--updated',
          '/S',
          '--force-run',
          '/currentuser',
          `/D=${path.dirname(app.getPath('exe'))}`,
        ],
        { detached: true, windowsHide: true, stdio: 'ignore' },
      );
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    app.quit();
  }
}
export async function createUpdates(closeTv: () => Promise<void>) {
  const policy = app.isPackaged
    ? z
        .object({ feedUrl: z.string().max(500), publisher: z.string().max(200) })
        .strict()
        .parse(JSON.parse(await readFile(path.join(__dirname, 'update-policy.json'), 'utf8')))
    : { feedUrl: '', publisher: '' };
  let engine: SignedInstallerEngine | SignedReleaseEngine | null = null;
  let updater: NsisUpdater | null = null;
  if (app.isPackaged && process.platform === 'win32' && policy.feedUrl && policy.publisher) {
    const url = new URL(policy.feedUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error('Invalid packaged update policy');
    updater = new NsisUpdater({ provider: 'generic', url: url.href });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.logger = null;
    engine = new SignedInstallerEngine(updater, policy.publisher);
  }
  if (!engine && app.isPackaged && process.platform === 'win32') {
    engine = new SignedReleaseEngine({
      publicKey: queueReleasePublicKey,
      latest: () => request('GET', '/v1/update-release'),
      download: downloadRelease,
      install: launchInstaller,
    });
  }
  const file = path.join(app.getPath('userData'), 'update-preferences.json');
  let preferences: z.infer<typeof preferencesSchema> = empty;
  try {
    preferences = preferencesSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Invalid saved update preferences');
  }
  return new UpdateController({
    currentVersion: app.getVersion(),
    engine,
    preferences,
    isManager: () => connectionInfo().role === 'manager',
    save: async value => {
      const temp = file + '.' + randomUUID() + '.tmp';
      await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      await rename(temp, file);
    },
    verify: async installer => {
      if (engine instanceof SignedReleaseEngine) return engine.verify(installer);
      if (!updater || !policy.publisher) throw new Error('Signed update source unavailable');
      const error = await updater.verifyUpdateCodeSignature([policy.publisher], installer);
      if (error) throw new Error('تعذر التحقق من توقيع الناشر. لن يُثبت هذا الملف.');
    },
    prepareInstall: async () => {
      const origin = connectionInfo().url;
      const snapshot = snapshotSchema.parse(await request('GET', '/v1/snapshot'));
      if (snapshot.actor.role !== 'manager') throw new Error('Manager authorization required');
      if (snapshot.active.length || snapshot.totals.waiting)
        throw new Error('أغلق جميع التذاكر المفتوحة قبل تثبيت التحديث.');
      const owned = await ownsConnectedHost(snapshot.branchId);
      const hostAlive = owned ? await ownedHostProcess(snapshot.branchId) : null;
      // Revoke the companion display before the maintenance write lock and backup.
      await closeTv();
      const lease = z
        .object({ token: z.string().regex(/^[a-f0-9]{64}$/), until: z.string().datetime() })
        .strict()
        .parse(await request('POST', '/v1/maintenance/start', {}));
      let stopped = false;
      const recover = async () => {
        if (stopped) await startSavedHost();
        else if (connectionInfo().url === origin)
          await request('POST', '/v1/maintenance/end', { token: lease.token });
      };
      try {
        const backup = backupSummarySchema.parse(await request('POST', '/v1/backups', {}, 120000));
        await request(
          'POST',
          '/v1/operations',
          { action: 'verify_backup', filename: backup.filename },
          120000,
        );
        if (connectionInfo().url !== origin || Date.now() >= Date.parse(lease.until))
          throw new Error('تغير الاتصال أو انتهت مهلة الصيانة.');
        const fresh = snapshotSchema.parse(await request('GET', '/v1/snapshot'));
        if (
          fresh.branchId !== snapshot.branchId ||
          fresh.actor.id !== snapshot.actor.id ||
          fresh.actor.role !== 'manager'
        )
          throw new Error('تغير مدير الفرع.');
        if (owned) {
          await request('POST', '/v1/shutdown', { token: lease.token });
          stopped = true;
          await waitForHostExit(hostAlive!, delay);
        } else await request('POST', '/v1/maintenance/end', { token: lease.token });
        return recover;
      } catch (e) {
        await recover().catch(() => {});
        throw e;
      }
    },
  });
}
