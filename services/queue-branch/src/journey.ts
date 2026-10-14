import { QueueError, type Actor, type QueueEvent, type Ticket } from '@saraf/queue-core';
import { bodies, type QueueStore } from './store';
export async function ticketJourney(store: QueueStore, actor: Actor, code: string, day: string) {
  if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
  if (!/^[A-Z]{1,3}-\d{1,12}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new QueueError('SEARCH', 'Enter ticket code and issue date', 400);
  const [ticket] = await bodies<Ticket>(
    store.db,
    "SELECT body FROM queue_tickets WHERE body->>'code'=$1 AND day=$2 LIMIT 1",
    [code, day],
  );
  if (!ticket) return { ticket: null, events: [], partial: false };
  const events = await bodies<QueueEvent>(
    store.db,
    "SELECT body FROM queue_events WHERE body->'payload'->'ticket'->>'id'=$1 ORDER BY sequence LIMIT 201",
    [ticket.id],
  );
  return { ticket, events: events.slice(0, 200), partial: events.length > 200 };
}
