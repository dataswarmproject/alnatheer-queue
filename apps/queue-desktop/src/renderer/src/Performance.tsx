import { Select } from './Select';
import { useEffect, useState } from 'react';
import { businessDay } from '@saraf/queue-core';
import type { QueueAnalytics } from '@saraf/queue-core/analytics';
import { CounterAnalysis } from './CounterAnalysis';
const duration = (seconds: number | null) =>
  seconds == null ? '—' : `${(seconds / 60).toFixed(1)} د`;
const percent = (value: number | null) => (value == null ? '—' : `${(value * 100).toFixed(1)}%`);
export function Performance({ initialCounterId = '' }: { initialCounterId?: string }) {
  const [counterId, setCounterId] = useState(initialCounterId);
  const [format, setFormat] = useState<'pdf' | 'csv' | 'json'>('pdf');
  const [days, setDays] = useState(1),
    [sla, setSla] = useState(''),
    [report, setReport] = useState<QueueAnalytics | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const range = () => ({
    from:
      days === 1
        ? new Date(`${businessDay()}T00:00:00+03:00`).toISOString()
        : new Date(Date.now() - days * 86400000).toISOString(),
    to: new Date().toISOString(),
    ...(sla ? { slaSeconds: Number(sla) * 60 } : {}),
  });
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setReport(await window.queue.analytics(range()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل التحليل');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [days]);
  const stats = report
    ? [
        ['وصول العملاء', report.summary.arrivals],
        ['إنجاز الزيارات', report.summary.completed],
        ['انتظار P90', duration(report.summary.p90WaitSeconds)],
        ['متوسط الانتظار', duration(report.summary.meanWaitSeconds)],
        ['عدم الحضور', percent(report.summary.noShowRate)],
        ['تذاكر مفتوحة', report.summary.open],
        ['التحويلات', report.summary.transfers],
        ['الالتزام بالهدف', percent(report.summary.slaMetRate)],
      ]
    : [];
  return (
    <section className="performance">
      <div className="filters">
        <label>
          الفترة
          <Select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={1}>اليوم</option>
            <option value={7}>آخر ٧ أيام</option>
            <option value={30}>آخر ٣٠ يومًا</option>
          </Select>
        </label>
        <label>
          هدف الانتظار بالدقائق
          <input
            type="number"
            min={1}
            max={1440}
            value={sla}
            onChange={e => setSla(e.target.value)}
            placeholder="مثال: 5 · اختياري"
            title="هدف الانتظار من دقيقة واحدة إلى 1440 دقيقة. اتركه فارغًا لعرض الأداء دون هدف انتظار."
          />
        </label>
        <button onClick={() => void load()} disabled={busy}>
          {busy ? 'تحليل…' : 'تحديث'}
        </button>
        <label>
          صيغة تقرير الفرع
          <Select value={format} onChange={e => setFormat(e.target.value as typeof format)}>
            <option value="pdf">PDF · تقرير مقروء</option>
            <option value="csv">CSV · جداول Excel</option>
            <option value="json">JSON · بيانات كاملة</option>
          </Select>
        </label>
        <button
          disabled={!report || busy}
          onClick={() =>
            void window.queue
              .exportReport({ ...range(), format })
              .catch(e => setError(String(e.message)))
          }
        >
          حفظ التقرير
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <label>
            تحليل كاونتر
            <Select value={counterId} onChange={e => setCounterId(e.target.value)}>
              <option value="">اختر الكاونتر</option>
              {report.counters.map(c => (
                <option value={c.id} key={c.id}>
                  {c.name}
                  {c.archived ? ' · محذوف' : ''}
                </option>
              ))}
            </Select>
          </label>
          {report.counters.find(c => c.id === counterId) && (
            <CounterAnalysis
              counter={report.counters.find(c => c.id === counterId)!}
              partial={report.coverage.partial}
            />
          )}
          <h2>مؤشرات الفرع</h2>
          <p className="report-period">
            بتوقيت الرياض ·{' '}
            {new Date(report.from).toLocaleDateString('ar-SA', { timeZone: 'Asia/Riyadh' })} –{' '}
            {new Date(report.to).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' })} ·{' '}
            {report.coverage.events} حدث مسجل
          </p>
          {report.coverage.partial && (
            <p className="error">النتائج جزئية؛ ضيّق الفترة قبل المقارنة.</p>
          )}
          <div className="metrics">
            {stats.map(([label, value]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <h2>أداء الموظفين المسندين</h2>
          <p>المقارنة حسب نوع الخدمة وحجم العينة؛ سرعة الإنجاز لا تثبت جودة الخدمة.</p>
          <div className="table-scroll">
            <table>
              <caption>عمليات الموظفين ومدد الخدمة</caption>
              <thead>
                <tr>
                  <th>الموظف / الكاونتر</th>
                  <th>إنجاز</th>
                  <th>متوسط خدمة</th>
                  <th>خدمة P90</th>
                  <th>إعادة نداء</th>
                  <th>تحويل</th>
                  <th>عينة</th>
                </tr>
              </thead>
              <tbody>
                {report.tellers.map(t => (
                  <tr key={t.actorId}>
                    <th scope="row">
                      {t.name}
                      <small>
                        {t.counter ?? '—'} · {t.staffRef ?? 'إسناد غير مكتمل'}
                      </small>
                    </th>
                    <td>{t.completed}</td>
                    <td>{duration(t.meanServiceSeconds)}</td>
                    <td>{duration(t.p90ServiceSeconds)}</td>
                    <td>{t.recalls}</td>
                    <td>{t.transfers}</td>
                    <td>{t.sampleSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!report.tellers.length && (
              <p className="empty">لا توجد عمليات موظفين في هذه الفترة.</p>
            )}
          </div>
          <h2>الكاونترات والسعة</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الكاونتر</th>
                  <th>وقت متاح</th>
                  <th>وقت توقف</th>
                  <th>وقت خدمة متاح</th>
                  <th>استخدام</th>
                </tr>
              </thead>
              <tbody>
                {report.counters.map(c => (
                  <tr key={c.id}>
                    <th scope="row">
                      {c.name}
                      {c.archived && <small>محذوف من الخدمة · التاريخ محفوظ</small>}
                      {!c.coverageKnown && <small>تغطية الفترة غير كاملة</small>}
                    </th>
                    <td>{duration(c.availableSeconds)}</td>
                    <td>{duration(c.pausedSeconds)}</td>
                    <td>{duration(c.busySeconds)}</td>
                    <td>{percent(c.utilization)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>الخدمات ومزيج العمل</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الخدمة</th>
                  <th>بدء خدمة</th>
                  <th>إنجاز</th>
                  <th>تحويل للخارج</th>
                  <th>متوسط الخدمة</th>
                </tr>
              </thead>
              <tbody>
                {report.services.map(s => (
                  <tr key={s.id}>
                    <th scope="row">{s.name}</th>
                    <td>{s.starts}</td>
                    <td>{s.completed}</td>
                    <td>{s.transfers}</td>
                    <td>{duration(s.meanServiceSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>الوصول حسب الساعة</h2>
          <div className="hourly">
            {report.hourly.map(h => (
              <div key={h.hour}>
                <span dir="ltr">{h.hour}</span>
                <meter
                  min={0}
                  max={Math.max(...report.hourly.map(x => x.arrivals), 1)}
                  value={h.arrivals}
                  aria-label={`${h.hour}: ${h.arrivals} عميل`}
                />
                <strong>{h.arrivals}</strong>
              </div>
            ))}
          </div>
          <h2>رؤى تشغيلية</h2>
          <div className="insights">
            {report.insights.map(i => (
              <article key={i.title}>
                <h3>{i.title}</h3>
                <p>{i.detail}</p>
              </article>
            ))}
          </div>
          <details>
            <summary>التعريفات وحدود القياس</summary>
            {Object.entries(report.definitions).map(([key, value]) => (
              <p key={key}>{value}</p>
            ))}
            <p>
              أوقات الخدمة مجهولة البداية: {report.coverage.missingLegStarts}. موظفون دون إسناد:{' '}
              {report.coverage.unassignedTellers}.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
