import { z } from 'zod';
import { id, ticketSchema, counterSchema, serviceSchema, type QueueEvent } from './index';
import type { SqlTransaction } from './receiver';
export const headquartersStateSchema = z
  .object({
    branchId: id,
    acknowledged: z.number().int().nonnegative(),
    lastReceivedAt: z.string().datetime().nullable(),
    lastHeartbeatAt: z.string().datetime().nullable(),
    services: z.array(serviceSchema).max(20),
    counters: z.array(counterSchema).max(50),
    active: z.array(ticketSchema).max(50),
    waiting: z.array(ticketSchema).max(100),
    waitingCount: z.number().int().nonnegative(),
  })
  .strict();
export type HeadquartersState = z.infer<typeof headquartersStateSchema>;
export async function readHeadquartersState(tx: SqlTransaction, branchId: string) {
  id.parse(branchId);
  const state = (
    await tx.query<{
      acknowledged: number;
      received: Date | string | null;
      heartbeat: Date | string | null;
    }>(
      'SELECT acknowledged::int,last_received_at AS received,last_heartbeat_at AS heartbeat FROM queue_sync_branches WHERE branch_id=$1',
      [branchId],
    )
  ).rows[0];
  const config = (
    await tx.query<{ body: QueueEvent }>(
      "SELECT body FROM queue_sync_events WHERE branch_id=$1 AND body->>'kind'='configuration' ORDER BY sequence DESC LIMIT 1",
      [branchId],
    )
  ).rows[0]?.body.payload.configuration;
  const counters = (
    await tx.query<{ body: unknown }>(
      "SELECT body FROM queue_sync_counters WHERE branch_id=$1 AND COALESCE((body->>'archived')::boolean,false)=false ORDER BY counter_id LIMIT 50",
      [branchId],
    )
  ).rows.map(r => r.body);
  const active = (
    await tx.query<{ body: unknown }>(
      "SELECT body FROM queue_sync_tickets WHERE branch_id=$1 AND status IN ('called','serving') ORDER BY sequence DESC LIMIT 50",
      [branchId],
    )
  ).rows.map(r => r.body);
  const waiting = (
    await tx.query<{ body: unknown }>(
      "SELECT body FROM queue_sync_tickets WHERE branch_id=$1 AND status='waiting' ORDER BY body->>'queuedAt',ticket_id LIMIT 100",
      [branchId],
    )
  ).rows.map(r => r.body);
  const count = (
    await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM queue_sync_tickets WHERE branch_id=$1 AND status='waiting'",
      [branchId],
    )
  ).rows[0].count;
  const iso = (value: Date | string | null | undefined) =>
    value ? new Date(value).toISOString() : null;
  return headquartersStateSchema.parse({
    branchId,
    acknowledged: state?.acknowledged ?? 0,
    lastReceivedAt: iso(state?.received),
    lastHeartbeatAt: iso(state?.heartbeat),
    services: config?.services ?? [],
    counters,
    active,
    waiting,
    waitingCount: count,
  });
}
