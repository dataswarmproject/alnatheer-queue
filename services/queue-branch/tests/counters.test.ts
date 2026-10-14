import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { QueueStore, bodies } from '../src/store';
import type { Actor, Counter, QueueEvent } from '@saraf/queue-core';
import { branchAnalytics } from '../src/analytics';
import { inboxSchema, receiveEvents } from '@saraf/queue-core/receiver';
import { readHeadquartersState } from '@saraf/queue-core/headquarters';

describe('manager counter lifecycle with retained evidence', () => {
  let store: QueueStore, manager: Actor, teller: Actor, serviceId: string, counterId: string;
  beforeEach(async () => {
    store = await QueueStore.open('memory://', randomUUID());
    manager = await store.provision('manager', null);
    serviceId = randomUUID();
    counterId = randomUUID();
    await store.configure(manager, {
      services: [{ id: serviceId, name: 'الصرافة', prefix: 'A', active: true }],
      counters: [
        { id: counterId, name: 'كاونتر 1', serviceIds: [serviceId], paused: false, revision: 0 },
      ],
    });
    teller = await store.provision('teller', counterId, { name: 'موظف أول', staffRef: 'staff-1' });
  });
  afterEach(() => store.close());
  const create = (number: number) => ({
    requestId: randomUUID(),
    action: 'create_counter',
    number,
    label: 'الصرافة',
    serviceIds: [serviceId],
  });
  const control = async (actor: Actor, action: string, id = counterId) => {
    const c = (await store.snapshot(manager)).counters.find(c => c.id === id)!;
    return store.command(actor, {
      requestId: randomUUID(),
      action,
      expectedRevision: c.revision,
      ...(actor.role === 'manager' ? { counterId: id } : {}),
    });
  };
  it('creates paused counters, deduplicates requests, protects numbering and six-counter capacity', async () => {
    const request = create(2);
    const result = await store.command(manager, request);
    expect(result.counter).toMatchObject({ number: 2, name: 'كاونتر 2 · الصرافة', paused: true });
    expect(await store.command(manager, request)).toEqual(result);
    await expect(store.command(manager, { ...request, number: 3 })).rejects.toThrow('already used');
    await expect(store.command(manager, create(2))).rejects.toThrow('مستخدم');
    await expect(store.command(teller, create(3))).rejects.toMatchObject({ status: 403 });
    for (let n = 3; n <= 6; n++) await store.command(manager, create(n));
    await expect(store.command(manager, create(1))).rejects.toThrow('ستة');
    expect((await store.snapshot(manager)).counters).toHaveLength(6);
  });
  it('supports supervisor pause/resume/recall with revisions without allowing teller impersonation', async () => {
    await store.command(manager, { requestId: randomUUID(), action: 'issue', serviceId });
    await control(teller, 'next');
    const live = await store.snapshot(manager);
    await expect(
      store.configure(manager, {
        services: live.services,
        counters: live.counters.map(c => ({ ...c, name: 'كاونتر 2' })),
      }),
    ).rejects.toThrow('التذكرة');
    await control(manager, 'pause');
    await expect(control(teller, 'start')).rejects.toThrow('Resume');
    await expect(
      store.command(manager, {
        requestId: randomUUID(),
        action: 'resume',
        counterId,
        expectedRevision: 0,
      }),
    ).rejects.toThrow('refresh');
    await control(manager, 'resume');
    await control(manager, 'recall');
    const added = (await store.command(manager, create(2))).counter!;
    await expect(
      store.command(teller, {
        requestId: randomUUID(),
        action: 'pause',
        counterId: added.id,
        expectedRevision: added.revision,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      store.command(manager, { requestId: randomUUID(), action: 'start', expectedRevision: 0 }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('rejects stale edits and active deletion, retires without deleting tickets, devices or HQ history', async () => {
    await store.command(manager, create(2));
    const before = (await store.snapshot(manager)).counters.find(c => c.id === counterId)!;
    const edit = {
      requestId: randomUUID(),
      action: 'edit_counter',
      counterId,
      expectedRevision: before.revision,
      number: 1,
      label: 'الحوالات',
      serviceIds: [serviceId],
    };
    await store.command(manager, edit);
    await expect(store.command(manager, { ...edit, requestId: randomUUID() })).rejects.toThrow(
      'تغيّر',
    );
    await store.command(manager, { requestId: randomUUID(), action: 'issue', serviceId });
    await control(teller, 'next');
    const retire = async () => {
      const c = (await store.snapshot(manager)).counters.find(c => c.id === counterId)!;
      return store.command(manager, {
        requestId: randomUUID(),
        action: 'delete_counter',
        counterId,
        expectedRevision: c.revision,
      });
    };
    await expect(retire()).rejects.toThrow('التذكرة الحالية');
    await control(teller, 'start');
    await control(teller, 'complete');
    const retired = await retire();
    expect(retired.counter?.archived).toBe(true);
    expect((await store.snapshot(manager)).counters).toHaveLength(1);
    expect((await store.devices(manager)).find(d => d.id === teller.id)?.enabled).toBe(false);
    await expect(store.snapshot(teller)).rejects.toMatchObject({ status: 401 });
    await expect(store.provision('display', counterId, {}, manager)).rejects.toThrow('غير متاح');
    expect((await store.db.query('SELECT id FROM queue_tickets')).rows).toHaveLength(1);
    const report = await branchAnalytics(
      store,
      manager,
      new Date(Date.now() - 60000).toISOString(),
      new Date(Date.now() + 100).toISOString(),
    );
    expect(report.counters.find(c => c.id === counterId)).toMatchObject({
      archived: true,
      completed: 1,
      sampleSize: 1,
      calls: 1,
      starts: 1,
    });
    const central = new PGlite();
    try {
      await central.exec(inboxSchema);
      const events = await bodies<QueueEvent>(
        store.db,
        'SELECT body FROM queue_events ORDER BY sequence',
      );
      await receiveEvents(
        central,
        { version: 1, branchId: store.branchId, events },
        store.branchId,
      );
      expect((await readHeadquartersState(central, store.branchId)).counters).toHaveLength(1);
      expect((await central.query('SELECT counter_id FROM queue_sync_counters')).rows).toHaveLength(
        2,
      );
    } finally {
      await central.close();
    }
    const active = await store.snapshot(manager);
    await expect(
      store.command(manager, {
        requestId: randomUUID(),
        action: 'delete_counter',
        counterId: active.counters[0].id,
        expectedRevision: active.counters[0].revision,
      }),
    ).rejects.toThrow('واحد');
    expect(
      (await bodies<Counter>(store.db, 'SELECT body FROM queue_counters')).filter(c => c.archived),
    ).toHaveLength(1);
  });
});
