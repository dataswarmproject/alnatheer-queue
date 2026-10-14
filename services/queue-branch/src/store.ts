import { PGlite, type Transaction } from '@electric-sql/pglite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import {
  configurationSchema,
  commandSchema,
  id,
  businessDay,
  QueueError,
  type Actor,
  type Role,
  type Counter,
  type Ticket,
  type Service,
  type Snapshot,
  type QueueEvent,
} from '@saraf/queue-core';
import { branchSchema } from './schema';
import { applyCommand } from './commands';
import { lockDatabase } from './lock';
import { isCounterMutation, mutateCounter } from './counters';
import { counterNumber } from '@saraf/queue-core/counters';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type Query = Pick<PGlite, 'query'>;
export async function bodies<T>(db: Query, text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<{ body: T }>(text, params)).rows.map(row => row.body);
}
export class QueueStore {
  private maintenance: { token: string; owner: string; until: number } | null = null;
  maintenanceUntil() {
    return this.maintenance && this.maintenance.until > Date.now()
      ? new Date(this.maintenance.until).toISOString()
      : null;
  }
  private requireWritable() {
    if (this.maintenanceUntil())
      throw new QueueError(
        'MAINTENANCE',
        'الفرع في وضع الصيانة. أعد المحاولة بعد انتهاء التحديث.',
        503,
      );
  }
  async enterMaintenance(actor: Actor) {
    if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
    return this.db.transaction(async tx => {
      await this.requireDevice(tx, actor);
      this.requireWritable();
      const count = (
        await tx.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM queue_tickets WHERE status IN ('waiting','called','serving')",
        )
      ).rows[0].count;
      if (count)
        throw new QueueError(
          'ACTIVE_TICKETS',
          'أغلق جميع التذاكر المفتوحة قبل الصيانة أو تثبيت التحديث.',
        );
      this.maintenance = {
        token: randomBytes(32).toString('hex'),
        owner: actor.id,
        until: Date.now() + 10 * 60000,
      };
      return {
        token: this.maintenance.token,
        until: new Date(this.maintenance.until).toISOString(),
      };
    });
  }
  async validateMaintenance(actor: Actor, token: string) {
    await this.db.transaction(tx => this.requireDevice(tx, actor));
    if (
      actor.role !== 'manager' ||
      !this.maintenanceUntil() ||
      this.maintenance?.owner !== actor.id ||
      this.maintenance?.token !== token
    )
      throw new QueueError('MAINTENANCE_TOKEN', 'انتهت صلاحية الصيانة أو لا تخص هذا المدير.', 403);
  }
  async leaveMaintenance(actor: Actor, token: string) {
    await this.validateMaintenance(actor, token);
    this.maintenance = null;
  }
  private constructor(
    public db: PGlite,
    public branchId: string,
    private release: () => Promise<void>,
    public dataDirectory: string,
  ) {}
  static async open(directory: string, branchId: string) {
    id.parse(branchId);
    if (directory !== 'memory://') await mkdir(directory, { recursive: true });
    const release = await lockDatabase(directory);
    const db = new PGlite(directory);
    try {
      await db.exec(branchSchema);
      await db.query('INSERT INTO queue_meta(branch_id) VALUES ($1) ON CONFLICT DO NOTHING', [
        branchId,
      ]);
      const meta = (await db.query<{ branch_id: string }>('SELECT branch_id FROM queue_meta'))
        .rows[0];
      if (meta.branch_id !== branchId)
        throw new QueueError('BRANCH_ID', 'Database belongs to another branch');
      return new QueueStore(db, branchId, release, directory);
    } catch (error) {
      await db.close().catch(() => {});
      await release();
      throw error;
    }
  }
  async close() {
    await this.db.close();
    await this.release();
  }
  async provision(
    role: Role,
    counterId: string | null,
    staff: { name?: string; staffRef?: string } = {},
    authorizedBy?: Actor,
  ): Promise<Actor & { token: string }> {
    if (role === 'teller' && !counterId) throw new QueueError('COUNTER', 'Assign a counter');
    if (!['teller', 'display'].includes(role) && counterId)
      throw new QueueError(
        'COUNTER',
        'Only teller and display devices can be assigned a counter',
        400,
      );
    const actor = { id: randomUUID(), role, counterId, token: randomBytes(32).toString('hex') };
    try {
      await this.db.transaction(async tx => {
        this.requireWritable();
        if (authorizedBy) {
          if (authorizedBy.role !== 'manager')
            throw new QueueError('FORBIDDEN', 'Manager required', 403);
          await this.requireDevice(tx, authorizedBy);
        }
        if (
          counterId &&
          !(
            await bodies<Counter>(tx, 'SELECT body FROM queue_counters WHERE id=$1', [counterId])
          ).some(c => !c.archived)
        )
          throw new QueueError('COUNTER', 'الكاونتر غير متاح.');
        await tx.query(
          'INSERT INTO queue_devices(id,token_hash,role,counter_id,name,staff_ref) VALUES ($1,$2,$3,$4,$5,$6)',
          [
            actor.id,
            hash(actor.token),
            role,
            counterId,
            staff.name ?? null,
            staff.staffRef ?? null,
          ],
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new QueueError(
          'COUNTER_ASSIGNED',
          'Revoke the previous teller device before assigning this counter',
          409,
        );
      throw error;
    }
    return actor;
  }
  async devices(actor: Actor) {
    if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
    return this.db.transaction(async tx => {
      await this.requireDevice(tx, actor);
      return (
        await tx.query<{
          id: string;
          role: Role;
          counterId: string | null;
          name: string | null;
          staffRef: string | null;
          enabled: boolean;
        }>(
          'SELECT id,role,counter_id AS "counterId",name,staff_ref AS "staffRef",enabled FROM queue_devices ORDER BY id LIMIT 1000',
        )
      ).rows;
    });
  }
  async revoke(actor: Actor, deviceId: string) {
    if (actor.role !== 'manager' || actor.id === deviceId)
      throw new QueueError('FORBIDDEN', 'Cannot revoke this device', 403);
    await this.db.transaction(async tx => {
      this.requireWritable();
      await this.requireDevice(tx, actor);
      const pendingPrint = await bodies<Ticket>(
        tx,
        "SELECT body FROM queue_tickets WHERE status='waiting' AND body->>'printRequired'='true' AND body->>'printedAt' IS NULL AND body->>'issuedBy'=$1 LIMIT 1",
        [deviceId],
      );
      if (pendingPrint.length)
        throw new QueueError(
          'PRINT_PENDING',
          'Print the pending receipt before revoking its issuing device',
        );
      const active = (
        await tx.query(
          "SELECT t.id FROM queue_tickets t JOIN queue_devices d ON d.counter_id=t.counter_id WHERE d.id=$1 AND t.status IN ('called','serving')",
          [deviceId],
        )
      ).rows;
      if (active.length)
        throw new QueueError(
          'ACTIVE_TICKET',
          'Finish active service before changing teller assignment',
        );
      await tx.query('UPDATE queue_devices SET enabled=false WHERE id=$1', [deviceId]);
    });
  }
  async authenticate(token: string): Promise<Actor> {
    const row = (
      await this.db.query<{ id: string; role: Role; counter_id: string | null }>(
        'SELECT id,role,counter_id FROM queue_devices WHERE token_hash=$1 AND enabled',
        [hash(token)],
      )
    ).rows[0];
    if (!row) throw new QueueError('AUTH', 'Device not authorized', 401);
    return { id: row.id, role: row.role, counterId: row.counter_id };
  }
  async configure(actor: Actor, input: unknown) {
    if (actor.role !== 'manager') throw new QueueError('FORBIDDEN', 'Manager required', 403);
    const config = configurationSchema.parse(input);
    if (
      new Set(config.services.map(s => s.id)).size !== config.services.length ||
      new Set(config.counters.map(c => c.id)).size !== config.counters.length
    )
      throw new QueueError('CONFIG', 'Duplicate configuration identifiers', 400);
    const services = new Set(config.services.map(s => s.id));
    if (config.counters.some(c => c.serviceIds.some(s => !services.has(s))))
      throw new QueueError('CONFIG', 'Unknown service', 400);
    await this.db.transaction(async tx => {
      this.requireWritable();
      await this.requireDevice(tx, actor);
      const oldServices = await bodies<Service>(tx, 'SELECT body FROM queue_services');
      const oldCounters = await bodies<Counter>(tx, 'SELECT body FROM queue_counters');
      if (config.counters.length > 6)
        throw new QueueError('COUNTER_LIMIT', 'الحد الأقصى للفرع ستة كاونترات.');
      if (config.counters.length + oldCounters.filter(c => c.archived).length > 50)
        throw new QueueError('COUNTER_HISTORY_LIMIT', 'بلغ سجل الكاونترات حدّه.');
      if (
        oldServices.some(
          s => !services.has(s.id) || config.services.find(n => n.id === s.id)?.prefix !== s.prefix,
        ) ||
        oldCounters.some(c => !c.archived && !config.counters.some(n => n.id === c.id))
      )
        throw new QueueError(
          'CONFIG',
          'Existing services and prefixes must be retained; deactivate services instead',
        );
      for (const s of config.services)
        await tx.query(
          'INSERT INTO queue_services(id,body,prefix) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET body=$2',
          [s.id, JSON.stringify(s), s.prefix],
        );
      for (const c of config.counters) {
        const old = oldCounters.find(o => o.id === c.id);
        if (c.archived || old?.archived)
          throw new QueueError(
            'CONFIG',
            'استخدم إدارة الكاونترات لحذف الكاونتر؛ لا يمكن إعادة تفعيل السجل المحذوف.',
          );
        const changed =
          old &&
          (old.name !== c.name ||
            old.number !== c.number ||
            JSON.stringify([...old.serviceIds].sort()) !==
              JSON.stringify([...c.serviceIds].sort()));
        if (changed && old.revision !== c.revision)
          throw new QueueError('STALE', 'تغيّرت إعدادات الكاونتر. حدّث البيانات ثم أعد المحاولة.');
        if (changed) {
          const current = (
            await bodies<Ticket>(
              tx,
              "SELECT body FROM queue_tickets WHERE counter_id=$1 AND status IN ('called','serving')",
              [c.id],
            )
          )[0];
          if (
            current &&
            (!c.serviceIds.includes(current.serviceId) || counterNumber(old) !== counterNumber(c))
          )
            throw new QueueError(
              'ACTIVE_TICKET',
              'لا تغيّر رقم الكاونتر أو خدمة التذكرة أثناء خدمتها.',
            );
        }
        const body = { ...c, paused: old?.paused ?? c.paused, revision: (old?.revision ?? -1) + 1 };
        await tx.query(
          'INSERT INTO queue_counters(id,body) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET body=$2',
          [c.id, JSON.stringify(body)],
        );
      }
      const updated = {
        services: config.services,
        counters: await bodies<Counter>(tx, 'SELECT body FROM queue_counters ORDER BY id'),
      };
      await this.record(tx, actor, 'configuration', {
        ticket: null,
        counter: null,
        configuration: updated,
      });
    });
  }
  async record(
    tx: Transaction,
    actor: Actor,
    kind: QueueEvent['kind'],
    payload: QueueEvent['payload'],
  ) {
    const { rows } = await tx.query<{ sequence: number }>(
      'UPDATE queue_meta SET next_sequence=next_sequence+1 RETURNING (next_sequence-1)::int AS sequence',
    );
    const assignment = (
      await tx.query<QueueEvent['actor']>(
        'SELECT role,counter_id AS "counterId",name,staff_ref AS "staffRef" FROM queue_devices WHERE id=$1',
        [actor.id],
      )
    ).rows[0];
    const event: QueueEvent = {
      id: randomUUID(),
      branchId: this.branchId,
      sequence: rows[0].sequence,
      actorId: actor.id,
      actor: assignment,
      kind,
      occurredAt: new Date().toISOString(),
      payload,
    };
    await tx.query('INSERT INTO queue_events(sequence,id,body) VALUES ($1,$2,$3)', [
      event.sequence,
      event.id,
      JSON.stringify(event),
    ]);
  }
  async command(actor: Actor, input: unknown) {
    const command = commandSchema.parse(input);
    const commandHash = hash(JSON.stringify(command));
    return this.db.transaction(async tx => {
      await this.requireDevice(tx, actor);
      const prior = (
        await tx.query<{
          command_hash: string;
          result: { ticket: Ticket | null; counter: Counter | null };
        }>('SELECT command_hash,result FROM queue_receipts WHERE actor_id=$1 AND request_id=$2', [
          actor.id,
          command.requestId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.command_hash !== commandHash)
          throw new QueueError('REUSED_REQUEST', 'Request identifier already used');
        return prior.result;
      }
      this.requireWritable();
      const mutation = isCounterMutation(command);
      const result = mutation
        ? await mutateCounter(tx, actor, command)
        : await applyCommand(tx, actor, command);
      const configuration = mutation
        ? {
            services: await bodies<Service>(tx, 'SELECT body FROM queue_services ORDER BY prefix'),
            counters: await bodies<Counter>(tx, 'SELECT body FROM queue_counters ORDER BY id'),
          }
        : null;
      await this.record(
        tx,
        actor,
        mutation ? 'configuration' : (command.action as QueueEvent['kind']),
        { ...result, configuration },
      );
      await tx.query(
        'INSERT INTO queue_receipts(actor_id,request_id,command_hash,result) VALUES ($1,$2,$3,$4)',
        [actor.id, command.requestId, commandHash, JSON.stringify(result)],
      );
      return result;
    });
  }
  async snapshot(actor: Actor, configured = false): Promise<Snapshot> {
    return this.db.transaction(async tx => {
      await this.requireDevice(tx, actor);
      const services = await bodies<Service>(tx, 'SELECT body FROM queue_services ORDER BY prefix');
      const counters = (
        await bodies<Counter>(tx, 'SELECT body FROM queue_counters ORDER BY id')
      ).filter(c => !c.archived);
      const counter = counters.find(c => c.id === actor.counterId) ?? null;
      const active = await bodies<Ticket>(
        tx,
        "SELECT body FROM queue_tickets WHERE status IN ('called','serving') ORDER BY queued_at LIMIT 50",
      );
      const waiting = await bodies<Ticket>(
        tx,
        actor.role === 'teller'
          ? "SELECT body FROM queue_tickets WHERE status='waiting' AND (COALESCE(body->>'printRequired','false')<>'true' OR body->>'printedAt' IS NOT NULL) AND service_id=ANY($1::uuid[]) AND service_id IN (SELECT id FROM queue_services WHERE (body->>'active')::boolean) ORDER BY queued_at,id LIMIT 100"
          : "SELECT body FROM queue_tickets WHERE status='waiting' ORDER BY queued_at,id LIMIT 100",
        actor.role === 'teller' ? [counter?.serviceIds ?? []] : [],
      );
      const pendingPrintTicket = ['kiosk', 'manager'].includes(actor.role)
        ? ((
            await bodies<Ticket>(
              tx,
              "SELECT body FROM queue_tickets WHERE status='waiting' AND body->>'printRequired'='true' AND body->>'printedAt' IS NULL AND body->>'issuedBy'=$1 ORDER BY issued_at,id LIMIT 1",
              [actor.id],
            )
          )[0] ?? null)
        : null;
      const calls = await bodies<QueueEvent>(
        tx,
        "SELECT body FROM queue_events WHERE body->>'kind' IN ('next','recall') AND ($1::text IS NULL OR body->'payload'->'counter'->>'id'=$1) ORDER BY sequence DESC LIMIT 50",
        [actor.role === 'display' ? actor.counterId : null],
      );
      const announcements = calls.reverse().flatMap(e =>
        e.payload.ticket && e.payload.counter
          ? [
              {
                sequence: e.sequence,
                code: e.payload.ticket.code,
                ticketId: e.payload.ticket.id,
                counterId: e.payload.counter.id,
                counterName: e.payload.counter.name,
                occurredAt: e.occurredAt,
              },
            ]
          : [],
      );
      const totals = (
        await tx.query<Snapshot['totals']>(
          `SELECT (SELECT count(*)::int FROM queue_tickets WHERE status='waiting' AND ($2::boolean=false OR ((COALESCE(body->>'printRequired','false')<>'true' OR body->>'printedAt' IS NOT NULL) AND service_id=ANY($3::uuid[]) AND service_id IN (SELECT id FROM queue_services WHERE (body->>'active')::boolean)))) AS waiting, count(*) FILTER(WHERE status='completed')::int AS completed, count(*) FILTER(WHERE status='no_show')::int AS "noShow", avg(extract(epoch FROM (body->>'startedAt')::timestamptz-issued_at)) FILTER(WHERE body->>'startedAt' IS NOT NULL)::float AS "meanWaitSeconds", percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (body->>'startedAt')::timestamptz-issued_at)) FILTER(WHERE body->>'startedAt' IS NOT NULL)::float AS "p90WaitSeconds" FROM queue_tickets WHERE day=$1`,
          [businessDay(), actor.role === 'teller', counter?.serviceIds ?? []],
        )
      ).rows[0];
      const meta = (
        await tx.query<{
          acknowledged: number;
          revision: number;
          last_success: string | null;
          pending: number;
          last_attempt: string | null;
          last_error: string | null;
        }>(
          'SELECT acknowledged::int,(next_sequence-1)::int AS revision,last_success,last_attempt,last_error,(next_sequence-1-acknowledged)::int AS pending FROM queue_meta',
        )
      ).rows[0];
      return {
        branchId: this.branchId,
        actor,
        revision: meta.revision,
        counter,
        current: active.find(t => t.counterId === actor.counterId) ?? null,
        active,
        waiting,
        pendingPrintTicket,
        services,
        counters,
        totals,
        sync: {
          pending: meta.pending,
          acknowledged: meta.acknowledged,
          lastSuccess: meta.last_success,
          configured,
          lastAttempt: meta.last_attempt,
          lastError: meta.last_error,
        },
        serverTime: new Date().toISOString(),
        announcements,
      };
    });
  }
  private async requireDevice(tx: Transaction, actor: Actor) {
    const row = (
      await tx.query<{ role: Role; counter_id: string | null }>(
        'SELECT role,counter_id FROM queue_devices WHERE id=$1 AND enabled',
        [actor.id],
      )
    ).rows[0];
    if (!row || row.role !== actor.role || row.counter_id !== actor.counterId)
      throw new QueueError('AUTH', 'Device not authorized', 401);
  }
  async pending() {
    const events = await bodies<QueueEvent>(
      this.db,
      'SELECT body FROM queue_events WHERE sequence>(SELECT acknowledged FROM queue_meta) ORDER BY sequence LIMIT 100',
    );
    const bounded: QueueEvent[] = [];
    for (const event of events) {
      bounded.push(event);
      if (
        Buffer.byteLength(
          JSON.stringify({ version: 1, branchId: this.branchId, events: bounded }),
        ) > 240000
      ) {
        bounded.pop();
        break;
      }
    }
    return { version: 1 as const, branchId: this.branchId, events: bounded };
  }
  async acknowledge(sequence: number) {
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new QueueError('ACK', 'Invalid acknowledgement');
    await this.db.query(
      'UPDATE queue_meta SET acknowledged=$1,last_success=$2,last_error=NULL WHERE acknowledged<=$1 AND next_sequence>$1',
      [sequence, new Date().toISOString()],
    );
  }
  async syncAttempt(error: string | null = null) {
    await this.db.query('UPDATE queue_meta SET last_attempt=$1,last_error=$2', [
      new Date().toISOString(),
      error,
    ]);
  }
  async syncRevision() {
    return (
      await this.db.query<{ revision: number }>(
        'SELECT (next_sequence-1)::int AS revision FROM queue_meta',
      )
    ).rows[0].revision;
  }
  async replayFrom(sequence: number) {
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new QueueError('ACK', 'Invalid acknowledgement');
    await this.db.query(
      'UPDATE queue_meta SET acknowledged=$1,last_success=$2,last_error=NULL WHERE acknowledged>=$1 AND next_sequence>$1',
      [sequence, new Date().toISOString()],
    );
  }
}
