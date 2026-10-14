import type { Transaction } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import {
  businessDay,
  QueueError,
  type Actor,
  type Command,
  type Counter,
  type Service,
  type Ticket,
} from '@saraf/queue-core';
import { bodies } from './store';

export async function applyCommand(
  tx: Transaction,
  actor: Actor,
  command: Command,
): Promise<{ ticket: Ticket | null; counter: Counter | null }> {
  const now = new Date().toISOString();
  if (command.action === 'printed') {
    if (!['kiosk', 'manager'].includes(actor.role))
      throw new QueueError('FORBIDDEN', 'Printing requires the issuing device', 403);
    const [ticket] = await bodies<Ticket>(
      tx,
      'SELECT body FROM queue_tickets WHERE id=$1 FOR UPDATE',
      [command.ticketId],
    );
    if (!ticket?.printRequired || ticket.issuedBy !== actor.id)
      throw new QueueError('FORBIDDEN', 'Printing requires the issuing device', 403);
    if (!ticket.printedAt) {
      if (ticket.status !== 'waiting') throw new QueueError('STATE', 'Ticket is no longer waiting');
      ticket.printedAt = now;
      await tx.query('UPDATE queue_tickets SET body=$2 WHERE id=$1', [
        ticket.id,
        JSON.stringify(ticket),
      ]);
    }
    return { ticket, counter: null };
  }
  if (command.action === 'issue') {
    if (!['kiosk', 'manager'].includes(actor.role))
      throw new QueueError('FORBIDDEN', 'Ticket issuance is not permitted', 403);
    const [pending] = await bodies<Ticket>(
      tx,
      "SELECT body FROM queue_tickets WHERE status='waiting' AND body->>'printRequired'='true' AND body->>'printedAt' IS NULL AND body->>'issuedBy'=$1 LIMIT 1",
      [actor.id],
    );
    if (pending)
      throw new QueueError('PRINT_PENDING', 'Print the existing ticket before issuing another');
    const [service] = await bodies<Service>(tx, 'SELECT body FROM queue_services WHERE id=$1', [
      command.serviceId,
    ]);
    if (!service?.active) throw new QueueError('SERVICE', 'Service unavailable');
    // The day and printed issuance timestamp must agree even if lookup crosses midnight.
    const day = businessDay(new Date(now));
    const { rows } = await tx.query<{ number: number }>(
      'INSERT INTO queue_sequences(service_id,day,next_value) VALUES ($1,$2,2) ON CONFLICT(service_id,day) DO UPDATE SET next_value=queue_sequences.next_value+1 RETURNING next_value-1 AS number',
      [service.id, day],
    );
    const ticket: Ticket = {
      id: randomUUID(),
      code: `${service.prefix}-${String(rows[0].number).padStart(3, '0')}`,
      serviceId: service.id,
      originalServiceId: service.id,
      counterId: null,
      status: 'waiting',
      issuedAt: now,
      queuedAt: now,
      calledAt: null,
      startedAt: null,
      completedAt: null,
      ...(command.requirePrint ? { printRequired: true, printedAt: null, issuedBy: actor.id } : {}),
    };
    await tx.query(
      'INSERT INTO queue_tickets(id,body,service_id,status,day,issued_at,queued_at) VALUES ($1,$2,$3,$4,$5,$6,$6)',
      [ticket.id, JSON.stringify(ticket), service.id, ticket.status, day, now],
    );
    return { ticket, counter: null };
  }
  const target = 'counterId' in command ? command.counterId : undefined;
  const supervised =
    actor.role === 'manager' && !!target && ['pause', 'resume', 'recall'].includes(command.action);
  if (
    !supervised &&
    (actor.role !== 'teller' || !actor.counterId || (target && target !== actor.counterId))
  )
    throw new QueueError('FORBIDDEN', 'Assigned teller required', 403);
  const [counter] = await bodies<Counter>(
    tx,
    'SELECT body FROM queue_counters WHERE id=$1 FOR UPDATE',
    [supervised ? target : actor.counterId],
  );
  if (!counter || counter.archived) throw new QueueError('COUNTER', 'Counter unavailable');
  if (command.expectedRevision !== counter.revision)
    throw new QueueError('STALE', 'Counter changed; refresh and retry');
  let [ticket] = await bodies<Ticket>(
    tx,
    "SELECT body FROM queue_tickets WHERE counter_id=$1 AND status IN ('called','serving')",
    [counter.id],
  );
  if (command.action === 'pause' || command.action === 'resume') {
    const desired = command.action === 'pause';
    if (counter.paused === desired)
      throw new QueueError('STATE', 'Counter already in requested state');
    counter.paused = desired;
  } else {
    // An in-progress service may be completed during a counter pause; no new work starts.
    if (counter.paused && command.action !== 'complete')
      throw new QueueError('PAUSED', 'Resume the counter first');
    if (command.action === 'next') {
      if (ticket) throw new QueueError('ACTIVE_TICKET', 'Finish the current ticket first');
      [ticket] = await bodies<Ticket>(
        tx,
        `SELECT body FROM queue_tickets WHERE status='waiting' AND (COALESCE(body->>'printRequired','false')<>'true' OR body->>'printedAt' IS NOT NULL) AND service_id=ANY($1::uuid[]) AND service_id IN (SELECT id FROM queue_services WHERE (body->>'active')::boolean) ORDER BY queued_at,id LIMIT 1 FOR UPDATE`,
        [counter.serviceIds],
      );
      if (!ticket) throw new QueueError('EMPTY', 'No waiting customers');
      ticket.status = 'called';
      ticket.counterId = counter.id;
      ticket.calledAt ??= now;
    } else {
      if (!ticket) throw new QueueError('NO_TICKET', 'No current ticket');
      switch (command.action) {
        case 'recall':
          break;
        case 'start':
          if (ticket.status !== 'called')
            throw new QueueError('STATE', 'Ticket already in service');
          ticket.status = 'serving';
          ticket.startedAt ??= now;
          break;
        case 'complete':
          if (ticket.status !== 'serving')
            throw new QueueError('STATE', 'Start service before completing');
          ticket.status = 'completed';
          ticket.completedAt = now;
          break;
        case 'no_show':
          if (ticket.status !== 'called' || ticket.startedAt)
            throw new QueueError('STATE', 'No-show is only available before service');
          ticket.status = 'no_show';
          ticket.completedAt = now;
          break;
        case 'transfer': {
          const [service] = await bodies<Service>(
            tx,
            'SELECT body FROM queue_services WHERE id=$1',
            [command.serviceId],
          );
          if (!service?.active) throw new QueueError('SERVICE', 'Transfer service unavailable');
          ticket.serviceId = service.id;
          ticket.counterId = null;
          ticket.status = 'waiting';
          ticket.queuedAt = now;
          break;
        }
      }
    }
    await tx.query(
      'UPDATE queue_tickets SET body=$2,service_id=$3,counter_id=$4,status=$5,queued_at=$6 WHERE id=$1',
      [
        ticket.id,
        JSON.stringify(ticket),
        ticket.serviceId,
        ticket.counterId,
        ticket.status,
        ticket.queuedAt,
      ],
    );
  }
  counter.revision++;
  await tx.query('UPDATE queue_counters SET body=$2 WHERE id=$1', [
    counter.id,
    JSON.stringify(counter),
  ]);
  return { ticket: ticket ?? null, counter };
}
