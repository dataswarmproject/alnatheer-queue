import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueStore } from '../src/store';
import { createBranchServer } from '../src/http';
import { NeuralSpeech } from '../src/speech';

it('authorizes real calls, caches recalls and rejects arbitrary text, other counters and completed tickets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-speech-http-test-'));
  const store = await QueueStore.open('memory://', randomUUID());
  let calls = 0;
  let release: (() => void) | undefined, entered: (() => void) | undefined;
  const speech = new NeuralSpeech({
    directory,
    voiceId: 'test-voice',
    apiKey: 'TEST-ONLY',
    fetch: async () => {
      calls++;
      if (entered) {
        entered();
        await new Promise<void>(resolve => {
          release = resolve;
        });
      }
      return new Response(Buffer.from([73, 68, 51, ...new Array(100).fill(0)]), {
        headers: { 'content-type': 'audio/mpeg' },
      });
    },
  });
  const server = createBranchServer(store, { speech });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const manager = await store.provision('manager', null),
      serviceId = randomUUID(),
      counterId = randomUUID(),
      otherId = randomUUID();
    await store.configure(manager, {
      services: [{ id: serviceId, name: 'TEST', prefix: 'A', active: true }],
      counters: [counterId, otherId].map((id, i) => ({
        id,
        name: `كاونتر ${i + 1}`,
        serviceIds: [serviceId],
        paused: false,
        revision: 0,
      })),
    });
    const teller = await store.provision('teller', counterId),
      secondTeller = await store.provision('teller', otherId),
      kiosk = await store.provision('kiosk', null),
      display = await store.provision('display', null),
      other = await store.provision('display', otherId);
    const request = (actor: any, input: unknown, route = '/v1/speech', method = 'POST') =>
      fetch(url + route, {
        method,
        headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
      });
    expect((await fetch(url + '/v1/speech/status')).status).toBe(401);
    expect((await request(kiosk, { test: true })).status).toBe(403);
    expect((await request(display, { text: 'arbitrary charged prompt' })).status).toBe(400);
    expect(calls).toBe(0);
    await store.command(kiosk, { requestId: randomUUID(), action: 'issue', serviceId });
    await store.command(teller, { requestId: randomUUID(), action: 'next', expectedRevision: 0 });
    const call = (await store.snapshot(display)).announcements.at(-1)!;
    expect((await request(other, { sequence: call.sequence })).status).toBe(409);
    const audio = await (await request(display, { sequence: call.sequence })).json();
    expect(audio.text).toBe('على صاحب التذكرة رقم A... واحد، التوجّه إلى الكاونتر رقم واحد.');
    expect(audio.cached).toBe(false);
    expect(JSON.stringify(audio)).not.toContain('TEST-ONLY');
    await store.command(teller, { requestId: randomUUID(), action: 'recall', expectedRevision: 1 });
    const recall = (await store.snapshot(display)).announcements.at(-1)!;
    expect((await (await request(display, { sequence: recall.sequence })).json()).cached).toBe(
      true,
    );
    expect(calls).toBe(1);
    await store.command(teller, { requestId: randomUUID(), action: 'start', expectedRevision: 2 });
    await store.command(teller, {
      requestId: randomUUID(),
      action: 'complete',
      expectedRevision: 3,
    });
    expect((await request(display, { sequence: recall.sequence })).status).toBe(409);
    await store.command(kiosk, { requestId: randomUUID(), action: 'issue', serviceId });
    await store.command(teller, { requestId: randomUUID(), action: 'next', expectedRevision: 4 });
    const next = (await store.snapshot(display)).announcements.at(-1)!;
    const starting = new Promise<void>(resolve => {
      entered = resolve;
    });
    const generating = request(display, { sequence: next.sequence });
    await starting;
    await store.command(teller, { requestId: randomUUID(), action: 'start', expectedRevision: 5 });
    await store.command(teller, {
      requestId: randomUUID(),
      action: 'complete',
      expectedRevision: 6,
    });
    release!();
    expect((await generating).status).toBe(409);
    entered = undefined;
    // The printed code survives transfer, but the announcement must name the new counter.
    await store.command(kiosk, { requestId: randomUUID(), action: 'issue', serviceId });
    await store.command(teller, { requestId: randomUUID(), action: 'next', expectedRevision: 7 });
    const beforeTransfer = (await store.snapshot(display)).announcements.at(-1)!;
    await request(display, { sequence: beforeTransfer.sequence });
    await store.command(teller, {
      requestId: randomUUID(),
      action: 'transfer',
      serviceId,
      expectedRevision: 8,
    });
    expect((await request(display, { sequence: beforeTransfer.sequence })).status).toBe(409);
    await store.command(secondTeller, {
      requestId: randomUUID(),
      action: 'next',
      expectedRevision: 0,
    });
    const transferred = (await store.snapshot(display)).announcements.at(-1)!;
    expect(transferred.code).toBe(beforeTransfer.code);
    const transferredAudio = await (
      await request(other, { sequence: transferred.sequence })
    ).json();
    expect(transferredAudio.text).toBe(
      'على صاحب التذكرة رقم A... ثلاثة، التوجّه إلى الكاونتر رقم اثنين.',
    );
    expect(transferredAudio.cached).toBe(false);
    expect((await request(display, { sequence: beforeTransfer.sequence })).status).toBe(409);
    const beforeRecall = calls;
    await store.command(secondTeller, {
      requestId: randomUUID(),
      action: 'recall',
      expectedRevision: 1,
    });
    const transferredRecall = (await store.snapshot(display)).announcements.at(-1)!;
    const recalledAudio = await (
      await request(other, { sequence: transferredRecall.sequence })
    ).json();
    expect(recalledAudio.text).toBe(transferredAudio.text);
    expect(recalledAudio.cached).toBe(true);
    expect(calls).toBe(beforeRecall);
    await store.revoke(manager, display.id);
    expect((await request(display, { test: true })).status).toBe(401);
  } finally {
    release?.();
    await new Promise<void>(r => server.close(() => r()));
    await store.close();
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-speech-http-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
}, 30000);
