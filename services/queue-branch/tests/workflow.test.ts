import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { QueueStore } from '../src/store';

describe('branch queue transaction workflow', () => {
  let store: QueueStore;
  let manager: any, teller: any, kiosk: any;
  let serviceId: string, counterId: string;
  beforeAll(async () => {
    store = await QueueStore.open('memory://', randomUUID());
    manager = await store.provision('manager', null);
    serviceId = randomUUID();
    counterId = randomUUID();
    await store.configure(manager, {
      services: [{ id: serviceId, name: 'الصرافة', prefix: 'A', active: true }],
      counters: [
        { id: counterId, name: 'كاونتر ١', serviceIds: [serviceId], paused: false, revision: 0 },
      ],
    });
    teller = await store.provision('teller', counterId);
    kiosk = await store.provision('kiosk', null);
  }, 30000);
  afterAll(async () => store?.close());
  const run = async (actor: any, action: string, extra = {}) => {
    const snap = await store.snapshot(actor);
    return store.command(actor, {
      requestId: randomUUID(),
      action,
      expectedRevision: snap.counter?.revision ?? 0,
      ...extra,
    });
  };
  it('does not generate seeded tickets', async () => {
    expect((await store.snapshot(teller)).waiting).toEqual([]);
  });
  it('deduplicates issuance and prevents two simultaneous call-next claims', async () => {
    const request = { requestId: randomUUID(), action: 'issue', serviceId };
    const first = await store.command(kiosk, request);
    const again = await store.command(kiosk, request);
    expect(again).toEqual(first);
    const revision = (await store.snapshot(teller)).counter!.revision;
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        store.command(teller, {
          requestId: randomUUID(),
          action: 'next',
          expectedRevision: revision,
        }),
      ),
    );
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect((await store.snapshot(teller)).current?.code).toBe(first.ticket!.code);
  });
  it('recall preserves first call timestamp, pause blocks changes, resume keeps ticket', async () => {
    const ticket = (await store.snapshot(teller)).current!;
    await run(teller, 'recall');
    expect((await store.snapshot(teller)).current?.calledAt).toBe(ticket.calledAt);
    await run(teller, 'pause');
    await expect(run(teller, 'start')).rejects.toThrow();
    await run(teller, 'resume');
    await run(teller, 'start');
    await expect(run(teller, 'no_show')).rejects.toThrow();
    await run(teller, 'complete');
    expect((await store.snapshot(teller)).current).toBeNull();
  });
  it('rejects a different payload reused with the same id and kiosk teller actions', async () => {
    const id = randomUUID();
    await store.command(kiosk, { requestId: id, action: 'issue', serviceId });
    await expect(
      store.command(kiosk, { requestId: id, action: 'issue', serviceId: randomUUID() }),
    ).rejects.toThrow();
    await expect(run(kiosk, 'pause')).rejects.toThrow();
  });
  it('transfers retain code and create an ordered outbox', async () => {
    await run(teller, 'next');
    const before = (await store.snapshot(teller)).current!;
    await run(teller, 'transfer', { serviceId });
    const snap = await store.snapshot(teller);
    expect(snap.waiting.some(t => t.code === before.code)).toBe(true);
    const batch = await store.pending();
    expect(batch.events.length).toBeGreaterThan(0);
    expect(
      batch.events.every((e, i) => i === 0 || e.sequence === batch.events[i - 1].sequence + 1),
    ).toBe(true);
    await store.acknowledge(batch.events.at(-1)!.sequence);
    expect((await store.pending()).events).toHaveLength(0);
  });
});
