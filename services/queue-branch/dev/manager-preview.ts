// Owner-requested local desktop preview. Never imported by the installed host.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { QueueStore } from '../src/store';
import { createOperations } from '../src/operations';
import { createBranchServer } from '../src/http';
import { NeuralSpeech } from '../src/speech';
import { localSpeechConfiguration } from '../src/local-speech-config';
const root = path.resolve(process.env.QUEUE_PREVIEW_ROOT!),
  file = path.join(root, 'manager.queue-pairing.json');
await mkdir(root, { recursive: true });
const savedSchema = z
  .object({ branchId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
let saved: z.infer<typeof savedSchema> | null = null;
try {
  saved = savedSchema.parse(JSON.parse(await readFile(file, 'utf8')));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
const store = await QueueStore.open(path.join(root, 'data'), saved?.branchId ?? randomUUID());
if (!saved) {
  const manager = await store.provision('manager', null);
  saved = { branchId: store.branchId, token: manager.token };
  await writeFile(file, JSON.stringify(saved), { flag: 'wx', mode: 0o600 });
}
const actor = await store.authenticate(saved.token);
if (actor.role !== 'manager') throw new Error('Preview manager key is not valid');
const operations = await createOperations(store, { root });
const speechDirectory = path.join(path.dirname(root), 'arabic-voice-library-free', 'speech-cache');
const voice = await localSpeechConfiguration(speechDirectory);
const server = createBranchServer(store, {
  operations,
  backupDirectory: path.join(root, 'backups'),
  speech: voice ? new NeuralSpeech({ directory: speechDirectory, ...voice }) : undefined,
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(
  process.env.QUEUE_PREVIEW_FILE!,
  JSON.stringify({
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    token: saved.token,
  }),
  { mode: 0o600 },
);
console.log('Local manager branch ready; operational records are created only by user actions.');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close(async () => {
      await operations.stop();
      await store.close();
      process.exit(0);
    });
    server.closeIdleConnections();
  });
