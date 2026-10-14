import type { z } from 'zod';
import type { analyticsSchema } from '@saraf/queue-core/analytics-contract';
type QueueAnalytics = z.infer<typeof analyticsSchema>;
import { saudiDates } from '@saraf/queue-core/dates';
import type { TicketAssets } from './ticket-layout';
const escape = (value: unknown) =>
  String(value ?? '—').replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const minutes = (value: number | null | undefined) =>
  value == null ? '—' : (value / 60).toFixed(1);
const percent = (value: number | null | undefined) =>
  value == null ? '—' : (value * 100).toFixed(1) + '%';
export function reportCsv(report: QueueAnalytics, branchId = '') {
  const rows: unknown[][] = [
    ['Record type', 'Name', 'Metric', 'Value', 'Unit'],
    ['source', 'branch', 'branchId', branchId, 'UUID'],
    ['period', 'Asia/Riyadh', 'from', report.from, 'ISO UTC'],
    ['period', 'Asia/Riyadh', 'to', report.to, 'ISO UTC'],
    ['coverage', 'branch', 'partial', report.coverage.partial, 'boolean'],
  ];
  const add = (type: string, name: string, values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values))
      if (value === null || ['number', 'string', 'boolean'].includes(typeof value))
        rows.push([
          type,
          name,
          key,
          value ?? '',
          key.endsWith('Seconds')
            ? 'seconds'
            : key.toLowerCase().includes('rate') || key === 'utilization'
              ? 'fraction'
              : '',
        ]);
  };
  add('summary', 'branch', report.summary);
  add('coverage', 'branch', report.coverage);
  for (const teller of report.tellers) {
    const { services, ...metrics } = teller;
    add('teller', teller.actorId, metrics);
    for (const service of services)
      add('teller_service', `${teller.actorId}:${service.serviceId}`, service);
  }
  for (const counter of report.counters) {
    const { services, ...metrics } = counter;
    add('counter', counter.id, metrics);
    for (const service of services ?? [])
      add('counter_service', `${counter.id}:${service.id}`, service);
  }
  for (const service of report.services) add('service', service.id, service);
  for (const hour of report.hourly) add('hour', hour.hour, { arrivals: hour.arrivals });
  for (const insight of report.insights) add('insight', insight.title, { detail: insight.detail });
  add('definition', 'branch', report.definitions);
  return (
    '\uFEFF' +
    rows
      .map(row =>
        row
          .map(value => {
            let text = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
export function reportDocument(report: QueueAnalytics, assets: TicketAssets, branchId = '') {
  const table = (headers: string[], rows: unknown[][]) =>
    `<table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${
      rows.length
        ? rows
            .slice(0, 200)
            .map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`)
            .join('')
        : `<tr><td colspan="${headers.length}">لا توجد سجلات في الفترة المحددة</td></tr>`
    }</tbody></table>${rows.length > 200 ? '<p>يعرض PDF أول 200 سجل في هذا القسم. استخدم CSV أو JSON للحصول على كل سجلات التقرير.</p>' : ''}`;
  const generated = saudiDates();
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير أداء الفرع · النذير</title><style>
  @font-face{font-family:Thmanyah;src:url('${assets.sans}') format('woff2');font-weight:400;}@font-face{font-family:Thmanyah;src:url('${assets.mono}') format('woff2');font-weight:700;}
  @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Thmanyah,sans-serif;font-size:10px;color:#171717;margin:0}header{display:flex;align-items:center;gap:16px;border-bottom:1px solid #dedede;padding-bottom:16px}header img{width:52px;height:48px;object-fit:contain}h1{font-size:22px;margin:0 0 6px}h2{font-size:16px;margin:24px 0 12px;break-after:avoid}p{line-height:1.7;color:#555}small{color:#666}.period{padding:12px 0;border-bottom:1px solid #ddd}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:16px}.summary div{border:1px solid #ddd;border-radius:6px;padding:10px;break-inside:avoid}.summary strong{display:block;font-size:19px;margin-top:6px}table{border-collapse:collapse;width:100%;font-size:9px;table-layout:auto}thead{display:table-header-group}th,td{border-bottom:1px solid #ddd;text-align:right;padding:7px;overflow-wrap:anywhere}th{background:#f7f7f7;font-weight:700}tr{break-inside:avoid}section{margin-bottom:16px}.notice{padding:12px;border:1px solid #999;border-radius:6px}footer{border-top:1px solid #ddd;padding-top:12px;margin-top:24px}
  </style></head><body><header><img src="${assets.logo}" alt="النذير"/><div><h1>تقرير أداء الفرع</h1><small>${escape(generated.gregorian)} · ${escape(generated.hijri)}<br/>معرّف الفرع: <span dir="ltr">${escape(branchId)}</span></small></div></header><p class="period">الفترة · توقيت الرياض: ${escape(saudiDates(new Date(report.from)).gregorian)} — ${escape(saudiDates(new Date(report.to)).gregorian)}<br/>${report.coverage.events} حدث مسجل · ${report.coverage.missingLegStarts} بداية خدمة غير مسجلة · ${report.coverage.unassignedTellers} موظف دون إسناد موثق</p>
  ${report.coverage.partial ? '<p class="notice">نتائج جزئية. ضيّق الفترة قبل المقارنة أو اتخاذ قرار.</p>' : ''}
  <div class="summary">${[
    ['وصول العملاء', report.summary.arrivals],
    ['المكتملة', report.summary.completed],
    ['متوسط الانتظار · دقيقة', minutes(report.summary.meanWaitSeconds)],
    ['انتظار P90 · دقيقة', minutes(report.summary.p90WaitSeconds)],
    ['عدم الحضور', percent(report.summary.noShowRate)],
    ['تذاكر مفتوحة', report.summary.open],
    ['التحويلات', report.summary.transfers],
    ['الالتزام بهدف الانتظار', percent(report.summary.slaMetRate)],
  ]
    .map(([name, value]) => `<div>${escape(name)}<strong>${escape(value)}</strong></div>`)
    .join('')}</div>
  <section><h2>أداء الموظفين</h2>${table(
    [
      'الموظف',
      'الكاونتر',
      'مكتملة',
      'غياب',
      'تحويل',
      'متوسط الخدمة · د',
      'P90 · د',
      'عينات',
      'الاستغلال',
    ],
    report.tellers.map(t => [
      t.name,
      t.counter,
      t.completed,
      t.noShows,
      t.transfers,
      minutes(t.meanServiceSeconds),
      minutes(t.p90ServiceSeconds),
      t.sampleSize,
      percent(t.utilization),
    ]),
  )}</section>
  <section><h2>أداء الكاونترات</h2>${table(
    [
      'الكاونتر',
      'مكتملة',
      'نداءات',
      'غياب',
      'متوسط الخدمة · د',
      'متوسط الانتظار · د',
      'الاستغلال',
      'التغطية',
    ],
    report.counters.map(c => [
      c.name + (c.archived ? ' · مؤرشف' : ''),
      c.completed,
      c.calls ?? '—',
      c.noShows ?? '—',
      minutes(c.meanServiceSeconds),
      minutes(c.meanWaitSeconds),
      percent(c.utilization),
      c.coverageKnown ? 'معروفة' : 'غير مكتملة',
    ]),
  )}</section>
  <section><h2>أداء الخدمات</h2>${table(
    ['الخدمة', 'مكتملة', 'نداءات', 'إعادة نداء', 'غياب', 'تحويل', 'متوسط الخدمة · د'],
    report.services.map(s => [
      s.name,
      s.completed,
      s.calls,
      s.recalls,
      s.noShows,
      s.transfers,
      minutes(s.meanServiceSeconds),
    ]),
  )}</section>
  <section><h2>ساعات وصول العملاء</h2>${table(
    ['الساعة · الرياض', 'الواصلون'],
    report.hourly.map(h => [h.hour, h.arrivals]),
  )}</section><section><h2>رؤى تشغيلية</h2>${report.insights.length ? report.insights.map(i => `<p><b>${escape(i.title)}</b><br/>${escape(i.detail)}</p>`).join('') : '<p>لا توجد ملاحظات مدعومة بالبيانات في هذه الفترة.</p>'}</section>
  <footer><b>تعريف المؤشرات وحدود المقارنة</b>${Object.values(report.definitions)
    .map(value => `<p>${escape(value)}</p>`)
    .join(
      '',
    )}<p>التوقيت: Asia/Riyadh. الرمز — يعني عدم توفر بيانات كافية؛ لا يُعامل كصفر.</p></footer></body></html>`;
}
