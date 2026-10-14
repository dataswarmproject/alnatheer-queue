import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { businessDay, type Actor } from '@saraf/queue-core';
import { branchAnalytics } from './analytics';
import type { QueueStore } from './store';

export async function writeDailyReport(store: QueueStore, directory: string, day: string) {
  const actor = (
    await store.db.query<Actor>(
      'SELECT id,role,counter_id AS "counterId" FROM queue_devices WHERE role=\'manager\' AND enabled ORDER BY id LIMIT 1',
    )
  ).rows[0];
  if (!actor) throw new Error('Provision a branch manager before enabling reports');
  const from = new Date(`${day}T00:00:00+03:00`),
    to = new Date(from.getTime() + 86400000);
  const report = await branchAnalytics(store, actor, from.toISOString(), to.toISOString());
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `queue-performance-${store.branchId}-${day}.json`);
  try {
    await writeFile(file, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return file;
}
export function startReports(store: QueueStore, directory?: string) {
  if (!directory) return async () => {};
  let busy = false,
    lastDay = '',
    active: Promise<void> | undefined;
  const run = async () => {
    const today = businessDay();
    if (busy || lastDay === today) return;
    busy = true;
    // The completed Riyadh business day is exported after midnight, including after restart.
    const yesterday = businessDay(new Date(Date.parse(`${today}T00:00:00+03:00`) - 1));
    try {
      await writeDailyReport(store, directory, yesterday);
      lastDay = today;
    } catch {
      console.error('Daily queue report failed; retry pending.');
    } finally {
      busy = false;
    }
  };
  const launch = () => {
    if (!busy) active = run();
  };
  const timer = setInterval(launch, 60000);
  timer.unref();
  launch();
  return async () => {
    clearInterval(timer);
    await active;
  };
}
