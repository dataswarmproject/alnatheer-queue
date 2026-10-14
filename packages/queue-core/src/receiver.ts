import { createHash } from 'node:crypto';
import { batchSchema, QueueError, heartbeatSchema } from './index';

export interface SqlTransaction {
  query<T>(text: string, params?: (string | number | null)[]): Promise<{ rows: T[] }>;
}
export interface SqlDatabase extends SqlTransaction {
  transaction<T>(work: (tx: SqlTransaction) => Promise<T>): Promise<T>;
}
export const inboxSchema = `
CREATE TABLE IF NOT EXISTS queue_sync_branches (branch_id uuid PRIMARY KEY, acknowledged bigint NOT NULL DEFAULT 0, last_received_at timestamptz);
ALTER TABLE queue_sync_branches ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;
CREATE TABLE IF NOT EXISTS queue_sync_events (branch_id uuid NOT NULL REFERENCES queue_sync_branches(branch_id), sequence bigint NOT NULL, event_id uuid NOT NULL UNIQUE, event_hash text NOT NULL, body jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(branch_id, sequence));
CREATE INDEX IF NOT EXISTS queue_sync_time ON queue_sync_events(branch_id,(body->>'occurredAt'),sequence);
CREATE INDEX IF NOT EXISTS queue_sync_configuration ON queue_sync_events(branch_id,sequence DESC) WHERE body->>'kind'='configuration';
CREATE TABLE IF NOT EXISTS queue_sync_tickets (branch_id uuid NOT NULL REFERENCES queue_sync_branches(branch_id),ticket_id uuid NOT NULL,status text NOT NULL,body jsonb NOT NULL,sequence bigint NOT NULL,PRIMARY KEY(branch_id,ticket_id));
CREATE INDEX IF NOT EXISTS queue_sync_ticket_status ON queue_sync_tickets(branch_id,status);
CREATE TABLE IF NOT EXISTS queue_sync_counters (branch_id uuid NOT NULL REFERENCES queue_sync_branches(branch_id),counter_id uuid NOT NULL,body jsonb NOT NULL,sequence bigint NOT NULL,PRIMARY KEY(branch_id,counter_id));
`;

export async function receiveEvents(db: SqlDatabase, input: unknown, authorizedBranch: string) {
  const batch = batchSchema.parse(input);
  if (batch.branchId !== authorizedBranch) throw new QueueError('FORBIDDEN', 'Wrong branch', 403);
  return db.transaction(async tx => {
    await tx.query(
      'INSERT INTO queue_sync_branches(branch_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [batch.branchId],
    );
    const state = (
      await tx.query<{ acknowledged: number }>(
        'SELECT acknowledged::int FROM queue_sync_branches WHERE branch_id=$1 FOR UPDATE',
        [batch.branchId],
      )
    ).rows[0];
    let acknowledged = state.acknowledged;
    for (const event of batch.events) {
      const eventHash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
      if (event.sequence <= acknowledged) {
        const prior = (
          await tx.query<{ event_hash: string }>(
            'SELECT event_hash FROM queue_sync_events WHERE branch_id=$1 AND sequence=$2',
            [batch.branchId, event.sequence],
          )
        ).rows[0];
        if (prior?.event_hash !== eventHash)
          throw new QueueError('DIVERGED', 'Branch history diverged; reconcile before syncing');
        continue;
      }
      if (event.sequence !== acknowledged + 1) throw new QueueError('GAP', 'Missing queue events');
      await tx.query(
        'INSERT INTO queue_sync_events(branch_id,sequence,event_id,event_hash,body) VALUES ($1,$2,$3,$4,$5)',
        [batch.branchId, event.sequence, event.id, eventHash, JSON.stringify(event)],
      );
      if (event.payload.ticket)
        await tx.query(
          'INSERT INTO queue_sync_tickets(branch_id,ticket_id,status,body,sequence) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(branch_id,ticket_id) DO UPDATE SET status=$3,body=$4,sequence=$5',
          [
            batch.branchId,
            event.payload.ticket.id,
            event.payload.ticket.status,
            JSON.stringify(event.payload.ticket),
            event.sequence,
          ],
        );
      const counters =
        event.payload.configuration?.counters ??
        (event.payload.counter ? [event.payload.counter] : []);
      for (const counter of counters)
        await tx.query(
          'INSERT INTO queue_sync_counters(branch_id,counter_id,body,sequence) VALUES ($1,$2,$3,$4) ON CONFLICT(branch_id,counter_id) DO UPDATE SET body=$3,sequence=$4',
          [batch.branchId, counter.id, JSON.stringify(counter), event.sequence],
        );
      acknowledged = event.sequence;
    }
    await tx.query(
      'UPDATE queue_sync_branches SET acknowledged=$2,last_received_at=now(),last_heartbeat_at=now() WHERE branch_id=$1',
      [batch.branchId, acknowledged],
    );
    // ACK only the submitted prefix, even when central has already received later events.
    return { acknowledgedThrough: batch.events.at(-1)!.sequence };
  });
}
export async function receiveHeartbeat(db: SqlDatabase, input: unknown, authorizedBranch: string) {
  const ping = heartbeatSchema.parse(input);
  if (ping.branchId !== authorizedBranch) throw new QueueError('FORBIDDEN', 'Wrong branch', 403);
  return db.transaction(async tx => {
    await tx.query(
      'INSERT INTO queue_sync_branches(branch_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [ping.branchId],
    );
    const state = (
      await tx.query<{ acknowledged: number }>(
        'SELECT acknowledged::int FROM queue_sync_branches WHERE branch_id=$1 FOR UPDATE',
        [ping.branchId],
      )
    ).rows[0];
    if (ping.localRevision < state.acknowledged)
      throw new QueueError(
        'DIVERGED',
        'Restored branch is behind headquarters; reconcile before accepting new work',
      );
    await tx.query('UPDATE queue_sync_branches SET last_heartbeat_at=now() WHERE branch_id=$1', [
      ping.branchId,
    ]);
    return { acknowledgedThrough: state.acknowledged };
  });
}
