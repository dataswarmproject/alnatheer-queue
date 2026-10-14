import { analyzeQueue } from './analytics';
import { id, QueueError, type Counter, type QueueEvent } from './index';
import type { SqlTransaction } from './receiver';

// Only these two trusted identifiers can become SQL identifiers.
export async function loadQueueAnalytics(
  db: SqlTransaction,
  source: 'queue_events' | 'queue_sync_events',
  branchId: string,
  from: string,
  to: string,
  slaSeconds?: number,
) {
  id.parse(branchId);
  const start = Date.parse(from),
    end = Date.parse(to);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 31 * 86400000 ||
    end > Date.now() + 1000 ||
    (slaSeconds != null && (!Number.isFinite(slaSeconds) || slaSeconds < 1 || slaSeconds > 86400))
  )
    throw new QueueError('PERIOD', 'Choose a valid period of up to 31 days', 400);
  from = new Date(start).toISOString();
  to = new Date(end).toISOString();
  const branch = source === 'queue_sync_events' ? 'branch_id=$1' : "body->>'branchId'=$1";
  const read = async (text: string, params: (string | number | null)[]) =>
    (await db.query<{ body: QueueEvent }>(text, params)).rows.map(r => r.body);
  const events = await read(
    `SELECT body FROM ${source} WHERE ${branch} AND (body->>'occurredAt') >= $2 AND (body->>'occurredAt') < $3 ORDER BY sequence LIMIT 50001`,
    [branchId, from, to],
  );
  const config = async (until: string) =>
    (
      await read(
        `SELECT body FROM ${source} WHERE ${branch} AND body->>'kind'='configuration' AND (body->>'occurredAt')<$2 ORDER BY sequence DESC LIMIT 1`,
        [branchId, until],
      )
    )[0]?.payload.configuration;
  const latestConfig = await config(to),
    openingConfig = await config(from);
  const before = await read(
    `SELECT DISTINCT ON (body->'payload'->'counter'->>'id') body FROM ${source} WHERE ${branch} AND body->'payload'->'counter'->>'id' IS NOT NULL AND (body->>'occurredAt')<$2 ORDER BY body->'payload'->'counter'->>'id',sequence DESC LIMIT 50`,
    [branchId, from],
  );
  const opening = new Map<string, Counter>(openingConfig?.counters.map(c => [c.id, c]) ?? []);
  for (const e of before)
    if (e.payload.counter) opening.set(e.payload.counter.id, e.payload.counter);
  const openingEvents = await read(
    `SELECT body FROM (SELECT DISTINCT ON (body->'payload'->'ticket'->>'id') body FROM ${source} WHERE ${branch} AND body->'payload'->'ticket'->>'id' IS NOT NULL AND (body->>'occurredAt')<$2 ORDER BY body->'payload'->'ticket'->>'id',sequence DESC) prior WHERE body->'payload'->'ticket'->>'status' IN ('waiting','called','serving') LIMIT 50001`,
    [branchId, from],
  );
  const openingTickets = openingEvents.flatMap(e => (e.payload.ticket ? [e.payload.ticket] : [])),
    servingIds = openingTickets.filter(t => t.status === 'serving').map(t => t.id);
  const openingLegs = servingIds.length
    ? await read(
        `SELECT DISTINCT ON (body->'payload'->'ticket'->>'id') body FROM ${source} WHERE ${branch} AND body->>'kind'='start' AND body->'payload'->'ticket'->>'id' IN (SELECT jsonb_array_elements_text($2::jsonb)) AND (body->>'occurredAt')<$3 ORDER BY body->'payload'->'ticket'->>'id',sequence DESC LIMIT 50`,
        [branchId, JSON.stringify(servingIds), from],
      )
    : [];
  return analyzeQueue(events.slice(0, 50000), {
    from,
    to,
    counters: latestConfig?.counters ?? [],
    services: latestConfig?.services ?? [],
    openingCounters: Array.from(opening.values()),
    openingTickets,
    openingLegs,
    staff: [],
    partial: events.length > 50000 || openingEvents.length > 50000,
    slaSeconds,
  });
}
