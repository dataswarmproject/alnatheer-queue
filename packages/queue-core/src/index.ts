import { z } from 'zod';

export const id = z.string().uuid();
export const serviceSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    nameEn: z.string().trim().min(1).max(80).optional(),
    prefix: z.string().regex(/^[A-Z]{1,3}$/),
    active: z.boolean(),
  })
  .strict();
export const counterSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(80),
    serviceIds: z.array(id).min(1).max(20),
    paused: z.boolean(),
    revision: z.number().int().nonnegative(),
    number: z.number().int().min(1).max(10).optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export const ticketSchema = z
  .object({
    id,
    code: z.string().max(20),
    serviceId: id,
    originalServiceId: id,
    counterId: id.nullable(),
    status: z.enum(['waiting', 'called', 'serving', 'completed', 'no_show']),
    issuedAt: z.string().datetime(),
    queuedAt: z.string().datetime(),
    calledAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    printRequired: z.boolean().optional(),
    printedAt: z.string().datetime().nullable().optional(),
    issuedBy: id.optional(),
  })
  .strict();
export const roleSchema = z.enum(['manager', 'teller', 'kiosk', 'display']);
export type Role = z.infer<typeof roleSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Counter = z.infer<typeof counterSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type Actor = { id: string; role: Role; counterId: string | null };

export const configurationSchema = z
  .object({
    services: z.array(serviceSchema).min(1).max(20),
    counters: z.array(counterSchema).min(1).max(50),
  })
  .strict();
const commandBase = { requestId: id, expectedRevision: z.number().int().nonnegative().optional() };
export const commandSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...commandBase,
      action: z.literal('issue'),
      serviceId: id,
      requirePrint: z.literal(true).optional(),
    })
    .strict(),
  z.object({ ...commandBase, action: z.literal('printed'), ticketId: id }).strict(),
  z.object({ ...commandBase, action: z.literal('transfer'), serviceId: id }).strict(),
  ...(['next', 'start', 'complete', 'no_show'] as const).map(action =>
    z.object({ ...commandBase, action: z.literal(action) }).strict(),
  ),
  ...(['recall', 'pause', 'resume'] as const).map(action =>
    z.object({ ...commandBase, action: z.literal(action), counterId: id.optional() }).strict(),
  ),
  z
    .object({
      ...commandBase,
      action: z.literal('create_counter'),
      number: z.number().int().min(1).max(6),
      label: z.string().trim().max(50),
      serviceIds: z.array(id).min(1).max(20),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      action: z.literal('edit_counter'),
      counterId: id,
      expectedRevision: z.number().int().nonnegative(),
      number: z.number().int().min(1).max(6),
      label: z.string().trim().max(50),
      serviceIds: z.array(id).min(1).max(20),
    })
    .strict(),
  z
    .object({
      ...commandBase,
      action: z.literal('delete_counter'),
      counterId: id,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const eventSchema = z
  .object({
    id,
    branchId: id,
    sequence: z.number().int().positive().safe(),
    actorId: id,
    actor: z
      .object({
        role: roleSchema,
        counterId: id.nullable(),
        name: z.string().max(80).nullable(),
        staffRef: z.string().max(80).nullable(),
      })
      .strict(),
    kind: z.enum([
      'configuration',
      'issue',
      'printed',
      'next',
      'recall',
      'pause',
      'resume',
      'start',
      'complete',
      'no_show',
      'transfer',
    ]),
    occurredAt: z
      .string()
      .datetime()
      .refine(
        value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
        'Use canonical UTC milliseconds',
      ),
    payload: z
      .object({
        ticket: ticketSchema.nullable(),
        counter: counterSchema.nullable(),
        configuration: configurationSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type QueueEvent = z.infer<typeof eventSchema>;
export const heartbeatSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('heartbeat'),
    branchId: id,
    localRevision: z.number().int().nonnegative().safe(),
  })
  .strict();
export const batchSchema = z
  .object({ version: z.literal(1), branchId: id, events: z.array(eventSchema).min(1).max(100) })
  .strict()
  .superRefine((batch, ctx) => {
    batch.events.forEach((event, i) => {
      if (
        event.branchId !== batch.branchId ||
        (i > 0 && event.sequence !== batch.events[i - 1].sequence + 1)
      )
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid branch or sequence' });
    });
  });
export const snapshotSchema = z
  .object({
    branchId: id,
    actor: z.object({ id, role: roleSchema, counterId: id.nullable() }).strict(),
    revision: z.number().int().nonnegative().safe(),
    counter: counterSchema.nullable(),
    current: ticketSchema.nullable(),
    pendingPrintTicket: ticketSchema.nullable().optional(),
    waiting: z.array(ticketSchema).max(100),
    active: z.array(ticketSchema).max(50),
    services: z.array(serviceSchema).max(20),
    counters: z.array(counterSchema).max(50),
    totals: z
      .object({
        waiting: z.number().int(),
        completed: z.number().int(),
        noShow: z.number().int(),
        meanWaitSeconds: z.number().nullable(),
        p90WaitSeconds: z.number().nullable(),
      })
      .strict(),
    sync: z
      .object({
        pending: z.number().int(),
        acknowledged: z.number().int(),
        lastSuccess: z.string().datetime().nullable(),
        configured: z.boolean(),
        lastAttempt: z.string().datetime().nullable().optional(),
        lastError: z.string().max(80).nullable().optional(),
      })
      .strict(),
    serverTime: z.string().datetime(),
    announcements: z
      .array(
        z
          .object({
            sequence: z.number().int().positive(),
            code: z.string().max(20),
            ticketId: id,
            counterId: id,
            counterName: z.string().max(80),
            occurredAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export const commandResultSchema = z
  .object({ ticket: ticketSchema.nullable(), counter: counterSchema.nullable() })
  .strict();
export const acknowledgementSchema = z
  .object({ acknowledgedThrough: z.number().int().nonnegative().safe() })
  .strict();

export class QueueError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

export function businessDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// The branch URL is entered by the operator, never by fetched page content.
export function trustedEndpoint(raw: string): URL {
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new QueueError('ENDPOINT', 'HTTPS is required outside loopback', 400);
  return url;
}
