import { Select } from './Select';
import { useEffect, useState } from 'react';
import type { TvStatus } from '../../setup-contract';
import { DisplayAudioSettings } from './DisplayAudioSettings';

export function HdmiPanel() {
  const [status, setStatus] = useState<TvStatus | null>(null),
    [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const refresh = async () => {
    const next = await window.queue.tvStatus();
    setStatus(next);
    setSelected(previous =>
      next.monitors.some(m => String(m.id) === previous)
        ? previous
        : String(next.monitors.find(m => !m.primary)?.id ?? ''),
    );
  };
  useEffect(() => {
    void refresh().catch(() => setError('تعذر قراءة شاشات الكمبيوتر.'));
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تشغيل شاشة العرض');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="hdmi-panel">
      <h2>إدارة شاشات العرض</h2>
      <p>
        وصّل شاشة العرض بكمبيوتر المدير. في Windows اضغط Win + P واختر «توسيع». تبقى لوحة الإدارة
        على شاشتك، ويظهر الدور بملء شاشة العرض.
      </p>
      <label>
        شاشة العرض
        <Select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>
          <option value="">اختر الشاشة الثانية</option>
          {status?.monitors.map(m => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.width}×{m.height}
              {m.primary ? ' · الرئيسية' : ''}
            </option>
          ))}
        </Select>
      </label>
      {(status?.monitors.length ?? 0) < 2 && (
        <p role="status">لم تُكتشف شاشة ثانية. تحقق من كابل HDMI ووضع «توسيع»، ثم حدّث الشاشات.</p>
      )}
      <div className="row">
        <button disabled={busy} onClick={() => void run(refresh)}>
          تحديث الشاشات
        </button>
        <button
          className="primary"
          disabled={busy || !selected || (status?.monitors.length ?? 0) < 2}
          onClick={() => void run(() => window.queue.openTv(Number(selected)))}
        >
          تشغيل شاشة العرض
        </button>
        {status?.open && (
          <button disabled={busy} onClick={() => void run(() => window.queue.closeTv())}>
            إيقاف شاشة العرض
          </button>
        )}
      </div>
      {status?.open && <p role="status">شاشة العرض تعمل. إغلاق شاشة العرض لا يوقف خادم الفرع.</p>}
      <DisplayAudioSettings />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
