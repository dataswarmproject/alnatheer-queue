import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, lstat, realpath } from 'node:fs/promises';
import { QueueError, trustedEndpoint, type Actor } from '@saraf/queue-core';
import { backupSummarySchema } from '@saraf/queue-core/server';
import {
  operationsSettingsSchema,
  operationSchema,
  type OperationsSettings,
  type OperationResult,
} from '@saraf/queue-core/operations';
import type { QueueStore } from './store';
import { synchronize, startSync } from './sync';
import { startReports } from './reports';
import { startBackups } from './backup-worker';
import { createBackup, restoreBackup } from './backups';

export async function createOperations(
  store: QueueStore,
  options: {
    root: string;
    backupDirectory?: string;
    reportDirectory?: string;
    syncUrl?: string;
    syncKey?: string;
  },
) {
  const root = path.resolve(options.root),
    backupDirectory = path.resolve(options.backupDirectory ?? path.join(root, 'backups')),
    reportDirectory = path.resolve(options.reportDirectory ?? path.join(root, 'reports'));
  await mkdir(root, { recursive: true });
  const configFile = path.join(root, 'operations.json');
  let settings: OperationsSettings = {
    syncEnabled: !!options.syncUrl,
    syncUrl: options.syncUrl ?? '',
    ...(options.syncKey ? { syncKey: options.syncKey } : {}),
    dailyBackups: true,
    dailyReports: true,
  };
  try {
    settings = operationsSettingsSchema.parse(JSON.parse(await readFile(configFile, 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new QueueError('OPERATIONS_CONFIG', 'إعدادات تشغيل الفرع غير صالحة. لم تُستبدل.', 500);
  }
  const validate = (value: OperationsSettings) => {
    if (value.syncUrl) trustedEndpoint(value.syncUrl);
    if (value.syncEnabled && (!value.syncUrl || !value.syncKey))
      throw new QueueError('SYNC_CONFIG', 'أدخل عنوان المركز ومفتاح ربط الفرع.', 400);
  };
  validate(settings);
  let stopSync = async () => {},
    stopReports = async () => {},
    stopBackups = async () => {},
    busy = false,
    stopping = false;
  let active = Promise.resolve(),
    finish = () => {};
  const begin = () => {
    if (stopping) throw new QueueError('STOPPING', 'خادم الفرع يتوقف.', 503);
    if (busy) throw new QueueError('BUSY', 'عملية تشغيل أخرى جارية.');
    busy = true;
    active = new Promise<void>(resolve => {
      finish = resolve;
    });
  };
  const end = () => {
    busy = false;
    finish();
  };
  const start = () => {
    if (stopping) return;
    stopSync = startSync(
      store,
      settings.syncEnabled ? settings.syncUrl : undefined,
      settings.syncKey,
    );
    stopReports = startReports(store, settings.dailyReports ? reportDirectory : undefined);
    stopBackups = startBackups(store, settings.dailyBackups ? backupDirectory : undefined);
  };
  const stopWorkers = async () => {
    await Promise.all([stopSync(), stopReports(), stopBackups()]);
  };
  const stop = async () => {
    stopping = true;
    await active;
    await stopWorkers();
  };
  const backups = async () => {
    await mkdir(backupDirectory, { recursive: true });
    const names = (await readdir(backupDirectory))
      .filter(
        n => n.startsWith(`queue-${store.branchId}-`) && n.endsWith('.pgdata.tar.gz.manifest.json'),
      )
      .slice(-5000);
    const result = [];
    for (const name of names) {
      try {
        const file = path.join(backupDirectory, name);
        const info = await lstat(file);
        if (!info.isFile() || info.size > 4096) continue;
        const value = backupSummarySchema.parse(JSON.parse(await readFile(file, 'utf8')));
        if (value.branchId === store.branchId && value.filename + '.manifest.json' === name)
          result.push(value);
      } catch {}
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  };
  const verify = async (filename: string) => {
    if (!new RegExp(`^queue-${store.branchId}-[a-f0-9-]{36}\\.pgdata\\.tar\\.gz$`).test(filename))
      throw new QueueError('BACKUP_FILE', 'اختر نسخة الفرع من القائمة.', 400);
    const file = path.join(backupDirectory, filename),
      info = await lstat(file),
      meta = await lstat(file + '.manifest.json');
    if (!info.isFile() || !meta.isFile() || meta.size > 4096 || info.size > 512 * 1024 * 1024)
      throw new QueueError('BACKUP_FILE', 'ملفات النسخة غير صالحة.', 400);
    const base = await realpath(backupDirectory),
      resolved = await realpath(file);
    if (path.dirname(resolved) !== base)
      throw new QueueError('BACKUP_FILE', 'مسار النسخة غير صالح.', 400);
    const manifest = backupSummarySchema.parse(
      JSON.parse(await readFile(file + '.manifest.json', 'utf8')),
    );
    const bytes = await readFile(file);
    if (
      manifest.branchId !== store.branchId ||
      manifest.filename !== filename ||
      manifest.sizeBytes !== bytes.length ||
      manifest.sha256 !== createHash('sha256').update(bytes).digest('hex')
    )
      throw new QueueError('BACKUP_CHECKSUM', 'تعذر التحقق من النسخة. لا تستخدمها للاستعادة.', 400);
    return file;
  };
  start();
  return {
    syncConfigured: () => settings.syncEnabled && !!settings.syncUrl && !!settings.syncKey,
    reportsConfigured: () => settings.dailyReports,
    status: async () => ({
      settings: {
        syncEnabled: settings.syncEnabled,
        syncUrl: settings.syncUrl,
        hasSyncKey: !!settings.syncKey,
        dailyBackups: settings.dailyBackups,
        dailyReports: settings.dailyReports,
      },
      databaseDirectory: store.dataDirectory,
      backupDirectory,
      reportDirectory,
      backups: await backups(),
    }),
    save: async (input: unknown) => {
      begin();
      try {
        const incoming = operationsSettingsSchema.parse(input),
          value = { ...settings, ...incoming };
        validate(value);
        const temp = configFile + '.' + randomUUID() + '.tmp';
        await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
        await rename(temp, configFile);
        await stopWorkers();
        settings = value;
        start();
      } finally {
        end();
      }
    },
    run: async (actor: Actor, input: unknown): Promise<OperationResult> => {
      const operation = operationSchema.parse(input);
      begin();
      try {
        if (operation.action === 'sync_now') {
          if (!settings.syncEnabled || !settings.syncKey)
            throw new QueueError('SYNC_CONFIG', 'فعّل ربط المركز أولًا.');
          await stopSync();
          try {
            await synchronize(store, settings.syncUrl, settings.syncKey);
          } catch (e) {
            await store.syncAttempt(e instanceof QueueError ? e.code : 'NETWORK');
            throw e;
          } finally {
            if (!stopping) stopSync = startSync(store, settings.syncUrl, settings.syncKey);
          }
          return { message: 'تمت مزامنة دفعة مؤكدة. يستمر إرسال الأحداث المتبقية في الخلفية.' };
        }
        if (operation.action === 'verify_backup') {
          await verify(operation.filename);
          return { message: 'النسخة سليمة: تحقق حجم الملف ومعرّف الفرع وبصمة SHA-256.' };
        }
        if (operation.action === 'restore_backup') {
          const file = await verify(operation.filename),
            parent = path.join(root, 'restores');
          await mkdir(parent, { recursive: true });
          const directory = path.join(parent, randomUUID());
          await restoreBackup(file, directory, store.branchId);
          return {
            message:
              'استُعيدت نسخة متحققة في قاعدة منفصلة. قاعدة الخدمة الحالية لم تتغير؛ لا توصلها بالمركز قبل مطابقة سجل المزامنة.',
            directory,
          };
        }
        if (operation.action === 'database_maintenance') {
          const lease = await store.enterMaintenance(actor);
          try {
            const backup = await createBackup(store, backupDirectory);
            await store.db.query('UPDATE queue_meta SET last_backup=$1', [JSON.stringify(backup)]);
            await store.db.exec('VACUUM ANALYZE');
          } finally {
            await store.leaveMaintenance(actor, lease.token);
          }
          return { message: 'اكتملت صيانة القاعدة بعد إنشاء نسخة متحققة. لم تُحذف سجلات الخدمة.' };
        }
        const names = [
          'queue_services',
          'queue_counters',
          'queue_devices',
          'queue_tickets',
          'queue_events',
          'queue_receipts',
        ];
        const tables = [];
        for (const name of names)
          tables.push({
            name,
            rows: (
              await store.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${name}`)
            ).rows[0].count,
          });
        const invalidActiveTickets = (
          await store.db.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM queue_tickets t LEFT JOIN queue_counters c ON c.id=t.counter_id WHERE t.status IN ('called','serving') AND (c.id IS NULL OR COALESCE((c.body->>'archived')::boolean,false))",
          )
        ).rows[0].count;
        let bytes: number | null = null;
        try {
          bytes = (
            await store.db.query<{ bytes: number }>(
              'SELECT pg_database_size(current_database())::float8 AS bytes',
            )
          ).rows[0].bytes;
        } catch {}
        return {
          message: invalidActiveTickets
            ? 'توجد تذاكر نشطة تحتاج مراجعة ربط الكاونترات.'
            : 'فحص القاعدة سليم؛ لا توجد تذاكر نشطة دون كاونتر صالح.',
          tables,
          invalidActiveTickets,
          bytes,
        };
      } finally {
        end();
      }
    },
    stop,
    releaseSource: () => {
      if (stopping || !settings.syncUrl || !settings.syncKey)
        throw new QueueError('UPDATE_SOURCE', 'ربط تحديثات المركز غير مهيأ.', 503);
      return { url: settings.syncUrl, key: settings.syncKey };
    },
  };
}
export type BranchOperations = Awaited<ReturnType<typeof createOperations>>;
