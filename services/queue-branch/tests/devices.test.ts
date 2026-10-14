import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { QueueStore } from '../src/store';

it('routes teller queues and display calls by counter IDs, even when counters share a name', async () => {
  const store = await QueueStore.open('memory://', randomUUID());
  try {
    const manager = await store.provision('manager', null),
      a = randomUUID(),
      b = randomUUID(),
      c1 = randomUUID(),
      c2 = randomUUID();
    await store.configure(manager, {
      services: [
        { id: a, name: 'TEST A', nameEn: 'TEST Currency exchange', prefix: 'A', active: true },
        { id: b, name: 'TEST B', prefix: 'B', active: true },
      ],
      counters: [
        { id: c1, name: 'TEST COUNTER', serviceIds: [a], paused: false, revision: 0 },
        { id: c2, name: 'TEST COUNTER', serviceIds: [b], paused: false, revision: 0 },
      ],
    });
    const teller = await store.provision('teller', c1, { name: 'TEST TELLER', staffRef: 'TEST-1' });
    const display = await store.provision('display', c1);
    await store.command(manager, { requestId: randomUUID(), action: 'issue', serviceId: b });
    expect((await store.snapshot(teller)).waiting).toHaveLength(0);
    await store.command(manager, { requestId: randomUUID(), action: 'issue', serviceId: a });
    const counter = (await store.snapshot(teller)).counter!;
    await store.command(teller, {
      requestId: randomUUID(),
      action: 'next',
      expectedRevision: counter.revision,
    });
    const snapshot = await store.snapshot(display);
    expect(snapshot.services.find(s => s.id === a)?.nameEn).toBe('TEST Currency exchange');
    expect(
      (await store.pending()).events[0].payload.configuration?.services.find(s => s.id === a)
        ?.nameEn,
    ).toBe('TEST Currency exchange');
    expect(snapshot.announcements[0]).toMatchObject({
      counterId: c1,
      ticketId: snapshot.current!.id,
    });
    expect(snapshot.announcements[0].occurredAt).toMatch(/Z$/);
  } finally {
    await store.close();
  }
}, 30000);

it('rejects a previously authenticated device after revocation, including receipt replay', async () => {
  const store = await QueueStore.open('memory://', randomUUID());
  try {
    const manager = await store.provision('manager', null),
      kiosk = await store.provision('kiosk', null),
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
    const command = { requestId: randomUUID(), action: 'issue' as const, serviceId };
    await store.command(kiosk, command);
    await store.revoke(manager, kiosk.id);
    await expect(store.command(kiosk, command)).rejects.toThrow('Device not authorized');
  } finally {
    await store.close();
  }
}, 30000);
