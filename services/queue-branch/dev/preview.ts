// Explicit local UI preview only; never included in the production host or installer.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { QueueStore } from '../src/store';
import { createBranchServer } from '../src/http';
const store = await QueueStore.open('memory://', randomUUID());
const manager = await store.provision('manager', null),
  serviceId = randomUUID(),
  counterId = randomUUID();
await store.configure(manager, {
  services: [{ id: serviceId, name: 'معاينة محلية', prefix: 'A', active: true }],
  counters: [
    {
      id: counterId,
      name: 'معاينة محلية · كاونتر ١',
      serviceIds: [serviceId],
      paused: false,
      revision: 0,
    },
  ],
});
const teller = await store.provision('teller', counterId, {
  name: 'معاينة محلية',
  staffRef: 'LOCAL-PREVIEW',
});
const display = await store.provision('display', null);
const server = createBranchServer(store);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
await writeFile(
  process.env.QUEUE_PREVIEW_FILE!,
  JSON.stringify({
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    token: teller.token,
    displayToken: display.token,
  }),
  { mode: 0o600 },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () =>
    server.close(async () => {
      await store.close();
      process.exit(0);
    }),
  );
