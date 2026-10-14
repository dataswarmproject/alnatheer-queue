import { loadQueueAnalytics } from '@saraf/queue-core/analytics-evidence';
import { QueueError, type Actor } from '@saraf/queue-core';
import type { QueueStore } from './store';
export async function branchAnalytics(
  store: QueueStore,
  actor: Actor,
  from: string,
  to: string,
  slaSeconds?: number,
) {
  if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
  return store.db.transaction(tx =>
    loadQueueAnalytics(tx, 'queue_events', store.branchId, from, to, slaSeconds),
  );
}
