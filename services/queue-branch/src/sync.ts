import { acknowledgementSchema, trustedEndpoint, QueueError } from '@saraf/queue-core';
import type { QueueStore } from './store';

export async function synchronize(
  store: QueueStore,
  endpoint: string,
  token: string,
  signal?: AbortSignal,
) {
  const url = trustedEndpoint(endpoint);
  const batch = await store.pending();
  const heartbeat = !batch.events.length;
  const payload = heartbeat
    ? {
        version: 1,
        kind: 'heartbeat',
        branchId: store.branchId,
        localRevision: await store.syncRevision(),
      }
    : batch;
  await store.syncAttempt();
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-queue-branch': store.branchId,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const code =
      response.status === 401 || response.status === 403
        ? 'AUTH'
        : response.status === 409
          ? 'RECONCILE'
          : 'SYNC';
    throw new QueueError(code, `SARAF synchronization returned ${response.status}`);
  }
  const ack = acknowledgementSchema.parse(await response.json());
  // An ACK must cover this entire batch, never events that were not sent.
  if (heartbeat) {
    if (ack.acknowledgedThrough > (payload as { localRevision: number }).localRevision)
      throw new QueueError('RECONCILE', 'Branch is behind headquarters');
    await store.replayFrom(ack.acknowledgedThrough);
    return;
  }
  if (ack.acknowledgedThrough !== batch.events.at(-1)!.sequence)
    throw new QueueError('ACK', 'Unexpected acknowledgement');
  await store.acknowledge(ack.acknowledgedThrough);
}

export function startSync(store: QueueStore, endpoint?: string, token?: string) {
  let stopped = false,
    failures = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    active: Promise<void> | undefined;
  const controller = new AbortController();
  if (!endpoint || !token) return async () => {};
  trustedEndpoint(endpoint);
  const run = () => {
    if (stopped) return;
    active = (async () => {
      try {
        await synchronize(store, endpoint, token, controller.signal);
        failures = 0;
      } catch (error) {
        failures++;
        if (!stopped) await store.syncAttempt(error instanceof QueueError ? error.code : 'NETWORK');
      } finally {
        if (!stopped) {
          timer = setTimeout(
            run,
            failures ? Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) : 10000,
          );
          timer.unref();
        }
      }
    })();
  };
  run();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller.abort();
    await active?.catch(() => {});
  };
}
