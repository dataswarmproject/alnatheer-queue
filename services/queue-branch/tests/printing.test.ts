import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { inboxSchema, receiveEvents } from '@saraf/queue-core/receiver';
import { readHeadquartersState } from '@saraf/queue-core/headquarters';
import { QueueStore } from '../src/store';
import { mergeIssuedTicket } from '../../../apps/queue-desktop/src/renderer/src/issued-ticket';
import type { Ticket } from '@saraf/queue-core';

it('a delayed pre-print poll cannot relock an acknowledged receipt beyond the first 100 rows', () => {
  const pending: Ticket = {
    id: randomUUID(),
    code: 'A-103',
    serviceId: randomUUID(),
    originalServiceId: randomUUID(),
    counterId: null,
    status: 'waiting',
    issuedAt: new Date().toISOString(),
    queuedAt: new Date().toISOString(),
    calledAt: null,
    startedAt: null,
    completedAt: null,
    printRequired: true,
    printedAt: null,
    issuedBy: randomUUID(),
  };
  const accepted = { ...pending, printedAt: new Date().toISOString() };
  const afterStalePoll = mergeIssuedTicket(accepted, {
    pendingPrintTicket: pending,
    waiting: [pending],
    active: [],
  });
  expect(afterStalePoll).toEqual(accepted);
  const olderRows = Array.from({ length: 100 }, (_, i) => ({
    ...pending,
    id: randomUUID(),
    code: 'A-' + i,
  }));
  expect(
    mergeIssuedTicket(afterStalePoll, { pendingPrintTicket: null, waiting: olderRows, active: [] }),
  ).toEqual(accepted);
  const nextPending = { ...pending, id: randomUUID(), code: 'A-104' };
  expect(
    mergeIssuedTicket(accepted, {
      pendingPrintTicket: nextPending,
      waiting: olderRows,
      active: [],
    }),
  ).toEqual(nextPending);
});

async function setup(store: QueueStore) {
  const manager = await store.provision('manager', null),
    serviceId = randomUUID(),
    counterId = randomUUID();
  await store.configure(manager, {
    services: [{ id: serviceId, name: 'TEST ONLY', prefix: 'A', active: true }],
    counters: [
      { id: counterId, name: 'كاونتر 1', serviceIds: [serviceId], paused: false, revision: 0 },
    ],
  });
  const kiosk = await store.provision('kiosk', null),
    otherKiosk = await store.provision('kiosk', null),
    teller = await store.provision('teller', counterId);
  return { manager, kiosk, otherKiosk, teller, serviceId };
}

it('only calls accepted printed tickets, preserves legacy FIFO and never invents a next number', async () => {
  const store = await QueueStore.open('memory://', randomUUID()),
    central = new PGlite();
  try {
    const { kiosk, otherKiosk, teller, manager, serviceId } = await setup(store);
    const run = async (action: 'next' | 'start' | 'complete') =>
      store.command(teller, {
        requestId: randomUUID(),
        action,
        expectedRevision: (await store.snapshot(teller)).counter!.revision,
      });
    const issue = { requestId: randomUUID(), action: 'issue', serviceId, requirePrint: true };
    const first = (await store.command(kiosk, issue)).ticket!;
    expect(first.code).toBe('A-001');
    expect(first.printedAt).toBeNull();
    await expect(store.revoke(manager, kiosk.id)).rejects.toMatchObject({ code: 'PRINT_PENDING' });
    expect(await store.command(kiosk, issue)).toEqual({ ticket: first, counter: null });
    expect((await store.snapshot(teller)).waiting).toEqual([]);
    expect((await store.snapshot(teller)).totals.waiting).toBe(0);
    await expect(run('next')).rejects.toMatchObject({ code: 'EMPTY' });
    await expect(store.command(kiosk, { ...issue, requestId: randomUUID() })).rejects.toMatchObject(
      { code: 'PRINT_PENDING' },
    );
    const printed = { requestId: first.id, action: 'printed', ticketId: first.id };
    for (const actor of [teller, otherKiosk, manager])
      await expect(store.command(actor, printed)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const accepted = await store.command(kiosk, printed);
    expect(accepted.ticket!.printedAt).toBeTruthy();
    expect(await store.command(kiosk, printed)).toEqual(accepted);
    expect((await store.snapshot(kiosk)).pendingPrintTicket).toBeNull();
    expect((await run('next')).ticket!.id).toBe(first.id);
    await run('start');
    await run('complete');
    const before = await store.snapshot(teller);
    for (let i = 0; i < 5; i++) await expect(run('next')).rejects.toMatchObject({ code: 'EMPTY' });
    expect((await store.snapshot(teller)).counter).toEqual(before.counter);
    expect((await store.snapshot(teller)).revision).toBe(before.revision);
    // Historical/API tickets created before print acknowledgement remain callable.
    const legacy = (
      await store.command(otherKiosk, { requestId: randomUUID(), action: 'issue', serviceId })
    ).ticket!;
    expect(legacy.code).toBe('A-002');
    expect((await run('next')).ticket!.id).toBe(legacy.id);
    const batch = await store.pending();
    expect(batch.events.filter(event => event.kind === 'printed')).toHaveLength(1);
    await central.exec(inboxSchema);
    await receiveEvents(central, batch, store.branchId);
    const headquarters = await central.transaction(tx => readHeadquartersState(tx, store.branchId));
    expect(headquarters.active[0].id).toBe(legacy.id);
    expect(headquarters.waiting).toEqual([]);
  } finally {
    await store.close();
    await central.close();
  }
}, 30000);

it('recovers the same unprinted ticket after restart without exposing another kiosk pending receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saraf-queue-print-test-')),
    branchId = randomUUID();
  let store: QueueStore | undefined;
  try {
    store = await QueueStore.open(path.join(root, 'data'), branchId);
    const { kiosk, otherKiosk, serviceId } = await setup(store);
    const first = (
      await store.command(kiosk, {
        requestId: randomUUID(),
        action: 'issue',
        serviceId,
        requirePrint: true,
      })
    ).ticket!;
    await store.close();
    store = undefined;
    store = await QueueStore.open(path.join(root, 'data'), branchId);
    const actor = await store.authenticate(kiosk.token);
    expect((await store.snapshot(actor)).pendingPrintTicket).toEqual(first);
    expect(
      (await store.snapshot(await store.authenticate(otherKiosk.token))).pendingPrintTicket,
    ).toBeNull();
    await store.command(actor, { requestId: first.id, action: 'printed', ticketId: first.id });
    expect((await store.snapshot(actor)).pendingPrintTicket).toBeNull();
  } finally {
    await store?.close();
    if (
      path.dirname(root) === path.resolve(os.tmpdir()) &&
      path.basename(root).startsWith('saraf-queue-print-test-')
    )
      await rm(root, { recursive: true, force: true });
  }
}, 30000);
