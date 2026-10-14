import type { QueueAnalytics } from '@saraf/queue-core/analytics';
const duration = (value: number | null | undefined) =>
  value == null ? '—' : `${(value / 60).toFixed(1)} د`;
export function CounterAnalysis({
  counter,
  partial,
}: {
  counter: QueueAnalytics['counters'][number];
  partial: boolean;
}) {
  const values = [
    ['إنجاز', counter.completed],
    ['نداءات جديدة', counter.calls ?? '—'],
    ['إعادة نداء', counter.recalls ?? '—'],
    ['عدم الحضور', counter.noShows ?? '—'],
    ['تحويلات', counter.transfers ?? '—'],
    ['متوسط الخدمة', duration(counter.meanServiceSeconds)],
    ['خدمة P90', duration(counter.p90ServiceSeconds)],
    ['متوسط الانتظار', duration(counter.meanWaitSeconds)],
    ['انتظار P90', duration(counter.p90WaitSeconds)],
    ['وقت متاح', duration(counter.availableSeconds)],
    ['وقت توقف', duration(counter.pausedSeconds)],
    [
      'استخدام السعة',
      counter.utilization == null ? '—' : `${(counter.utilization * 100).toFixed(1)}%`,
    ],
  ];
  return (
    <section className="counter-analysis" aria-label="تحليل الكاونتر المحدد">
      <h2>
        تحليل {counter.name}
        {counter.archived && ' · محذوف من الخدمة'}
      </h2>
      <div className="metrics">
        {values.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p>
        عينة الخدمة: {counter.sampleSize ?? 0} · عينة الانتظار: {counter.waitSampleSize ?? 0}.
        الانتظار يُنسب إلى الكاونتر الذي بدأ أول خدمة؛ السرعة وحدها لا تقيس جودة الموظف.
      </p>
      {(partial || !counter.coverageKnown) && (
        <p role="status">تغطية الفترة غير كاملة؛ راجع البيانات قبل المقارنة.</p>
      )}
      {(counter.sampleSize ?? 0) < 10 && (
        <p role="status">عينة محدودة؛ استخدم فترة أطول قبل ترتيب الأداء.</p>
      )}
      <h3>مزيج الخدمات المنجزة</h3>
      {counter.services?.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الخدمة</th>
                <th>إنجاز</th>
                <th>متوسط الخدمة</th>
              </tr>
            </thead>
            <tbody>
              {counter.services.map(s => (
                <tr key={s.id}>
                  <th>{s.name}</th>
                  <td>{s.completed}</td>
                  <td>{duration(s.meanServiceSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>لا توجد خدمات منجزة مسجلة لهذا الكاونتر في الفترة.</p>
      )}
    </section>
  );
}
