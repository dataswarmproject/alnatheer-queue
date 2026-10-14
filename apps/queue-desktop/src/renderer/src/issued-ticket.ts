import type { Snapshot, Ticket } from '@saraf/queue-core';

export function mergeIssuedTicket(
  previous: Ticket | null,
  snapshot: Pick<Snapshot, 'pendingPrintTicket' | 'waiting' | 'active'>,
): Ticket | null {
  const incoming =
    snapshot.pendingPrintTicket ??
    (previous
      ? ([...snapshot.waiting, ...snapshot.active].find(ticket => ticket.id === previous.id) ??
        previous)
      : null);
  // A poll started before native print acknowledgement may resolve afterward.
  if (previous?.printedAt && incoming?.id === previous.id && !incoming.printedAt) return previous;
  return incoming;
}
