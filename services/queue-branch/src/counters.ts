import { randomUUID } from 'node:crypto';
import type { Transaction } from '@electric-sql/pglite';
import {
  QueueError,
  type Actor,
  type Command,
  type Counter,
  type Service,
  type Ticket,
} from '@saraf/queue-core';
import { counterNumber } from '@saraf/queue-core/counters';
import { bodies } from './store';

export const isCounterMutation = (
  command: Command,
): command is Extract<Command, { action: 'create_counter' | 'edit_counter' | 'delete_counter' }> =>
  ['create_counter', 'edit_counter', 'delete_counter'].includes(command.action);

export async function mutateCounter(
  tx: Transaction,
  actor: Actor,
  command: Extract<Command, { action: 'create_counter' | 'edit_counter' | 'delete_counter' }>,
) {
  if (actor.role !== 'manager')
    throw new QueueError('FORBIDDEN', 'إدارة الكاونترات متاحة لمدير الفرع فقط.', 403);
  const counters = await bodies<Counter>(
    tx,
    'SELECT body FROM queue_counters ORDER BY id FOR UPDATE',
  );
  const old =
    command.action === 'create_counter' ? null : counters.find(c => c.id === command.counterId);
  if (command.action !== 'create_counter' && (!old || old.archived))
    throw new QueueError('COUNTER', 'الكاونتر غير متاح.');
  if (old && old.revision !== command.expectedRevision)
    throw new QueueError('STALE', 'تغيّر الكاونتر. حدّث البيانات ثم أعد المحاولة.');
  const current = old
    ? (
        await bodies<Ticket>(
          tx,
          "SELECT body FROM queue_tickets WHERE counter_id=$1 AND status IN ('called','serving')",
          [old.id],
        )
      )[0]
    : undefined;
  let counter: Counter;
  if (command.action === 'delete_counter') {
    if (current)
      throw new QueueError('ACTIVE_TICKET', 'أنهِ التذكرة الحالية أو حوّلها قبل حذف الكاونتر.');
    if (counters.filter(c => !c.archived).length <= 1)
      throw new QueueError('LAST_COUNTER', 'احتفظ بكاونتر واحد على الأقل.');
    counter = { ...old!, archived: true, paused: true, revision: old!.revision + 1 };
    await tx.query('UPDATE queue_devices SET enabled=false WHERE counter_id=$1', [counter.id]);
  } else {
    if (command.action === 'create_counter' && counters.filter(c => !c.archived).length >= 6)
      throw new QueueError('COUNTER_LIMIT', 'الحد الأقصى للفرع ستة كاونترات.');
    if (command.action === 'create_counter' && counters.length >= 50)
      throw new QueueError('COUNTER_HISTORY_LIMIT', 'بلغ سجل الكاونترات حدّه. راجع مسؤول النظام.');
    const services = await bodies<Service>(tx, 'SELECT body FROM queue_services');
    if (
      new Set(command.serviceIds).size !== command.serviceIds.length ||
      command.serviceIds.some(id => !services.some(s => s.id === id))
    )
      throw new QueueError('SERVICE', 'اختر خدمات صالحة دون تكرار.');
    if (!command.serviceIds.some(id => services.some(s => s.id === id && s.active)))
      throw new QueueError('SERVICE', 'اختر خدمة مفعلة واحدة على الأقل.');
    if (counters.some(c => !c.archived && c.id !== old?.id && counterNumber(c) === command.number))
      throw new QueueError('COUNTER_NUMBER', 'رقم الكاونتر مستخدم بالفعل.');
    if (
      current &&
      (!command.serviceIds.includes(current.serviceId) || counterNumber(old!) !== command.number)
    )
      throw new QueueError('ACTIVE_TICKET', 'لا تغيّر رقم الكاونتر أو خدمة التذكرة أثناء خدمتها.');
    counter = {
      id: old?.id ?? randomUUID(),
      number: command.number,
      name: `كاونتر ${command.number}${command.label ? ' · ' + command.label : ''}`,
      serviceIds: command.serviceIds,
      paused: old?.paused ?? true,
      revision: (old?.revision ?? -1) + 1,
    };
  }
  await tx.query(
    'INSERT INTO queue_counters(id,body) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET body=$2',
    [counter.id, JSON.stringify(counter)],
  );
  return { ticket: null, counter };
}
