import { Select } from './Select';
import { useEffect, useState } from 'react';
import type { Command, Counter } from '@saraf/queue-core';
import { counterNumber as numberOf } from '@saraf/queue-core/counters';
import { Plus, EditPencil, Trash, Pause, Play, RefreshDouble, StatsUpSquare } from 'iconoir-react';
import type { QueueController } from './useQueue';
import { Form } from './Form';

export function CounterManagement({
  queue,
  onAnalyze,
}: {
  queue: QueueController;
  onAnalyze: (id: string) => void;
}) {
  const snapshot = queue.snapshot!;
  const [editing, setEditing] = useState<Counter | 'new' | null>(null);
  const [number, setNumber] = useState(1),
    [label, setLabel] = useState(''),
    [serviceIds, setServiceIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<Counter | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof window.queue.devices>>>([]);
  useEffect(() => {
    let alive = true;
    void window.queue
      .devices()
      .then(value => {
        if (alive) setDevices(value);
      })
      .catch(() => {
        if (alive) setError('تعذر قراءة إسناد الموظفين.');
      });
    return () => {
      alive = false;
    };
  }, [snapshot.revision]);
  const run = async (command: Command) => {
    setBusy(true);
    setError('');
    setPending(command);
    try {
      await window.queue.command(command);
      setPending(null);
      setEditing(null);
      setDeleting(null);
      await queue.refresh(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر تنفيذ الإجراء.';
      if (/\[HTTP_4\d\d\]/.test(message)) setPending(null);
      setError(message);
      await queue.refresh(true);
    } finally {
      setBusy(false);
    }
  };
  const begin = (counter: Counter | 'new') => {
    setEditing(counter);
    setError('');
    setNumber(
      counter === 'new'
        ? ([1, 2, 3, 4, 5, 6].find(n => !snapshot.counters.some(c => numberOf(c) === n)) ?? 1)
        : numberOf(counter) || 1,
    );
    setLabel(counter === 'new' ? '' : counter.name.split(' · ').slice(1).join(' · '));
    setServiceIds(
      counter === 'new'
        ? snapshot.services.filter(s => s.active).map(s => s.id)
        : counter.serviceIds,
    );
  };
  const disabled = busy || !queue.online || !!pending;
  return (
    <section className="counter-management">
      <div className="counter-toolbar">
        <div>
          <h2>إدارة الكاونترات</h2>
          <p>{snapshot.counters.length} من 6 كاونترات · حالة التذاكر والإسناد من خادم الفرع</p>
        </div>
        <button
          className="primary"
          disabled={disabled || snapshot.counters.length >= 6}
          onClick={() => begin('new')}
        >
          <Plus /> إنشاء كاونتر
        </button>
      </div>
      {editing && (
        <Form
          className="counter-editor"
          onSubmit={e => {
            e.preventDefault();
            if (disabled) return;
            void run(
              editing === 'new'
                ? {
                    requestId: crypto.randomUUID(),
                    action: 'create_counter',
                    number,
                    label,
                    serviceIds,
                  }
                : {
                    requestId: crypto.randomUUID(),
                    action: 'edit_counter',
                    counterId: editing.id,
                    expectedRevision: editing.revision,
                    number,
                    label,
                    serviceIds,
                  },
            );
          }}
        >
          <h3>{editing === 'new' ? 'كاونتر جديد' : `تعديل ${editing.name}`}</h3>
          <div className="config-row">
            <label>
              رقم الكاونتر
              <Select
                value={number}
                disabled={disabled}
                onChange={e => setNumber(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <option
                    key={n}
                    value={n}
                    disabled={snapshot.counters.some(
                      c => c.id !== (editing === 'new' ? '' : editing.id) && numberOf(c) === n,
                    )}
                  >
                    {n}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              اسم إضافي · اختياري
              <input
                value={label}
                maxLength={50}
                disabled={disabled}
                onChange={e => setLabel(e.target.value)}
                placeholder="مثال: الحوالات"
              />
            </label>
          </div>
          <fieldset disabled={disabled}>
            <legend>الخدمات المتاحة</legend>
            {snapshot.services.map(s => (
              <label className="checkbox" key={s.id}>
                <input
                  type="checkbox"
                  checked={serviceIds.includes(s.id)}
                  onChange={e =>
                    setServiceIds(
                      e.target.checked
                        ? [...serviceIds, s.id]
                        : serviceIds.filter(id => id !== s.id),
                    )
                  }
                />
                {s.name}
                {!s.active && ' · غير مفعلة'}
              </label>
            ))}
          </fieldset>
          {editing === 'new' && (
            <p>يُنشأ الكاونتر متوقفًا. أسند جهاز الموظف، ثم فعّل استقبال التذاكر.</p>
          )}
          <div className="row">
            <button className="primary" disabled={disabled || !serviceIds.length}>
              حفظ الكاونتر
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>
              إلغاء
            </button>
          </div>
        </Form>
      )}
      <div className="counter-cards">
        {[...snapshot.counters]
          .sort((a, b) => a.name.localeCompare(b.name, 'ar', { numeric: true }))
          .map(c => {
            const ticket = snapshot.active.find(t => t.counterId === c.id),
              employee = devices.find(
                d => d.enabled && d.role === 'teller' && d.counterId === c.id,
              );
            return (
              <article className="counter-card" key={c.id} data-management-counter-id={c.id}>
                <div className="counter-card-heading">
                  <h3>{c.name}</h3>
                  <span>
                    {c.paused
                      ? 'الاستقبال متوقف'
                      : ticket?.status === 'serving'
                        ? 'في الخدمة'
                        : ticket
                          ? 'تم النداء'
                          : 'متاح'}
                  </span>
                </div>
                <strong className="counter-current-ticket" dir="ltr">
                  {ticket?.code ?? '—'}
                </strong>
                <p>
                  {employee
                    ? `${employee.name ?? 'موظف مسند'} · ${employee.staffRef ?? 'معرّف غير مسجل'}`
                    : 'لا يوجد مفتاح موظف مفعّل لهذا الكاونتر'}
                </p>
                <small>
                  {snapshot.services
                    .filter(s => c.serviceIds.includes(s.id))
                    .map(s => s.name)
                    .join(' · ')}
                </small>
                <div className="counter-actions">
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void run({
                        requestId: crypto.randomUUID(),
                        action: c.paused ? 'resume' : 'pause',
                        counterId: c.id,
                        expectedRevision: c.revision,
                      })
                    }
                  >
                    {c.paused ? <Play /> : <Pause />}
                    {c.paused ? 'تفعيل الاستقبال' : 'إيقاف الاستقبال'}
                  </button>
                  <button
                    disabled={disabled || !ticket || c.paused}
                    onClick={() =>
                      void run({
                        requestId: crypto.randomUUID(),
                        action: 'recall',
                        counterId: c.id,
                        expectedRevision: c.revision,
                      })
                    }
                  >
                    <RefreshDouble /> إعادة النداء
                  </button>
                  <button disabled={disabled} onClick={() => begin(c)}>
                    <EditPencil /> تعديل
                  </button>
                  <button onClick={() => onAnalyze(c.id)}>
                    <StatsUpSquare /> تحليل الأداء
                  </button>
                  <button
                    disabled={disabled || !!ticket || snapshot.counters.length <= 1}
                    title={ticket ? 'أنه التذكرة الحالية أو حوّلها أولًا' : undefined}
                    onClick={() => setDeleting(c)}
                  >
                    <Trash /> حذف
                  </button>
                </div>
              </article>
            );
          })}
      </div>
      {deleting && (
        <div className="counter-delete-confirm" role="region" aria-label="تأكيد حذف الكاونتر">
          <h3>حذف {deleting.name}؟</h3>
          <p>
            سيختفي من شاشات الخدمة وتُلغى مفاتيح الأجهزة المسندة إليه. تبقى التذاكر السابقة وتاريخ
            التحليل محفوظين.
          </p>
          <div className="row">
            <button
              disabled={disabled}
              onClick={() =>
                void run({
                  requestId: crypto.randomUUID(),
                  action: 'delete_counter',
                  counterId: deleting.id,
                  expectedRevision: deleting.revision,
                })
              }
            >
              تأكيد حذف الكاونتر
            </button>
            <button disabled={busy} onClick={() => setDeleting(null)}>
              إلغاء الحذف
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {pending && !busy && (
        <button disabled={!queue.online} onClick={() => void run(pending)}>
          إعادة محاولة الإجراء نفسه
        </button>
      )}
    </section>
  );
}
