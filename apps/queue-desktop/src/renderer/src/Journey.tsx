import { useState } from 'react';
import { businessDay } from '@saraf/queue-core';
const labels: Record<string, string> = {
  issue: 'إصدار تذكرة',
  printed: 'قبول التذكرة في الطابعة',
  next: 'نداء العميل',
  recall: 'إعادة النداء',
  start: 'بدء الخدمة',
  complete: 'إنجاز الخدمة',
  transfer: 'تحويل الخدمة',
  no_show: 'عدم حضور',
  pause: 'إيقاف الكاونتر',
  resume: 'استئناف الكاونتر',
  configuration: 'تعديل الإعدادات',
};
export function Journey() {
  const [code, setCode] = useState(''),
    [day, setDay] = useState(businessDay()),
    [result, setResult] = useState<Awaited<ReturnType<typeof window.queue.journey>> | null>(null),
    [error, setError] = useState('');
  return (
    <section>
      <h2>متابعة التذكرة</h2>
      <p>ابحث برقم التذكرة وتاريخ إصدارها لمعرفة النداءات والتحويلات والموظف المسند لكل خطوة.</p>
      <form
        className="filters"
        onSubmit={async e => {
          e.preventDefault();
          setError('');
          try {
            setResult(await window.queue.journey({ code, day }));
          } catch (e) {
            setError(String((e as Error).message));
          }
        }}
      >
        <label>
          رقم التذكرة
          <input
            dir="ltr"
            required
            pattern="[A-Z]{1,3}-[0-9]{1,12}"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          تاريخ الإصدار
          <input required type="date" value={day} onChange={e => setDay(e.target.value)} />
        </label>
        <button>بحث</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result &&
        (!result.ticket ? (
          <p className="empty">لا توجد تذكرة مطابقة.</p>
        ) : (
          <>
            <h2 dir="ltr">{result.ticket.code}</h2>
            {result.partial && <p>يظهر أول ٢٠٠ حدث لهذه التذكرة.</p>}
            <ol className="journey">
              {result.events.map(e => (
                <li key={e.id}>
                  <time>
                    {new Date(e.occurredAt).toLocaleTimeString('ar-SA', {
                      timeZone: 'Asia/Riyadh',
                    })}
                  </time>
                  <div>
                    <strong>{labels[e.kind] ?? e.kind}</strong>
                    <small>
                      {e.actor.name ?? 'جهاز غير مسمى'} · {e.actor.staffRef ?? 'دون معرّف موظف'}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ))}
    </section>
  );
}
