import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { QueueStore } from '../src/store';
import { synchronize } from '../src/sync';
import { branchAnalytics } from '../src/analytics';
import { writeDailyReport } from '../src/reports';
import { receiveEvents, inboxSchema } from '@saraf/queue-core/receiver';
import { loadQueueAnalytics } from '@saraf/queue-core/analytics-evidence';
import { eventSchema, businessDay } from '@saraf/queue-core';
import { readHeadquartersState } from '@saraf/queue-core/headquarters';

it('synchronizes over real HTTP and produces identical branch and HQ analytics', async () => {
  const local = await QueueStore.open('memory://', randomUUID()),
    central = new PGlite();
  const token = 'a'.repeat(64);
  await central.exec(inboxSchema);
  const server = createServer(async (req, res) => {
    try {
      expect(req.headers.authorization).toBe(`Bearer ${token}`);
      expect(req.headers['x-queue-branch']).toBe(local.branchId);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const ack = await receiveEvents(
        central,
        JSON.parse(Buffer.concat(chunks).toString()),
        local.branchId,
      );
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(ack));
    } catch {
      res.statusCode = 400;
      res.end('{}');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const manager = await local.provision('manager', null),
      serviceId = randomUUID(),
      counterId = randomUUID();
    await local.configure(manager, {
      services: [{ id: serviceId, name: 'TEST ONLY', prefix: 'A', active: true }],
      counters: [
        {
          id: counterId,
          name: 'TEST COUNTER',
          serviceIds: [serviceId],
          paused: false,
          revision: 0,
        },
      ],
    });
    const teller = await local.provision('teller', counterId, {
      name: 'TEST TELLER',
      staffRef: 'TEST-ONLY',
    });
    const from = new Date(Date.now() - 60000).toISOString();
    await local.command(manager, { requestId: randomUUID(), action: 'issue', serviceId });
    for (const action of ['next', 'start', 'complete'] as const) {
      const current = await local.snapshot(teller);
      await local.command(teller, {
        requestId: randomUUID(),
        action,
        expectedRevision: current.counter!.revision,
      });
    }
    await synchronize(
      local,
      `http://127.0.0.1:${(server.address() as { port: number }).port}/api/queue/sync`,
      token,
    );
    expect((await local.pending()).events).toEqual([]);
    const to = new Date().toISOString();
    const branch = await branchAnalytics(local, manager, from, to);
    const hq = await central.transaction(tx =>
      loadQueueAnalytics(tx, 'queue_sync_events', local.branchId, from, to),
    );
    expect(hq).toEqual(branch);
    expect(branch.summary.completed).toBe(1);
    expect(branch.tellers[0].staffRef).toBe('TEST-ONLY');
    expect(branch.tellers[0].sampleSize).toBe(1);
    expect(branch.coverage.partial).toBe(false);
    const operational = await central.transaction(tx => readHeadquartersState(tx, local.branchId));
    expect(operational.waitingCount).toBe(0);
    expect(operational.active).toHaveLength(0);
    expect(operational.counters[0].id).toBe(counterId);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await local.close();
    await central.close();
  }
}, 30000);

it('exports the completed Riyadh day without inventing records or overwriting a report', async () => {
  const store = await QueueStore.open('memory://', randomUUID());
  const directory = await mkdtemp(path.join(os.tmpdir(), 'saraf-queue-report-test-'));
  try {
    await store.provision('manager', null);
    const today = businessDay(),
      day = businessDay(new Date(Date.parse(`${today}T00:00:00+03:00`) - 1));
    const file = await writeDailyReport(store, directory, day),
      original = await readFile(file, 'utf8');
    const report = JSON.parse(original);
    expect(report.summary.arrivals).toBe(0);
    expect(report.coverage.events).toBe(0);
    expect(report.summary.meanWaitSeconds).toBe(null);
    expect(report.timezone).toBe('Asia/Riyadh');
    expect(await writeDailyReport(store, directory, day)).toBe(file);
    expect(await readFile(file, 'utf8')).toBe(original);
    expect((await store.db.query('SELECT id FROM queue_tickets')).rows).toEqual([]);
  } finally {
    await store.close();
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-report-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it('rejects malformed event times through validation without throwing a date exception', () => {
  expect(() => eventSchema.safeParse({ occurredAt: 'invalid' })).not.toThrow();
  expect(eventSchema.safeParse({ occurredAt: 'invalid' }).success).toBe(false);
});
