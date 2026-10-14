import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { inboxSchema, receiveEvents, receiveHeartbeat } from '@saraf/queue-core/receiver';
import { batchSchema, heartbeatSchema } from '@saraf/queue-core';
import { QueueStore } from '../src/store';
import { synchronize } from '../src/sync';

it('replays retained events after HQ restore using real HTTP heartbeat and catches up projections', async () => {
  const local = await QueueStore.open('memory://', randomUUID()),
    central = new PGlite();
  await central.exec(inboxSchema);
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      const ack =
        payload.kind === 'heartbeat'
          ? await receiveHeartbeat(central, heartbeatSchema.parse(payload), local.branchId)
          : await receiveEvents(central, batchSchema.parse(payload), local.branchId);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(ack));
    } catch {
      res.writeHead(409);
      res.end();
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/queue/sync`;
  try {
    const manager = await local.provision('manager', null),
      serviceId = randomUUID();
    await local.configure(manager, {
      services: [{ id: serviceId, name: 'TEST', prefix: 'A', active: true }],
      counters: [
        { id: randomUUID(), name: 'TEST', serviceIds: [serviceId], paused: false, revision: 0 },
      ],
    });
    await local.command(manager, { action: 'issue', requestId: randomUUID(), serviceId });
    await synchronize(local, url, 'TEST-ONLY');
    expect((await local.pending()).events).toHaveLength(0);
    await central.exec(
      'TRUNCATE queue_sync_tickets,queue_sync_counters,queue_sync_events,queue_sync_branches',
    );
    await synchronize(local, url, 'TEST-ONLY'); // Heartbeat tells branch that HQ has rolled back.
    expect((await local.pending()).events).toHaveLength(2);
    await synchronize(local, url, 'TEST-ONLY');
    expect((await local.pending()).events).toHaveLength(0);
    expect((await central.query('SELECT * FROM queue_sync_tickets')).rows).toHaveLength(1);
    await synchronize(local, url, 'TEST-ONLY');
    expect((await central.query('SELECT * FROM queue_sync_events')).rows).toHaveLength(2);
  } finally {
    await new Promise<void>(r => server.close(() => r()));
    await local.close();
    await central.close();
  }
}, 30000);

it('bounds large configuration bursts by serialized bytes without losing events', async () => {
  const local = await QueueStore.open('memory://', randomUUID());
  try {
    const manager = await local.provision('manager', null);
    const services = Array.from({ length: 20 }, (_, i) => ({
      id: randomUUID(),
      name: 'خ'.repeat(80),
      prefix: String.fromCharCode(65 + i),
      active: true,
    }));
    const counters = Array.from({ length: 6 }, () => ({
      id: randomUUID(),
      name: 'خ'.repeat(80),
      serviceIds: services.map(s => s.id),
      paused: false,
      revision: 0,
    }));
    for (let i = 0; i < 30; i++) await local.configure(manager, { services, counters });
    const first = await local.pending();
    expect(first.events.length).toBeGreaterThan(0);
    expect(first.events.length).toBeLessThan(30);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(240000);
    await local.acknowledge(first.events.at(-1)!.sequence);
    const next = await local.pending();
    expect(next.events[0].sequence).toBe(first.events.at(-1)!.sequence + 1);
    expect(first.events.length + next.events.length).toBe(30);
  } finally {
    await local.close();
  }
}, 30000);
