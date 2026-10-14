import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { QueueStore } from '../src/store';
import { receiveEvents, inboxSchema } from '../../../packages/queue-core/src/receiver';
import { synchronize } from '../src/sync';
import type { Actor } from '@saraf/queue-core';

describe('durable branch-to-headquarters sync', () => {
  let local: QueueStore,
    central: PGlite,
    manager: Actor,
    batch: Awaited<ReturnType<QueueStore['pending']>>;
  beforeAll(async () => {
    local = await QueueStore.open('memory://', randomUUID());
    central = new PGlite();
    await central.exec(inboxSchema);
    manager = await local.provision('manager', null);
    const serviceId = randomUUID();
    await local.configure(manager, {
      services: [{ id: serviceId, name: 'الصرافة', prefix: 'A', active: true }],
      counters: [
        { id: randomUUID(), name: '١', serviceIds: [serviceId], paused: false, revision: 0 },
      ],
    });
    await local.command(manager, { requestId: randomUUID(), action: 'issue', serviceId });
    batch = await local.pending();
  }, 30000);
  afterAll(async () => {
    await local?.close();
    await central?.close();
  });
  it('leaves events pending on a failed network request', async () => {
    await expect(
      synchronize(local, 'http://127.0.0.1:1/api/queue/sync', 'x'.repeat(64)),
    ).rejects.toThrow();
    expect((await local.pending()).events).toEqual(batch.events);
  });
  it('accepts identical retry batches without duplicate central records', async () => {
    const first = await receiveEvents(central, batch, local.branchId);
    expect(await receiveEvents(central, batch, local.branchId)).toEqual(first);
    expect(
      (
        await central.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM queue_sync_events',
        )
      ).rows[0].count,
    ).toBe(batch.events.length);
    await local.acknowledge(first.acknowledgedThrough);
    expect((await local.pending()).events).toEqual([]);
  });
  it('rejects branch spoofing, changed history and sequence gaps atomically', async () => {
    await expect(receiveEvents(central, batch, randomUUID())).rejects.toThrow();
    const altered = structuredClone(batch);
    altered.events[0].actorId = randomUUID();
    await expect(receiveEvents(central, altered, local.branchId)).rejects.toThrow();
    const branchId = randomUUID();
    const event = { ...batch.events[0], id: randomUUID(), branchId, sequence: 2 };
    await expect(
      receiveEvents(central, { version: 1, branchId, events: [event] }, branchId),
    ).rejects.toThrow();
    expect(
      (await central.query('SELECT * FROM queue_sync_branches WHERE branch_id=$1', [branchId]))
        .rows,
    ).toEqual([]);
  });
  it('acknowledges only a replayed batch even after later events reached central', async () => {
    const serviceId = batch.events[0].payload.configuration!.services[0].id;
    await local.command(manager, { requestId: randomUUID(), action: 'issue', serviceId });
    await receiveEvents(central, await local.pending(), local.branchId);
    expect((await receiveEvents(central, batch, local.branchId)).acknowledgedThrough).toBe(
      batch.events.at(-1)!.sequence,
    );
  });
});
