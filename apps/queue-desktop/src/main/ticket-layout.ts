import type { Service, Ticket } from '@saraf/queue-core';
import { saudiDates } from '@saraf/queue-core/dates';
import type { DevicePreferences } from '@saraf/queue-core/device';
export type TicketService = Pick<Service, 'name' | 'nameEn'>;
export type TicketAssets = { logo: string; arabic: string; sans: string; mono: string };
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
export function ticketDocument(
  ticket: Ticket,
  paperWidth: DevicePreferences['paperWidth'],
  service: TicketService,
  assets: TicketAssets,
) {
  const width = paperWidth === '58mm' ? 58 : 80;
  const codeSize = Math.min(
    width === 58 ? 16 : 20,
    (width - 8) / (Math.max(ticket.code.length, 5) * 0.62),
  );
  const issued = new Date(ticket.issuedAt);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(issued);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(issued);
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>Alnatheer · ${escape(ticket.code)}</title><style>
  @font-face{font-family:TicketArabic;src:url('${assets.arabic}') format('woff2');font-weight:400}
  @font-face{font-family:TicketSans;src:url('${assets.sans}') format('woff2');font-weight:400}
  @font-face{font-family:TicketSans;src:url('${assets.mono}') format('woff2');font-weight:700}
  @font-face{font-family:TicketMono;src:url('${assets.mono}') format('woff2');font-weight:700}
  @page{margin:0;size:auto}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#000;background:#fff;font-family:TicketSans,TicketArabic,sans-serif}
  .ticket{width:${width}mm;padding:4mm 4mm 3mm;text-align:center;break-inside:avoid;overflow-wrap:anywhere;font-size:10pt;line-height:1.4}
  .brand{display:grid;grid-template-columns:${width === 58 ? 14 : 18}mm 1fr;align-items:center;gap:2mm;margin-bottom:2mm}.brand img{width:100%;height:10mm;object-fit:contain;filter:grayscale(1) brightness(.65) contrast(20)}
  .brand-title{text-align:start;line-height:1.3;min-width:0}.brand-title strong{display:block;font-size:${width === 58 ? 12 : 15}pt;font-weight:600}.brand-title span{display:block;font-size:7pt;letter-spacing:.035em}
  .company{font-size:${width === 58 ? 8 : 9}pt;line-height:1.4;margin:0 auto 2mm;max-width:62mm}
  .number-block{padding:2mm 0;border-top:.25mm solid #000;border-bottom:.25mm solid #000}.eyebrow{display:flex;align-items:center;justify-content:space-between;font-size:8pt;line-height:1.3}
  .number{display:block;direction:ltr;white-space:nowrap;font-family:TicketMono,monospace;font-size:${codeSize.toFixed(2)}mm;font-weight:600;line-height:1.05;margin:1mm 0 0;letter-spacing:-.035em}
  .service{padding:2mm 0}.service strong{display:block;font-size:${width === 58 ? 11 : 13}pt;font-weight:600;line-height:1.4}.service p{margin:1mm 0 0;font-size:${width === 58 ? 8.5 : 10}pt;line-height:1.35}
  .instructions{padding:2mm 0;border-top:.2mm dashed #000;border-bottom:.2mm dashed #000}.instructions p{margin:0;font-size:9pt}.instructions span{display:block;font-size:8pt;line-height:1.4;margin-top:1mm}
  .issued{display:grid;grid-template-columns:1fr 1fr;gap:2mm;margin:1.5mm 0}.issued div{text-align:right}.issued div:last-child{text-align:left}.issued dt{font-size:7.5pt;margin-bottom:1mm}.issued dd{margin:0;font:500 9pt/1.3 TicketMono,monospace;white-space:nowrap}
  .issued div:nth-child(2){grid-column:1 / -1;order:2;text-align:right}.issued div:nth-child(2) dd{white-space:normal;font:400 9pt/1.4 TicketSans,sans-serif}
  .footer{border-top:.2mm solid #000;padding-top:1mm;font-size:8pt;line-height:1.4}.footer p{margin:0}.footer span{display:block;font-size:7.5pt}
  </style></head><body><article class="ticket" aria-label="تذكرة الانتظار">
  <header class="brand"><img src="${assets.logo}" alt="النذير"><div class="brand-title"><strong>النذير للصرافة</strong><span lang="en" dir="ltr">ALNATHEER EXCHANGE</span></div></header>
  <p class="company">شركة عبدالله عثمان النذير وأولاده للصرافة</p>
  <section class="number-block"><div class="eyebrow"><span>رقم دورك</span><span lang="en" dir="ltr">YOUR TICKET</span></div><strong class="number">${escape(ticket.code)}</strong></section>
  <section class="service"><strong>${escape(service.name)}</strong>${service.nameEn ? `<p lang="en" dir="ltr">${escape(service.nameEn)}</p>` : ''}</section>
  <section class="instructions"><p>يرجى انتظار ظهور رقمك على الشاشة</p><span lang="en" dir="ltr">Wait for your number on the screen</span></section>
  <dl class="issued"><div><dt>التاريخ · Date</dt><dd dir="ltr">${escape(date)}</dd></div><div><dt>التاريخ الهجري</dt><dd>${escape(saudiDates(issued).hijri)}</dd></div><div><dt>وقت الإصدار · Issued</dt><dd dir="ltr">${escape(time)} <span lang="en">AST</span></dd></div></dl>
  <footer class="footer"><p>شكرًا لانتظاركم</p><span lang="en" dir="ltr">Thank you for waiting</span></footer>
  </article></body></html>`;
}
// Used by the native printer and preview, after bundled fonts/images finish loading.
export const measureTicket = `(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));const paper=document.querySelector('.ticket');const rect=paper.getBoundingClientRect();return {height:rect.height,width:rect.width,overflow:paper.scrollWidth>paper.clientWidth+1};})()`;
export function ticketHeightMicrons(heightPixels: number) {
  if (!Number.isFinite(heightPixels) || heightPixels <= 0 || heightPixels > 750)
    throw new Error('Ticket layout is outside supported paper length');
  return Math.max(60000, Math.ceil(((heightPixels * 25.4) / 96 + 2) * 1000));
}
