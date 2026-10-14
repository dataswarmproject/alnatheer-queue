import { useEffect, useRef, useState } from 'react';
import { Download, RefreshDouble, Xmark } from 'iconoir-react';
import type { UpdateAction, UpdateStatus } from '../../update-contract';
import { Badge } from './Badge';
import { Form } from './Form';
export function UpdateFooter() {
  const [status, setStatus] = useState<UpdateStatus | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [at, setAt] = useState(() => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 16));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      window.queue
        .updateStatus()
        .then(value => {
          if (alive) setStatus(value);
        })
        .catch(() => {
          if (alive) setError('تعذر قراءة حالة التحديث.');
        });
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const run = async (input: UpdateAction) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await window.queue.updateAction(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إجراء التحديث.');
    } finally {
      setBusy(false);
    }
  };
  const active =
    busy || (!!status && ['checking', 'downloading', 'installing'].includes(status.state));
  const available = !!status?.availableVersion;
  const actionable =
    available && status?.state !== 'not_configured' && status?.state !== 'checking';
  const label = !status
    ? 'التحديثات'
    : status.state === 'error'
      ? 'تعذر التحديث'
      : status.state === 'downloading'
        ? `تنزيل ${Math.round(status.progress ?? 0)}٪`
        : status.state === 'scheduled'
          ? 'تحديث مجدول'
          : status.state === 'downloaded'
            ? 'تثبيت التحديث'
            : status.state === 'available'
              ? 'تحديث متاح'
              : 'التحديثات';
  return (
    <div className="update-footer">
      {status && (
        <span dir="ltr" className="app-version">
          v{status.currentVersion}
        </span>
      )}
      <button
        disabled={!actionable}
        onClick={() => setOpen(true)}
        className="update-badge-trigger"
        aria-haspopup="dialog"
        title={status?.message || label}
      >
        <Badge
          variant={
            status?.state === 'error'
              ? 'red'
              : status?.state === 'downloaded'
                ? 'green'
                : status?.state === 'scheduled'
                  ? 'amber'
                  : ['available', 'downloading'].includes(status?.state ?? '')
                    ? 'blue'
                    : 'gray'
          }
        >
          <Download />
          {label}
        </Badge>
      </button>
      <dialog
        ref={dialog}
        className="update-dialog"
        onCancel={e => {
          e.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <header>
          <div>
            <h2>تحديث التطبيق</h2>
            <p>
              الإصدار المثبت <b dir="ltr">{status?.currentVersion ?? '—'}</b>
              {available && (
                <>
                  {' '}
                  · الإصدار المتاح <b dir="ltr">{status!.availableVersion}</b>
                </>
              )}
            </p>
          </div>
          <button aria-label="إغلاق التحديثات" onClick={() => setOpen(false)}>
            <Xmark />
          </button>
        </header>
        {status?.message && <p role="status">{status.message}</p>}
        {status?.state === 'downloading' && (
          <progress max={100} value={status.progress ?? 0} aria-label="تقدم تنزيل التحديث" />
        )}
        {status?.scheduledAt && (
          <p>
            موعد التثبيت · الرياض:{' '}
            {new Date(status.scheduledAt).toLocaleString('ar-SA-u-ca-gregory', {
              timeZone: 'Asia/Riyadh',
            })}
          </p>
        )}
        {status?.state !== 'not_configured' && (
          <>
            <div className="row">
              <button disabled={active} onClick={() => void run({ action: 'check' })}>
                <RefreshDouble />
                التحقق من التحديثات
              </button>
              {available && (
                <>
                  <button
                    className="primary"
                    disabled={active}
                    onClick={() =>
                      void run({
                        action:
                          status?.state === 'downloaded' || status?.state === 'scheduled'
                            ? 'install'
                            : 'download',
                      })
                    }
                  >
                    {status?.state === 'downloaded' || status?.state === 'scheduled'
                      ? 'تثبيت الآن'
                      : 'تنزيل التحديث'}
                  </button>
                  <button disabled={active} onClick={() => void run({ action: 'ignore' })}>
                    تجاهل هذا الإصدار
                  </button>
                </>
              )}
            </div>
            {available && (
              <Form
                onSubmit={e => {
                  e.preventDefault();
                  const date = new Date(at + ':00+03:00');
                  if (Number.isNaN(date.getTime())) {
                    setError('اختر موعدًا صالحًا بتوقيت الرياض.');
                    return;
                  }
                  void run({ action: 'schedule', at: date.toISOString() });
                }}
              >
                <label>
                  جدولة التثبيت · توقيت الرياض
                  <input
                    required
                    type="datetime-local"
                    value={at}
                    disabled={active}
                    onChange={e => setAt(e.target.value)}
                    dir="ltr"
                  />
                </label>
                <div className="row">
                  <button disabled={active}>تنزيل وجدولة التحديث</button>
                  {status?.scheduledAt && (
                    <button
                      type="button"
                      disabled={status.state === 'installing'}
                      onClick={() => void run({ action: 'cancel_schedule' })}
                    >
                      إلغاء الجدولة
                    </button>
                  )}
                </div>
              </Form>
            )}
            <p>
              يُتحقق من توقيع الإصدار وسلامة الملف قبل التثبيت. تُنشأ نسخة احتياطية متحققة ويُنتظر
              إغلاق جميع التذاكر المفتوحة. سيُعاد تشغيل التطبيق؛ خادم الفرع المحلي يتوقف ويعود معه.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </dialog>
    </div>
  );
}
