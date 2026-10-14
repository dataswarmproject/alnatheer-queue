import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { QueueStore } from '../src/store';
import { createBackup, restoreBackup } from '../src/backups';
it('restores tickets, device authorization and unsynced history into a new folder without changing the source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saraf-queue-backup-test-')),
    branchId = randomUUID();
  let store = await QueueStore.open(path.join(root, 'source'), branchId),
    restored: QueueStore | undefined;
  try {
    const manager = await store.provision('manager', null),
      serviceId = randomUUID();
    await store.configure(manager, {
      services: [{ id: serviceId, name: 'TEST ONLY', prefix: 'A', active: true }],
      counters: [
        {
          id: randomUUID(),
          name: 'TEST COUNTER',
          serviceIds: [serviceId],
          paused: false,
          revision: 0,
        },
      ],
    });
    const ticket = await store.command(manager, {
      requestId: randomUUID(),
      action: 'issue',
      serviceId,
    });
    const before = await store.pending(),
      backup = await createBackup(store, path.join(root, 'backups'));
    await expect(createBackup(store, path.join(root, 'source', 'backups'))).rejects.toThrow(
      'outside',
    );
    expect(backup.sizeBytes).toBeGreaterThan(0);
    const archive = path.join(root, 'backups', backup.filename);
    await expect(restoreBackup(archive, path.join(root, 'source'), branchId)).rejects.toThrow(
      'new directory',
    );
    await restoreBackup(archive, path.join(root, 'restored'), branchId);
    restored = await QueueStore.open(path.join(root, 'restored'), branchId);
    const actor = await restored.authenticate(manager.token);
    expect((await restored.snapshot(actor)).waiting[0].id).toBe(ticket.ticket!.id);
    expect(await restored.pending()).toEqual(before);
    expect(await store.pending()).toEqual(before);
    const bytes = await readFile(archive);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(archive, bytes);
    await expect(restoreBackup(archive, path.join(root, 'corrupt'), branchId)).rejects.toThrow(
      'checksum',
    );
  } finally {
    await restored?.close();
    await store.close();
    if (
      path.dirname(root) === path.resolve(os.tmpdir()) &&
      path.basename(root).startsWith('saraf-queue-backup-test-')
    )
      await rm(root, { recursive: true, force: true });
  }
}, 60000);
