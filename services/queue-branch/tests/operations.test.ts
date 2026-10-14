import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { QueueStore } from '../src/store';
import { createOperations } from '../src/operations';
import { createBranchServer } from '../src/http';

describe('branch operations', () => {
  it('keeps sync keys private, verifies/restores backups independently, locks writes for maintenance and enforces manager access', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'queue-ops-test-'));
    const store = await QueueStore.open(path.join(root, 'data'), randomUUID());
    const manager = await store.provision('manager', null),
      kiosk = await store.provision('kiosk', null),
      serviceId = randomUUID();
    await store.configure(manager, {
      services: [{ id: serviceId, name: 'TEST exchange', prefix: 'A', active: true }],
      counters: [
        { id: randomUUID(), name: 'كاونتر 1', serviceIds: [serviceId], paused: false, revision: 0 },
      ],
    });
    const ops = await createOperations(store, { root });
    const server = createBranchServer(store, {
      operations: ops,
      backupDirectory: path.join(root, 'backups'),
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const request = (actor: typeof manager, route: string, method = 'GET', body?: unknown) =>
      fetch(url + route, {
        method,
        headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    try {
      await ops.save({
        syncEnabled: false,
        syncUrl: '',
        syncKey: 'a'.repeat(64),
        dailyBackups: false,
        dailyReports: false,
      });
      const status = await ops.status();
      expect(status.settings.hasSyncKey).toBe(true);
      expect(JSON.stringify(status)).not.toContain('a'.repeat(64));
      expect((await request(kiosk, '/v1/operations')).status).toBe(403);
      expect((await request(kiosk, '/v1/maintenance/start', 'POST', {})).status).toBe(403);
      const check = await ops.run(manager, { action: 'database_check' });
      expect(check.invalidActiveTickets).toBe(0);
      expect(check.tables?.find(t => t.name === 'queue_counters')?.rows).toBe(1);
      const backup = await (await request(manager, '/v1/backups', 'POST', {})).json();
      expect(backup.sizeBytes).toBeGreaterThan(0);
      await ops.run(manager, { action: 'verify_backup', filename: backup.filename });
      const restored = await ops.run(manager, {
        action: 'restore_backup',
        filename: backup.filename,
      });
      expect(restored.directory).not.toBe(store.dataDirectory);
      expect(path.dirname(restored.directory!)).toBe(path.join(root, 'restores'));
      const probe = await QueueStore.open(restored.directory!, store.branchId);
      try {
        expect((await probe.snapshot(manager)).counters).toHaveLength(1);
      } finally {
        await probe.close();
      }
      const lease = await store.enterMaintenance(manager);
      await expect(
        store.command(kiosk, { action: 'issue', requestId: randomUUID(), serviceId }),
      ).rejects.toMatchObject({ code: 'MAINTENANCE' });
      await expect(store.leaveMaintenance(kiosk, lease.token)).rejects.toMatchObject({
        status: 403,
      });
      await store.leaveMaintenance(manager, lease.token);
      await ops.run(manager, { action: 'database_maintenance' });
      await store.command(kiosk, { action: 'issue', requestId: randomUUID(), serviceId });
      await expect(store.enterMaintenance(manager)).rejects.toMatchObject({
        code: 'ACTIVE_TICKETS',
      });
      expect((await store.snapshot(manager)).waiting).toHaveLength(1);
      const archive = path.join(root, 'backups', backup.filename),
        bytes = await readFile(archive);
      bytes[10] ^= 1;
      await writeFile(archive, bytes);
      await expect(
        ops.run(manager, { action: 'verify_backup', filename: backup.filename }),
      ).rejects.toMatchObject({ code: 'BACKUP_CHECKSUM' });
      await expect(
        ops.run(manager, { action: 'restore_backup', filename: '../../elsewhere' }),
      ).rejects.toMatchObject({ code: 'BACKUP_FILE' });
      await expect(
        ops.save({
          syncEnabled: true,
          syncUrl: 'http://example.com',
          dailyBackups: false,
          dailyReports: false,
        }),
      ).rejects.toThrow();
    } finally {
      await ops.stop();
      await new Promise<void>(r => server.close(() => r()));
      await store.close();
      if (
        path.dirname(root) === path.resolve(os.tmpdir()) &&
        path.basename(root).startsWith('queue-ops-test-')
      )
        await rm(root, { recursive: true, force: true });
    }
  }, 60000);
});
