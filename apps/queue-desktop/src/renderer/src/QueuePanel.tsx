import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import type { QueueController } from './useQueue';
import { Printer, Star } from 'iconoir-react';
import { Announcements } from './Announcements';
import { TellerActions } from './TellerActions';
import { Form } from './Form';

export function QueuePanel({
  queue,
  transfer,
  onTransferred,
  onTransfer,
}: {
  queue: QueueController;
  transfer: boolean;
  onTransferred: () => void;
  onTransfer: () => void;
}) {
  const snapshot = queue.snapshot!,
    ticket = snapshot.current,
    { issued, setIssued } = queue,
    [target, setTarget] = useState(''),
    [favoritesOpen, setFavoritesOpen] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  const teller = snapshot.actor.role === 'teller',
    canIssue = ['kiosk', 'manager'].includes(snapshot.actor.role);
  useEffect(() => {
    if (transfer) select.current?.focus();
  }, [transfer]);
  return (
    <section className="queue-panel">
      {snapshot.actor.role === 'display' && <Announcements snapshot={snapshot} />}
      {teller && (
        <>
          <div className="current-card teller-current">
            <span>الرقم الحالي</span>
            <strong dir="ltr">{ticket?.code ?? '—'}</strong>
            <small className={snapshot.counter?.paused ? 'paused' : 'ready'}>
              {snapshot.counter?.paused
                ? 'الكاونتر متوقف مؤقتًا'
                : ticket?.status === 'serving'
                  ? 'في الخدمة'
                  : ticket
                    ? 'بانتظار العميل'
                    : 'جاهز للنداء'}
            </small>
            {ticket && (
              <span className="current-service">
                {snapshot.services.find(s => s.id === ticket.serviceId)?.name}
              </span>
            )}
          </div>
          <TellerActions
            queue={queue}
            onTransfer={onTransfer}
            onFavorites={() => setFavoritesOpen(!favoritesOpen)}
            mode="panel"
          />
          {favoritesOpen && (
            <section className="favorite-services">
              <h2>الخدمات المفضلة</h2>
              <div className="row">
                {snapshot.services
                  .filter(s => s.active)
                  .map(s => (
                    <button
                      key={s.id}
                      aria-pressed={queue.favorites.includes(s.id)}
                      onClick={() => void queue.toggleFavorite(s.id)}
                    >
                      <Star />
                      {s.name}
                    </button>
                  ))}
              </div>
            </section>
          )}
        </>
      )}
      {transfer && ticket && (
        <Form
          className="transfer-form"
          onSubmit={async e => {
            e.preventDefault();
            try {
              await queue.action('transfer', target);
              onTransferred();
            } catch {}
          }}
        >
          <h2>تحويل {ticket.code}</h2>
          <label>
            الخدمة المطلوبة
            <Select ref={select} required value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">اختر خدمة</option>
              {snapshot.services
                .filter(s => s.active)
                .map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </label>
          <div className="row">
            <button className="primary" disabled={queue.busy || !queue.online}>
              تحويل
            </button>
            <button type="button" onClick={onTransferred}>
              إلغاء
            </button>
          </div>
        </Form>
      )}
      {canIssue && (
        <section>
          <h2>
            {snapshot.actor.role === 'kiosk' ? 'اختر الخدمة للحصول على تذكرة' : 'إصدار تذكرة'}
          </h2>
          <div className="service-buttons">
            {snapshot.services
              .filter(s => s.active)
              .map(s => (
                <button
                  key={s.id}
                  disabled={
                    queue.busy || !queue.online || !!(issued?.printRequired && !issued.printedAt)
                  }
                  onClick={async () => {
                    try {
                      const result = await queue.action('issue', s.id);
                      setIssued(result?.ticket ?? null);
                    } catch {}
                  }}
                >
                  {s.name}
                </button>
              ))}
          </div>
          {!snapshot.services.length && <p>أضف الخدمات من إعدادات الفرع أولًا.</p>}
          {issued && (
            <div className="issued-ticket" aria-live="polite">
              <span>رقم تذكرتك</span>
              <strong dir="ltr">{issued.code}</strong>
              <p>يرجى انتظار النداء</p>
              <button
                onClick={() =>
                  void window.queue
                    .print(issued.id)
                    .then(ticket => {
                      setIssued(ticket);
                      return queue.refresh(true);
                    })
                    .catch(e => queue.setError(String(e.message)))
                }
              >
                <Printer /> طباعة التذكرة
              </button>
              <button
                disabled={issued.printRequired && !issued.printedAt}
                onClick={() => setIssued(null)}
              >
                عميل جديد
              </button>
            </div>
          )}
        </section>
      )}
      {(!teller || snapshot.active.some(t => t.id !== ticket?.id)) && (
        <section>
          <h2>{teller ? 'الكاونترات الأخرى' : 'في الخدمة والنداء'}</h2>
          <div className="active-cards">
            {snapshot.active
              .filter(t => !teller || t.id !== ticket?.id)
              .filter(
                t =>
                  snapshot.actor.role !== 'display' ||
                  !snapshot.actor.counterId ||
                  t.counterId === snapshot.actor.counterId,
              )
              .map(t => (
                <div key={t.id}>
                  <strong dir="ltr">{t.code}</strong>
                  <span>{snapshot.counters.find(c => c.id === t.counterId)?.name}</span>
                  <small>{t.status === 'serving' ? 'في الخدمة' : 'تم النداء'}</small>
                </div>
              ))}
          </div>
          {!snapshot.active.filter(t => !teller || t.id !== ticket?.id).length && (
            <p className="empty">لا توجد تذاكر نشطة.</p>
          )}
        </section>
      )}
      {snapshot.actor.role !== 'display' && (
        <section>
          <h2>
            الانتظار <small>{snapshot.totals.waiting} تذكرة</small>
          </h2>
          {!snapshot.waiting.length ? (
            <p className="empty">قائمة الانتظار خالية.</p>
          ) : (
            <ul className="waiting-list">
              {snapshot.waiting.map(t => (
                <li key={t.id}>
                  <strong dir="ltr">{t.code}</strong>
                  <span>{snapshot.services.find(s => s.id === t.serviceId)?.name}</span>
                  {t.printRequired && !t.printedAt && <small>بانتظار الطباعة</small>}
                  <small>
                    {Math.max(0, Math.floor((Date.now() - Date.parse(t.queuedAt)) / 60000))} د
                  </small>
                  {queue.favorites.includes(t.serviceId) && <Star aria-label="خدمة مفضلة" />}
                </li>
              ))}
            </ul>
          )}
          {snapshot.totals.waiting > 100 && (
            <p>يظهر أول ١٠٠ عميل؛ العدد الكلي {snapshot.totals.waiting}.</p>
          )}
        </section>
      )}
    </section>
  );
}
