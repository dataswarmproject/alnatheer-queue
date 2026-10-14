import { useEffect, useState } from 'react';
import type { ServerStatus } from '@saraf/queue-core/server';
import type { DesktopSpeechStatus } from '../../speech-policy';
import { OperationsPanel } from './OperationsPanel';
export function ServerPanel() {
  const [status, setStatus] = useState<ServerStatus | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [speech, setSpeech] = useState<DesktopSpeechStatus | null>(null);
  const refresh = async () => {
    try {
      setStatus(await window.queue.serverStatus());
      setSpeech(await window.queue.speechStatus().catch(() => null));
      setError('');
    } catch {
      setError('تعذر قراءة حالة خادم الفرع.');
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, []);
  const date = (value: string | null | undefined) =>
    value
      ? new Intl.DateTimeFormat('ar-SA', {
          timeZone: 'Asia/Riyadh',
          dateStyle: 'short',
          timeStyle: 'short',
        }).format(new Date(value))
      : '—';
  return (
    <section>
      <h2>خادم الفرع</h2>
      {status ? (
        <>
          <div className="metrics">
            <div>
              <span>قاعدة البيانات</span>
              <strong>{status.databaseReady ? 'متاحة' : 'غير متاحة'}</strong>
            </div>
            <div>
              <span>الأجهزة المفعلة</span>
              <strong>{status.enabledDevices}</strong>
            </div>
            <div>
              <span>أحداث بانتظار المزامنة</span>
              <strong>{status.sync.pending}</strong>
            </div>
            <div>
              <span>نسخة النظام</span>
              <strong>{status.version}</strong>
            </div>
          </div>
          <dl className="server-details">
            <div>
              <dt>معرّف الفرع</dt>
              <dd dir="ltr">{status.branchId}</dd>
            </div>
            <div>
              <dt>آخر اتصال بالمركز</dt>
              <dd>{date(status.sync.lastSuccess)}</dd>
            </div>
            <div>
              <dt>مزامنة المركز</dt>
              <dd>
                {!status.sync.configured
                  ? 'لم تُضبط'
                  : status.sync.lastError
                    ? status.sync.lastError === 'AUTH'
                      ? 'راجع مفتاح ربط المركز'
                      : status.sync.lastError === 'RECONCILE'
                        ? 'تحتاج مطابقة سجل الفرع مع المركز'
                        : 'تعذر الاتصال؛ ستعاد المحاولة تلقائيًا'
                    : 'مفعلة'}
              </dd>
            </div>
            <div>
              <dt>التقارير اليومية</dt>
              <dd>{status.reportsConfigured ? 'مفعلة' : 'لم تُضبط'}</dd>
            </div>
          </dl>
          <h2>نسخ قاعدة البيانات</h2>
          {speech?.restartRequired && (
            <p role="status">لتطبيق إعدادات النداء، أعد تشغيل خادم الفرع.</p>
          )}
          <p>تُحفظ النسخة في المجلد الخاص على خادم الفرع، وتشمل التذاكر وسجل الأحداث والأجهزة.</p>
          <button
            className="primary"
            disabled={busy || !status.backupsConfigured}
            onClick={async () => {
              setBusy(true);
              setMessage('');
              setError('');
              try {
                const backup = await window.queue.backup();
                setMessage(`حُفظت نسخة متحققة: ${backup.filename}`);
                await refresh();
              } catch {
                setError('تعذر إنشاء النسخة. تحقق من مساحة التخزين وإعدادات الخادم.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'جارٍ إنشاء النسخة…' : 'إنشاء نسخة احتياطية'}
          </button>
          {!status.backupsConfigured && (
            <p>حدد مجلد النسخ الاحتياطية في إعدادات خادم الفرع أولًا.</p>
          )}
          {status.lastBackup && (
            <p>
              آخر نسخة: {date(status.lastBackup.createdAt)} ·{' '}
              {Math.ceil(status.lastBackup.sizeBytes / 1048576)} MB
            </p>
          )}
          <button onClick={() => void refresh()} disabled={busy}>
            تحديث الحالة
          </button>
        </>
      ) : (
        <p role="status">جارٍ قراءة حالة الخادم…</p>
      )}
      {message && <p role="status">{message}</p>}
      <OperationsPanel refreshServer={refresh} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
