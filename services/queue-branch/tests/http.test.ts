import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'node:http';
import { QueueStore } from '../src/store';
import { createBranchServer } from '../src/http';
import { queueVersion } from '@saraf/queue-core/server';

describe('real branch HTTP access and filesystem restart', () => {
  let store: QueueStore,
    server: Server,
    endpoint: string,
    manager: any,
    teller: any,
    kiosk: any,
    serviceId: string,
    counterId: string,
    directory: string;
  const branchId = randomUUID();
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'saraf-queue-test-'));
    store = await QueueStore.open(directory, branchId);
    manager = await store.provision('manager', null);
    serviceId = randomUUID();
    counterId = randomUUID();
    await store.configure(manager, {
      services: [{ id: serviceId, name: 'TEST SERVICE', prefix: 'A', active: true }],
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
    teller = await store.provision('teller', counterId, {
      name: 'TEST TELLER',
      staffRef: 'TEST-ONLY',
    });
    kiosk = await store.provision('kiosk', null);
    server = createBranchServer(store);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  }, 30000);
  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()));
    await store.close();
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('saraf-queue-test-')
    )
      await rm(directory, { recursive: true, force: true });
  });
  const request = (route: string, actor: any, method = 'GET', input?: unknown) =>
    fetch(endpoint + route, {
      method,
      headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
  it('prevents a second process from opening the same branch database', async () => {
    await expect(QueueStore.open(directory, branchId)).rejects.toThrow('locked');
  });
  it('exposes only minimal unauthenticated readiness and reserves server diagnostics for managers', async () => {
    expect(await (await fetch(endpoint + '/healthz')).json()).toMatchObject({
      ok: true,
      version: queueVersion,
    });
    expect((await request('/v1/status', kiosk)).status).toBe(403);
    const status = await (await request('/v1/status', manager)).json();
    expect(status.databaseReady).toBe(true);
    expect(status.branchId).toBe(branchId);
    expect(JSON.stringify(status)).not.toContain(manager.token);
    expect((await request('/v1/backups', kiosk, 'POST', {})).status).toBe(403);
    expect((await request('/v1/update-release', kiosk)).status).toBe(403);
    expect((await request('/v1/update-release/download', teller, 'POST', {})).status).toBe(403);
    expect((await request('/v1/update-release', manager)).status).toBe(503);
  });
  it('rejects missing auth, a browser origin and another role’s commands', async () => {
    expect((await fetch(endpoint + '/v1/snapshot')).status).toBe(401);
    expect(
      (
        await fetch(endpoint + '/v1/snapshot', {
          headers: { authorization: `Bearer ${teller.token}`, origin: 'https://attacker.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/v1/commands', kiosk, 'POST', {
          requestId: randomUUID(),
          action: 'pause',
          expectedRevision: 0,
        })
      ).status,
    ).toBe(403);
    expect((await request('/v1/configuration', teller, 'PUT', {})).status).toBe(403);
    expect((await request('/v1/analytics?from=2026-10-01&to=2026-10-02', teller)).status).toBe(403);
  });
  it('persists a real issued ticket, outbox, counter state and scoped credentials across restart', async () => {
    const response = await request('/v1/commands', kiosk, 'POST', {
      requestId: randomUUID(),
      action: 'issue',
      serviceId,
    });
    expect(response.ok).toBe(true);
    const code = (await response.json()).ticket.code;
    await new Promise<void>(r => server.close(() => r()));
    await store.close();
    store = await QueueStore.open(directory, branchId);
    expect((await store.snapshot(await store.authenticate(teller.token))).waiting[0].code).toBe(
      code,
    );
    expect((await store.pending()).events.length).toBeGreaterThan(1);
    server = createBranchServer(store);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  it('cannot replace teller assignment while serving; revoked keys stop working', async () => {
    const revision = (await store.snapshot(teller)).counter!.revision;
    await request('/v1/commands', teller, 'POST', {
      requestId: randomUUID(),
      action: 'next',
      expectedRevision: revision,
    });
    expect((await request('/v1/devices/revoke', manager, 'POST', { id: teller.id })).status).toBe(
      409,
    );
    await request('/v1/commands', teller, 'POST', {
      requestId: randomUUID(),
      action: 'no_show',
      expectedRevision: revision + 1,
    });
    expect((await request('/v1/devices/revoke', manager, 'POST', { id: teller.id })).status).toBe(
      200,
    );
    expect((await request('/v1/snapshot', teller)).status).toBe(401);
  });
});
