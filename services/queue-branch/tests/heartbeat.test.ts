import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { inboxSchema, receiveEvents, receiveHeartbeat } from '@saraf/queue-core/receiver';
import { QueueStore } from '../src/store';
it('records branch liveness without fake queue events and detects a restored-behind branch', async () => {
  const central = new PGlite(),
    store = await QueueStore.open('memory://', randomUUID());
  try {
    await central.exec(inboxSchema);
    const ping = {
      version: 1 as const,
      kind: 'heartbeat' as const,
      branchId: store.branchId,
      localRevision: 0,
    };
    expect(await receiveHeartbeat(central, ping, store.branchId)).toEqual({
      acknowledgedThrough: 0,
    });
    expect(
      (
        await central.query<{ last_heartbeat_at: Date }>(
          'SELECT last_heartbeat_at FROM queue_sync_branches',
        )
      ).rows[0].last_heartbeat_at,
    ).not.toBeNull();
    expect((await central.query('SELECT sequence FROM queue_sync_events')).rows).toHaveLength(0);
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
    await receiveEvents(central, await store.pending(), store.branchId);
    await expect(receiveHeartbeat(central, ping, store.branchId)).rejects.toThrow('behind');
    await expect(receiveHeartbeat(central, ping, randomUUID())).rejects.toThrow('Wrong branch');
  } finally {
    await central.close();
    await store.close();
  }
}, 30000);
