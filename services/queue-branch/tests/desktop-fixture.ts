// Disposable test host only. Never imported by production service or installer.
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { inboxSchema, receiveEvents, receiveHeartbeat } from '@saraf/queue-core/receiver';
import { readHeadquartersState } from '@saraf/queue-core/headquarters';
import { startSync } from '../src/sync';
import { QueueStore } from '../src/store';
import { createBranchServer } from '../src/http';
import { NeuralSpeech } from '../src/speech';
import { announcementParts } from '@saraf/queue-core/speech';
import { localVoiceId, localVoiceModel } from '../src/local-speech-plan';
import { createOperations } from '../src/operations';
const store = await QueueStore.open('memory://', randomUUID());
const manager = await store.provision('manager', null),
  serviceId = randomUUID(),
  secondService = randomUUID(),
  counterId = randomUUID();
const counters = Array.from(
  {
    length:
      process.env.QUEUE_TEST_COUNTERS === '10'
        ? 10
        : process.env.QUEUE_TEST_COUNTERS === '6'
          ? 6
          : 1,
  },
  (_, i) => ({
    id: i ? randomUUID() : counterId,
    name: i ? `TEST · كاونتر ${i + 1}` : 'TEST · كاونتر ١',
    serviceIds: [serviceId, secondService],
    paused: false,
    revision: 0,
  }),
);
await store.configure(manager, {
  services: [
    {
      id: serviceId,
      name: 'TEST · صرافة',
      nameEn: 'TEST Currency exchange',
      prefix: 'A',
      active: true,
    },
    { id: secondService, name: 'TEST · حوالات', prefix: 'B', active: true },
  ],
  counters,
});
const teller = await store.provision('teller', counterId, {
    name: 'TEST TELLER',
    staffRef: 'TEST-ONLY',
  }),
  kiosk = await store.provision('kiosk', null),
  display = await store.provision('display', null);
const counterDisplay = await store.provision('display', counterId);
const central = new PGlite();
await central.exec(inboxSchema);
let wan = true;
const hq = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.url === '/test/wan/off') {
      wan = false;
      res.end('{}');
      return;
    }
    if (req.url === '/test/wan/on') {
      wan = true;
      res.end('{}');
      return;
    }
    if (req.url === '/state') {
      res.end(
        JSON.stringify(await central.transaction(tx => readHeadquartersState(tx, store.branchId))),
      );
      return;
    }
    if (req.url !== '/api/queue/sync') {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!wan) {
      res.writeHead(503);
      res.end('{}');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    res.end(
      JSON.stringify(
        await (payload.kind === 'heartbeat'
          ? receiveHeartbeat(central, payload, store.branchId)
          : receiveEvents(central, payload, store.branchId)),
      ),
    );
  } catch {
    res.writeHead(409);
    res.end('{}');
  }
});
await new Promise<void>(r => hq.listen(0, '127.0.0.1', r));
const hqUrl = `http://127.0.0.1:${(hq.address() as { port: number }).port}`;
const operations = process.env.QUEUE_TEST_OPERATIONS
  ? await createOperations(store, {
      root: path.dirname(process.env.QUEUE_FIXTURE_FILE!),
      syncUrl: hqUrl + '/api/queue/sync',
      syncKey: 'a'.repeat(64),
    })
  : undefined;
const stopSync = operations
  ? operations.stop
  : startSync(store, hqUrl + '/api/queue/sync', 'TEST-ONLY-FIXTURE');
const speech = process.env.QUEUE_TEST_LOCAL_SPEECH
  ? new NeuralSpeech({
      directory: process.env.QUEUE_TEST_LOCAL_SPEECH,
      voiceId: localVoiceId,
      model: localVoiceModel,
      fetch: async () => {
        throw new Error('Local speech must never request a paid provider');
      },
    })
  : process.env.QUEUE_TEST_SPEECH_AUDIO
    ? new NeuralSpeech({
        directory: path.join(path.dirname(process.env.QUEUE_FIXTURE_FILE!), 'speech-cache'),
        voiceId: 'TEST-VOICE',
        apiKey: 'TEST-ONLY',
        fetch: async () => {
          if (!wan) return new Response('TEST WAN outage', { status: 503 });
          return new Response(await readFile(process.env.QUEUE_TEST_SPEECH_AUDIO!), {
            headers: { 'content-type': 'audio/mpeg' },
          });
        },
      })
    : undefined;
if (speech && process.env.QUEUE_TEST_SPEECH_SPLIT && !process.env.QUEUE_TEST_LOCAL_SPEECH) {
  for (const part of announcementParts({ code: 'A-1', counterName: 'TEST · كاونتر ١' }))
    await speech.audio(part);
}
const server = createBranchServer(store, {
  operations,
  syncConfigured: true,
  backupDirectory: path.join(path.dirname(process.env.QUEUE_FIXTURE_FILE!), 'backups'),
  speech,
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
await writeFile(
  process.env.QUEUE_FIXTURE_FILE!,
  JSON.stringify({
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    manager,
    teller,
    kiosk,
    display,
    counterDisplay,
    serviceId,
    secondService,
    counters,
    hqUrl,
  }),
  { mode: 0o600 },
);
console.log('Disposable branch fixture ready');
process.on('SIGTERM', () =>
  server.close(async () => {
    await stopSync();
    await new Promise<void>(r => hq.close(() => r()));
    await central.close();
    await store.close();
    process.exit(0);
  }),
);
