import { useEffect, useState } from 'react';
import type { OperationsStatus, Operation, OperationResult } from '@saraf/queue-core/operations';

export function OperationsPanel({ refreshServer }: { refreshServer: () => Promise<void> }) {
  const [status, setStatus] = useState<OperationsStatus | null>(null),
    [syncEnabled, setSyncEnabled] = useState(false),
    [syncUrl, setSyncUrl] = useState(''),
    [syncKey, setSyncKey] = useState(''),
    [dailyBackups, setDailyBackups] = useState(true),
    [dailyReports, setDailyReports] = useState(true);
  const [busy, setBusy] = useState(false),
    [canBrowse, setCanBrowse] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<OperationResult | null>(null),
    [restore, setRestore] = useState<string | null>(null);
  const refresh = async () => {
    const value = await window.queue.operationsStatus();
    setStatus(value);
    setSyncEnabled(value.settings.syncEnabled);
    setSyncUrl(value.settings.syncUrl);
    setDailyBackups(value.settings.dailyBackups);
    setDailyReports(value.settings.dailyReports);
    setCanBrowse(await window.queue.canBrowseHostFolders().catch(() => false));
  };
  const browse = async (kind: 'database' | 'backup' | 'report') => {
    setBusy(true);
    setError('');
    try {
      await window.queue.browseHostFolder(kind);
    } catch {
      setError('تعذر فتح مجلد الخادم.');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh().catch(() => setError('حدّث خادم الفرع لتفعيل أدوات قاعدة البيانات والمزامنة.'));
  }, []);
  const run = async (action: Operation) => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await window.queue.runOperation(action));
      setRestore(null);
      await refresh();
      await refreshServer();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="operations-panel">
      <h2>قاعدة البيانات والمزامنة</h2>
      {status && (
        <>
          <div className="operations-grid">
            <section className="geist-card">
              <h3>ربط SARAF الرئيسي</h3>
              <form
                onSubmit={async e => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  try {
                    setStatus(
                      await window.queue.saveOperations({
                        syncEnabled,
                        syncUrl,
                        ...(syncKey ? { syncKey } : {}),
                        dailyBackups,
                        dailyReports,
                      }),
                    );
                    setSyncKey('');
                    setResult({
                      message: 'حُفظت إعدادات التشغيل وتُطبّق دون إعادة إنشاء قاعدة البيانات.',
                    });
                    await refreshServer();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'تعذر حفظ الربط.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="checkbox">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={syncEnabled}
                    onChange={e => setSyncEnabled(e.target.checked)}
                  />
                  مزامنة المركز
                </label>
                <label>
                  عنوان استقبال المزامنة
                  <input
                    dir="ltr"
                    type="url"
                    maxLength={500}
                    value={syncUrl}
                    disabled={busy}
                    required={syncEnabled}
                    onChange={e => setSyncUrl(e.target.value)}
                  />
                </label>
                <label>
                  مفتاح ربط الفرع
                  {status.settings.hasSyncKey ? ' · محفوظ؛ اتركه فارغًا للاحتفاظ به' : ''}
                  <input
                    type="password"
                    autoComplete="new-password"
                    dir="ltr"
                    value={syncKey}
                    disabled={busy}
                    pattern="[a-f0-9]{64}"
                    maxLength={64}
                    required={syncEnabled && !status.settings.hasSyncKey}
                    onChange={e => setSyncKey(e.target.value)}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={dailyBackups}
                    disabled={busy}
                    onChange={e => setDailyBackups(e.target.checked)}
                  />
                  نسخة يومية تلقائية
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={dailyReports}
                    disabled={busy}
                    onChange={e => setDailyReports(e.target.checked)}
                  />
                  تقرير يومي بعد منتصف الليل السعودي
                </label>
                <div className="row">
                  <button className="primary" disabled={busy}>
                    حفظ إعدادات التشغيل
                  </button>
                  <button
                    type="button"
                    disabled={busy || !status.settings.syncEnabled}
                    onClick={() => void run({ action: 'sync_now' })}
                  >
                    مزامنة الآن
                  </button>
                </div>
              </form>
            </section>
            <section className="geist-card">
              <h3>سلامة قاعدة الفرع</h3>
              <dl className="server-details">
                <div>
                  <dt>قاعدة الخدمة</dt>
                  <dd dir="ltr">{status.databaseDirectory}</dd>
                  {canBrowse && (
                    <button
                      disabled={busy}
                      aria-label="فتح مجلد قاعدة البيانات"
                      onClick={() => void browse('database')}
                    >
                      استعراض
                    </button>
                  )}
                </div>
                <div>
                  <dt>النسخ الاحتياطية</dt>
                  <dd dir="ltr">{status.backupDirectory}</dd>
                  {canBrowse && (
                    <button
                      disabled={busy}
                      aria-label="فتح مجلد النسخ الاحتياطية"
                      onClick={() => void browse('backup')}
                    >
                      استعراض
                    </button>
                  )}
                </div>
                <div>
                  <dt>التقارير</dt>
                  <dd dir="ltr">{status.reportDirectory}</dd>
                  {canBrowse && (
                    <button
                      disabled={busy}
                      aria-label="فتح مجلد التقارير"
                      onClick={() => void browse('report')}
                    >
                      استعراض
                    </button>
                  )}
                </div>
              </dl>
              <div className="row">
                <button disabled={busy} onClick={() => void run({ action: 'database_check' })}>
                  فحص قاعدة البيانات
                </button>
                <button
                  disabled={busy}
                  onClick={() => void run({ action: 'database_maintenance' })}
                >
                  صيانة القاعدة
                </button>
                <button
                  disabled={busy}
                  onClick={() => void refresh().catch(() => setError('تعذر تحديث القائمة.'))}
                >
                  تحديث قائمة النسخ
                </button>
              </div>
              <p>الصيانة تتطلب إغلاق التذاكر المفتوحة، وتُنشئ نسخة متحققة قبل تحسين القاعدة.</p>
            </section>
          </div>
          <h3>النسخ المتاحة والاستعادة</h3>
          {status.backups.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>تاريخ النسخة · الرياض</th>
                    <th>الحجم</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {status.backups.map(b => (
                    <tr key={b.filename}>
                      <th>
                        <time>
                          {new Date(b.createdAt).toLocaleString('ar-SA-u-ca-gregory', {
                            timeZone: 'Asia/Riyadh',
                          })}
                        </time>
                        <small dir="ltr">{b.filename}</small>
                      </th>
                      <td>{(b.sizeBytes / 1048576).toFixed(1)} MB</td>
                      <td>
                        <div className="row">
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run({ action: 'verify_backup', filename: b.filename })
                            }
                          >
                            تحقق من النسخة
                          </button>
                          <button disabled={busy} onClick={() => setRestore(b.filename)}>
                            استعادة في قاعدة منفصلة
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>لم تُنشأ نسخ متاحة بعد. أنشئ نسخة من لوحة الخادم ثم حدّث القائمة.</p>
          )}
          {restore && (
            <section className="geist-card" aria-label="تأكيد الاستعادة">
              <h3>تهيئة الاستعادة؟</h3>
              <p>
                ستُنشأ قاعدة جديدة بعد التحقق من البصمة ومعرّف الفرع. تبقى قاعدة الخدمة الحالية كما
                هي، وتحتاج النسخة المستعادة مطابقة مع المركز قبل تفعيلها.
              </p>
              <div className="row">
                <button
                  disabled={busy}
                  onClick={() => void run({ action: 'restore_backup', filename: restore })}
                >
                  تهيئة النسخة المستعادة
                </button>
                <button disabled={busy} onClick={() => setRestore(null)}>
                  إلغاء الاستعادة
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {result && (
        <section className="operation-result">
          <p role="status">{result.message}</p>
          {result.directory && <p dir="ltr">{result.directory}</p>}
          {result.tables && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>السجل</th>
                    <th>عدد الصفوف</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tables.map(t => (
                    <tr key={t.name}>
                      <th dir="ltr">{t.name}</th>
                      <td>{t.rows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
