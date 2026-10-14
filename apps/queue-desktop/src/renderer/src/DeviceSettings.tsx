import { useEffect, useState } from 'react';
import { Xmark, Printer } from 'iconoir-react';
import { DisplayAudioSettings } from './DisplayAudioSettings';
import {
  defaultDevicePreferences,
  type DevicePreferences,
  type QueuePrinter,
} from '@saraf/queue-core/device';
export function DeviceSettings({
  onClose,
  onDisconnect,
  audio = false,
}: {
  onClose: () => void;
  onDisconnect: () => void;
  audio?: boolean;
}) {
  const [preferences, setPreferences] = useState<DevicePreferences>(defaultDevicePreferences),
    [printers, setPrinters] = useState<QueuePrinter[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([window.queue.devicePreferences(), window.queue.printers()])
      .then(([value, list]) => {
        if (alive) {
          setPreferences(value);
          setPrinters(list);
        }
      })
      .catch(() => {
        if (alive) setError('تعذر تحميل الطابعات. تحقق من إعدادات Windows.');
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <main className="panel device-settings">
      <header>
        <img className="brand-logo" src="/icon.png" alt="النذير" />
        <div>
          <strong>إعدادات الجهاز</strong>
          <small>تُحفظ هذه الخيارات على هذا الجهاز فقط.</small>
        </div>
        <button aria-label="العودة إلى الشاشة" onClick={onClose}>
          <Xmark />
        </button>
      </header>
      <div className="panel-content">
        {audio && <DisplayAudioSettings />}
        <h2>
          <Printer /> طابعة التذاكر
        </h2>
        <form
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setSaved(false);
            try {
              setPreferences(await window.queue.saveDevicePreferences(preferences));
              setSaved(true);
            } catch {
              setError('تعذر الحفظ. اختر طابعة متاحة قبل تفعيل الطباعة التلقائية.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            الطابعة
            <select
              aria-label="الطابعة"
              disabled={busy}
              value={preferences.printerName ?? ''}
              onChange={e =>
                setPreferences({
                  ...preferences,
                  printerName: e.target.value || null,
                  autoPrint: !!e.target.value && preferences.autoPrint,
                })
              }
            >
              <option value="">استخدام مربع حوار الطباعة</option>
              {printers.map(p => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            عرض الورق
            <select
              disabled={busy}
              value={preferences.paperWidth}
              onChange={e =>
                setPreferences({
                  ...preferences,
                  paperWidth: e.target.value as DevicePreferences['paperWidth'],
                })
              }
            >
              <option value="80mm">80 مم</option>
              <option value="58mm">58 مم</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={busy || !preferences.printerName}
              checked={preferences.autoPrint}
              onChange={e => setPreferences({ ...preferences, autoPrint: e.target.checked })}
            />
            طباعة تلقائية بعد إصدار التذكرة
          </label>
          <label>
            العودة لاختيار الخدمة بعد الطباعة (ثانية)
            <input
              type="number"
              min={5}
              max={60}
              disabled={busy}
              value={preferences.resetSeconds}
              onChange={e =>
                setPreferences({ ...preferences, resetSeconds: Number(e.target.value) })
              }
            />
          </label>
          <p>ثبّت تعريف الطابعة في Windows واختبر الورق والقاطع قبل فتح الخدمة للعملاء.</p>
          <button className="primary" disabled={busy}>
            حفظ إعدادات الجهاز
          </button>
        </form>
        {saved && <p role="status">تم حفظ إعدادات الجهاز.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <h2>اتصال الفرع</h2>
        <button onClick={onDisconnect}>تغيير اتصال الجهاز</button>
      </div>
    </main>
  );
}
