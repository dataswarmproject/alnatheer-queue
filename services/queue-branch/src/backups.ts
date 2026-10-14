import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { z } from 'zod';
import { id, QueueError } from '@saraf/queue-core';
import type { QueueStore } from './store';
const manifestSchema = z
  .object({
    version: z.literal(1),
    engine: z.literal('pglite'),
    engineVersion: z.literal('0.5.9'),
    branchId: id,
    filename: z.string().max(160),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
  })
  .strict();
const running = new WeakMap<QueueStore, Promise<z.infer<typeof manifestSchema>>>();
export async function createBackup(store: QueueStore, directory: string) {
  const existing = running.get(store);
  if (existing) return existing;
  const task = writeBackup(store, directory);
  running.set(store, task);
  try {
    return await task;
  } finally {
    running.delete(store);
  }
}
async function writeBackup(store: QueueStore, directory: string) {
  const target = path.resolve(directory);
  if (store.dataDirectory !== 'memory://') {
    const relative = path.relative(path.resolve(store.dataDirectory), target);
    if (
      !relative ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    )
      throw new QueueError('BACKUP_PATH', 'Store backups outside the live database directory', 400);
  }
  await mkdir(target, { recursive: true });
  const archive = await store.db.dumpDataDir('gzip');
  if (!archive.size) throw new QueueError('BACKUP_EMPTY', 'Database backup was empty', 500);
  const createdAt = new Date().toISOString(),
    filename = `queue-${store.branchId}-${randomUUID()}.pgdata.tar.gz`;
  const bytes = Buffer.from(await archive.arrayBuffer()),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  const file = path.join(target, filename);
  await writeFile(file + '.partial', bytes, { flag: 'wx', mode: 0o600 });
  await rename(file + '.partial', file);
  const manifest = manifestSchema.parse({
    version: 1,
    engine: 'pglite',
    engineVersion: '0.5.9',
    branchId: store.branchId,
    filename,
    sizeBytes: bytes.length,
    sha256,
    createdAt,
  });
  await writeFile(file + '.manifest.json', JSON.stringify(manifest, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  return manifest;
}
export async function restoreBackup(archive: string, directory: string, branchId: string) {
  id.parse(branchId);
  const file = path.resolve(archive),
    target = path.resolve(directory);
  const metadata = await stat(file + '.manifest.json');
  if (metadata.size > 4096) throw new Error('Invalid backup manifest');
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(file + '.manifest.json', 'utf8')),
  );
  if (manifest.branchId !== branchId || manifest.filename !== path.basename(file))
    throw new Error('Backup branch or filename does not match');
  const info = await stat(file);
  if (info.size !== manifest.sizeBytes || info.size > 512 * 1024 * 1024)
    throw new Error('Invalid backup size');
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256)
    throw new Error('Backup checksum does not match');
  try {
    await mkdir(target, { recursive: false });
  } catch {
    throw new Error('Restore requires a new directory; existing data is preserved');
  }
  const restored = await PGlite.create({ dataDir: target, loadDataDir: new Blob([bytes]) });
  try {
    const actual = (await restored.query<{ branch_id: string }>('SELECT branch_id FROM queue_meta'))
      .rows[0];
    if (actual?.branch_id !== branchId) throw new Error('Restored database branch does not match');
  } finally {
    await restored.close();
  }
  // A dump includes the source process lock. Only discard that imported lock in
  // this newly created target, after validation; no host has opened it yet.
  await unlink(path.join(target, '.queue-host.lock')).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  return manifest;
}
