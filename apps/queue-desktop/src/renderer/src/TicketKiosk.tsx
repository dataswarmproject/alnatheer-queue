import { Printer, ArrowRight } from 'iconoir-react';
import type { QueueController } from './useQueue';
import { useEffect, useState } from 'react';
import type { DevicePreferences } from '@saraf/queue-core/device';
import { SaudiDate } from './SaudiDate';

export function TicketKiosk({
  queue,
  onSettings,
}: {
  queue: QueueController;
  onSettings: () => void;
}) {
  const snapshot = queue.snapshot!,
    ticket = queue.issued;
  const [printError, setPrintError] = useState(false);
  const [preferences, setPreferences] = useState<DevicePreferences | null>(null),
    [printing, setPrinting] = useState(false),
    [printed, setPrinted] = useState(false);
  useEffect(() => {
    let alive = true;
    window.queue
      .devicePreferences()
      .then(value => {
        if (alive) setPreferences(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!ticket || !preferences?.autoPrint) return;
    let alive = true;
    setPrinting(true);
    setPrinted(false);
    setPrintError(false);
    window.queue
      .autoPrint(ticket.id)
      .then(ticket => {
        if (alive) {
          queue.setIssued(ticket);
          setPrinted(true);
        }
      })
      .catch(() => {
        if (alive) setPrintError(true);
      })
      .finally(() => {
        if (alive) setPrinting(false);
      });
    return () => {
      alive = false;
    };
  }, [ticket?.id, preferences?.autoPrint]);
  useEffect(() => {
    if (!ticket || !printed || printError || !preferences) return;
    const timer = setTimeout(() => {
      queue.setIssued(null);
      setPrinted(false);
    }, preferences.resetSeconds * 1000);
    return () => clearTimeout(timer);
  }, [ticket?.id, printed, printError, preferences?.resetSeconds]);
  return (
    <main className="customer-screen kiosk-screen" dir="rtl">
      <header className="customer-header">
        <img src="/icon.png" className="customer-logo" alt="النذير للصرافة" />
        <div>
          <strong>النذير للصرافة</strong>
          <span>Alnatheer Exchange</span>
        </div>
        <SaudiDate />
      </header>
      {!queue.online && (
        <div role="alert" className="connection-warning">
          خدمة التذاكر غير متصلة. يرجى مراجعة موظف الفرع.
        </div>
      )}
      {queue.error && (
        <section className="customer-error" role="alert">
          <p>تعذر إتمام الطلب. يمكنك إعادة المحاولة للتحقق من تذكرتك.</p>
          <button onClick={() => void queue.retry().catch(() => {})} disabled={queue.busy}>
            إعادة محاولة الطلب
          </button>
        </section>
      )}
      <section className="kiosk-content">
        {ticket ? (
          <div className="kiosk-receipt" aria-live="polite">
            <span>رقم تذكرتك · Your ticket</span>
            <strong dir="ltr">{ticket.code}</strong>
            <h1>{snapshot.services.find(s => s.id === ticket.serviceId)?.name}</h1>
            <p>يرجى انتظار النداء على شاشة الفرع</p>
            {printing && <p role="status">جارٍ إرسال التذكرة للطابعة…</p>}
            {printed && <p role="status">أُرسلت التذكرة للطابعة. يرجى أخذها.</p>}
            {printError && <p role="alert">تعذرت الطباعة. أعد طباعة نفس التذكرة أو راجع الموظف.</p>}
            <div className="row">
              <button
                className="primary"
                disabled={printing}
                onClick={async () => {
                  setPrintError(false);
                  setPrinting(true);
                  try {
                    queue.setIssued(await window.queue.print(ticket.id));
                    setPrinted(true);
                  } catch {
                    setPrintError(true);
                  } finally {
                    setPrinting(false);
                  }
                }}
              >
                <Printer />
                طباعة التذكرة
              </button>
              <button
                disabled={printing || !printed}
                onClick={() => {
                  queue.setIssued(null);
                  queue.setError('');
                  setPrintError(false);
                  setPrinted(false);
                }}
              >
                عميل جديد <ArrowRight />
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1>كيف يمكننا خدمتك؟</h1>
            <p>اختر الخدمة للحصول على تذكرة · Select a service</p>
            <div className="kiosk-services">
              {snapshot.services
                .filter(s => s.active)
                .map(s => (
                  <button
                    key={s.id}
                    disabled={queue.busy || !queue.online}
                    onClick={() => void queue.action('issue', s.id).catch(() => {})}
                  >
                    <span>{s.name}</span>
                    <ArrowRight aria-hidden="true" />
                  </button>
                ))}
            </div>
            {!snapshot.services.some(s => s.active) && (
              <p className="customer-empty">لم تُفعّل الخدمات بعد. يرجى مراجعة موظف الفرع.</p>
            )}
          </>
        )}
      </section>
      <footer className="customer-footer">
        <span>مرحبًا بكم · Welcome</span>
        <button className="operator-settings" onClick={onSettings}>
          إعدادات الجهاز
        </button>
      </footer>
    </main>
  );
}
