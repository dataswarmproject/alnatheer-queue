import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
vi.mock('../src/sync', () => ({
  startSync: vi.fn(() => async () => {}),
  synchronize: vi.fn(async () => {}),
}));
vi.mock('../src/reports', () => ({ startReports: vi.fn(() => async () => {}) }));
vi.mock('../src/backup-worker', () => ({ startBackups: vi.fn(() => async () => {}) }));
import { startSync, synchronize } from '../src/sync';
import { startReports } from '../src/reports';
import { QueueStore } from '../src/store';
import { createOperations } from '../src/operations';
describe('terminal operations shutdown', () => {
  it('drains an active manual sync and never restarts workers after stop', async () => {
    vi.clearAllMocks();
    const root = await mkdtemp(path.join(os.tmpdir(), 'queue-ops-life-')),
      store = await QueueStore.open('memory://', randomUUID());
    let ops: Awaited<ReturnType<typeof createOperations>> | undefined;
    try {
      const manager = await store.provision('manager', null);
      ops = await createOperations(store, {
        root,
        syncUrl: 'http://127.0.0.1:1/api/queue/sync',
        syncKey: 'a'.repeat(64),
      });
      let release!: () => void;
      vi.mocked(synchronize).mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            release = resolve;
          }),
      );
      const syncing = ops.run(manager, { action: 'sync_now' });
      await vi.waitFor(() => expect(synchronize).toHaveBeenCalled());
      let stopped = false;
      const stopping = ops.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      await expect(ops.run(manager, { action: 'database_check' })).rejects.toMatchObject({
        code: 'STOPPING',
      });
      release();
      await syncing;
      await stopping;
      expect(startSync).toHaveBeenCalledTimes(1);
    } finally {
      await ops?.stop();
      await store.close();
      if (
        path.dirname(root) === path.resolve(os.tmpdir()) &&
        path.basename(root).startsWith('queue-ops-life-')
      )
        await rm(root, { recursive: true, force: true });
    }
  }, 30000);
  it('drains a settings change already stopping workers without starting new ones', async () => {
    vi.clearAllMocks();
    const root = await mkdtemp(path.join(os.tmpdir(), 'queue-ops-life-')),
      store = await QueueStore.open('memory://', randomUUID());
    let ops: Awaited<ReturnType<typeof createOperations>> | undefined;
    let release!: () => void;
    const workerStop = vi.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    vi.mocked(startReports).mockReturnValueOnce(workerStop);
    try {
      ops = await createOperations(store, { root });
      const saving = ops.save({
        syncEnabled: false,
        syncUrl: '',
        dailyBackups: false,
        dailyReports: false,
      });
      await vi.waitFor(() => expect(workerStop).toHaveBeenCalled());
      const stopping = ops.stop();
      release();
      await saving;
      await vi.waitFor(() => expect(workerStop).toHaveBeenCalledTimes(2));
      release();
      await stopping;
      expect(startSync).toHaveBeenCalledTimes(1);
    } finally {
      await store.close();
      if (
        path.dirname(root) === path.resolve(os.tmpdir()) &&
        path.basename(root).startsWith('queue-ops-life-')
      )
        await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
