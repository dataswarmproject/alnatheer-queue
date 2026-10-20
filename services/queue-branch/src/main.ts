import path from 'node:path';
import { QueueStore } from './store';
import { createBranchServer } from './http';
import { id } from '@saraf/queue-core';
import { createOperations } from './operations';
import { NeuralSpeech, speechModelSchema } from './speech';
import { localSpeechConfiguration } from './local-speech-config';
import { useWindowsNetworkTrust } from '@saraf/queue-core/network-trust';

useWindowsNetworkTrust();
const branchId = id.parse(process.env.QUEUE_BRANCH_ID);
const directory = path.resolve(process.env.QUEUE_DATA_DIR ?? './queue-data');
const speechDirectory =
  process.env.QUEUE_SPEECH_CACHE_DIR ?? path.join(path.dirname(directory), 'speech-cache');
let localVoice: Awaited<ReturnType<typeof localSpeechConfiguration>> = null;
let localVoiceInvalid = false;
try {
  localVoice = await localSpeechConfiguration(speechDirectory);
} catch {
  // Voice configuration must not take ticket issuance or counter service offline.
  localVoiceInvalid = true;
  console.warn('Local voice library is invalid; speech is disabled until it is repaired.');
}
const host = process.env.QUEUE_LISTEN_HOST ?? '127.0.0.1';
const port = Number(process.env.QUEUE_LISTEN_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
if (
  !['127.0.0.1', '::1', 'localhost'].includes(host) &&
  (!process.env.QUEUE_TLS_CERT || !process.env.QUEUE_TLS_KEY)
)
  throw new Error('LAN service requires TLS certificate and key');
if (!!process.env.QUEUE_SYNC_URL !== !!process.env.QUEUE_SYNC_KEY)
  throw new Error('Set both sync URL and key');
const store = await QueueStore.open(directory, branchId);
const operations = await createOperations(store, {
  root: path.dirname(directory),
  syncUrl: process.env.QUEUE_SYNC_URL,
  syncKey: process.env.QUEUE_SYNC_KEY,
  backupDirectory: process.env.QUEUE_BACKUP_DIR,
  reportDirectory: process.env.QUEUE_REPORT_DIR,
});
let stopping = false;
const server = createBranchServer(store, {
  operations,
  shutdown,
  isStopping: () => stopping,
  cert: process.env.QUEUE_TLS_CERT,
  key: process.env.QUEUE_TLS_KEY,
  syncConfigured: !!process.env.QUEUE_SYNC_URL,
  backupDirectory: (await operations.status()).backupDirectory,
  reportsConfigured: !!process.env.QUEUE_REPORT_DIR,
  speech:
    !localVoiceInvalid && (localVoice || process.env.QUEUE_SPEECH_VOICE_ID)
      ? new NeuralSpeech({
          directory: speechDirectory,
          voiceId: localVoice?.voiceId ?? process.env.QUEUE_SPEECH_VOICE_ID!,
          apiKey: localVoice ? undefined : process.env.QUEUE_SPEECH_API_KEY,
          model:
            localVoice?.model ??
            speechModelSchema.parse(process.env.QUEUE_SPEECH_MODEL ?? 'eleven_multilingual_v2'),
          dailyLimit: Number(process.env.QUEUE_SPEECH_DAILY_LIMIT ?? 500),
        })
      : undefined,
});
server.listen(port, host, () => console.log(`Queue branch service listening on ${host}:${port}`));
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const drained = new Promise<void>(resolve => server.close(() => resolve()));
  server.closeIdleConnections?.();
  await operations.stop();
  await drained;
  await store.close();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
