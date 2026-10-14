import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Transaction } from '@electric-sql/pglite';
import { businessDay, type Actor } from '@saraf/queue-core';
import { applyCommand } from '../src/commands';
import { QueueStore } from '../src/store';

const beforeMidnight = '2026-10-13T20:59:59.999Z';
const midnight = '2026-10-13T21:00:00.000Z';

describe('Saudi midnight numbering', () => {
  let store: QueueStore;
  let directory: string;
  let kiosk: Actor;
  let teller: Actor;
  const branchId = randomUUID();
  const serviceA = randomUUID();
  const serviceB = randomUUID();
  const serviceC = randomUUID();
  const counterId = randomUUID();

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'saraf-queue-midnight-'));
    store = await QueueStore.open(directory, branchId);
    const manager = await store.provision('manager', null);
    await store.configure(manager, {
      services: [
        { id: serviceA, name: 'TEST A', prefix: 'A', active: true },
        { id: serviceB, name: 'TEST B', prefix: 'B', active: true },
        { id: serviceC, name: 'TEST C', prefix: 'C', active: true },
      ],
      counters: [
        { id: counterId, name: 'TEST COUNTER', serviceIds: [serviceA], paused: false, revision: 0 },
      ],
    });
    kiosk = await store.provision('kiosk', null);
    teller = await store.provision('teller', counterId);
  }, 30000);

  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await store?.close();
    if (
      directory &&
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-midnight-')
    ) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses Riyadh midnight at UTC 21:00, including month and year boundaries', () => {
    expect(businessDay(new Date(beforeMidnight))).toBe('2026-10-13');
    expect(businessDay(new Date(midnight))).toBe('2026-10-14');
    expect(businessDay(new Date('2026-10-31T21:00:00Z'))).toBe('2026-11-01');
    expect(businessDay(new Date('2026-12-31T21:00:00Z'))).toBe('2027-01-01');
  });

  it('keeps the numbering day consistent when service lookup crosses midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(beforeMidnight));
    const result = await store.db.transaction(async tx => {
      const crossingTransaction = new Proxy(tx, {
        get(target, key) {
          if (key === 'query')
            return async (sql: string, params: unknown[]) => {
              const result = await target.query(sql, params);
              if (sql.startsWith('SELECT body FROM queue_services')) {
                vi.setSystemTime(new Date(midnight));
              }
              return result;
            };
          return Reflect.get(target, key);
        },
      }) as Transaction;
      return applyCommand(crossingTransaction, kiosk, {
        action: 'issue',
        requestId: randomUUID(),
        serviceId: serviceC,
      });
    });
    const persisted = (
      await store.db.query<{ day: string }>('SELECT day FROM queue_tickets WHERE id=$1', [
        result.ticket!.id,
      ])
    ).rows[0];
    expect(result.ticket!.issuedAt).toBe(beforeMidnight);
    expect(persisted.day).toBe('2026-10-13');
    const next = await store.command(kiosk, {
      action: 'issue',
      requestId: randomUUID(),
      serviceId: serviceC,
    });
    expect(next.ticket!.code).toBe('C-001');
  });

  it('resets each service, retains active/waiting tickets, deduplicates retries and survives restart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T20:59:58.000Z'));
    const issue = (serviceId: string) =>
      store.command(kiosk, {
        action: 'issue',
        requestId: randomUUID(),
        serviceId,
      });
    const yesterday = await issue(serviceA);
    expect(yesterday.ticket!.code).toBe('A-001');
    await store.command(teller, { action: 'next', requestId: randomUUID(), expectedRevision: 0 });
    await store.command(teller, { action: 'start', requestId: randomUUID(), expectedRevision: 1 });
    vi.setSystemTime(new Date(beforeMidnight));
    const retryRequest = { action: 'issue', requestId: randomUUID(), serviceId: serviceA };
    const waitingYesterday = await store.command(kiosk, retryRequest);
    expect(waitingYesterday.ticket!.code).toBe('A-002');
    expect((await issue(serviceB)).ticket!.code).toBe('B-001');
    const lastSequence = (await store.pending()).events.at(-1)!.sequence;

    vi.setSystemTime(new Date(midnight));
    expect(await store.command(kiosk, retryRequest)).toEqual(waitingYesterday);
    const today = await issue(serviceA);
    expect(today.ticket!.code).toBe('A-001');
    expect(today.ticket!.id).not.toBe(yesterday.ticket!.id);
    expect((await issue(serviceB)).ticket!.code).toBe('B-001');
    const concurrent = await Promise.all([issue(serviceA), issue(serviceA)]);
    expect(concurrent.map(result => result.ticket!.code).sort()).toEqual(['A-002', 'A-003']);
    const snapshot = await store.snapshot(teller);
    expect(snapshot.current?.id).toBe(yesterday.ticket!.id);
    expect(snapshot.current?.status).toBe('serving');
    expect(snapshot.waiting.some(ticket => ticket.id === waitingYesterday.ticket!.id)).toBe(true);
    expect((await store.pending()).events.at(-1)!.sequence).toBe(lastSequence + 4);

    await store.close();
    vi.useRealTimers();
    store = await QueueStore.open(directory, branchId);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T21:00:01.000Z'));
    expect((await issue(serviceA)).ticket!.code).toBe('A-004');
    expect(await store.command(kiosk, retryRequest)).toEqual(waitingYesterday);
    expect((await store.snapshot(teller)).current?.id).toBe(yesterday.ticket!.id);
    await store.command(teller, {
      action: 'complete',
      requestId: randomUUID(),
      expectedRevision: 2,
    });
    await store.command(teller, { action: 'next', requestId: randomUUID(), expectedRevision: 3 });
    expect((await store.snapshot(teller)).current?.id).toBe(waitingYesterday.ticket!.id);
    const rows = (
      await store.db.query<{ day: string; code: string }>(
        "SELECT day,body->>'code' AS code FROM queue_tickets WHERE service_id=$1 ORDER BY day,code",
        [serviceA],
      )
    ).rows;
    expect(rows).toEqual([
      { day: '2026-10-13', code: 'A-001' },
      { day: '2026-10-13', code: 'A-002' },
      { day: '2026-10-14', code: 'A-001' },
      { day: '2026-10-14', code: 'A-002' },
      { day: '2026-10-14', code: 'A-003' },
      { day: '2026-10-14', code: 'A-004' },
    ]);
  }, 30000);
});
