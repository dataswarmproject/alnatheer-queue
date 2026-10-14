import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { businessDay } from '@saraf/queue-core';
import { backupSummarySchema } from '@saraf/queue-core/server';
import { createBackup } from './backups';
import type { QueueStore } from './store';
export function startBackups(store: QueueStore, directory?: string) {
  if (!directory) return async () => {};
  let stopped = false,
    active: Promise<void> | undefined,
    lastDay = '';
  const run = () => {
    if (stopped || active || lastDay === businessDay()) return;
    const day = businessDay();
    active = (async () => {
      await mkdir(directory, { recursive: true });
      const receipt = path.join(directory, `daily-${store.branchId}-${day}.json`);
      let present = false;
      try {
        const saved = backupSummarySchema.parse(JSON.parse(await readFile(receipt, 'utf8')));
        present =
          saved.branchId === store.branchId &&
          (await stat(path.join(directory, path.basename(saved.filename)))).size ===
            saved.sizeBytes;
      } catch {}
      if (!present) {
        const backup = await createBackup(store, directory);
        await store.db.query('UPDATE queue_meta SET last_backup=$1', [JSON.stringify(backup)]);
        await writeFile(receipt, JSON.stringify(backup), { mode: 0o600 });
      }
      lastDay = day;
    })()
      .catch(() => {
        console.error('Daily queue backup failed; retry pending.');
      })
      .finally(() => {
        active = undefined;
      });
  };
  const timer = setInterval(run, 60000);
  timer.unref();
  run();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
}
