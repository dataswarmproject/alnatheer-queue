import { useEffect, useState } from 'react';
import type { AudioSettings, AudioStatus } from '../../audio-contract';

export function DisplayAudioSettings() {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      window.queue
        .audioStatus()
        .then(value => {
          if (alive) setStatus(value);
        })
        .catch(() => {
          if (alive) setError('تعذر قراءة إعدادات التنبيه.');
        });
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setStatus(await window.queue.audioStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحديث إعدادات التنبيه.');
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: Partial<AudioSettings>) => {
    if (status)
      void run(() =>
        window.queue.saveAudioSettings({ ...status.settings, ...patch, voiceEnabled: false }),
      );
  };
  const alertOn = !!status?.settings.enabled && !!status.settings.alertEnabled;
  return (
    <section className="display-audio-settings">
      <h2>إعدادات التنبيه</h2>
      <p>تُطبّق الإعدادات على شاشة العرض المتصلة بكمبيوتر المدير.</p>
      <label>
        مستوى صوت التنبيه ({Math.round((status?.settings.volume ?? 1) * 100)}%)
        <input
          type="range"
          dir="ltr"
          min="0"
          max="100"
          step="5"
          disabled={busy || !status}
          value={Math.round((status?.settings.volume ?? 1) * 100)}
          onChange={e => save({ volume: Number(e.target.value) / 100 })}
        />
      </label>
      <div className="row">
        <button
          disabled={busy || !status}
          aria-pressed={alertOn}
          onClick={() => save({ enabled: true, alertEnabled: !alertOn })}
        >
          {alertOn ? 'كتم صوت التنبيه' : 'تشغيل صوت التنبيه'}
        </button>
        <button
          disabled={busy || !status?.runtime || !alertOn}
          onClick={() => void run(() => window.queue.testTvAudio())}
        >
          اختبار التنبيه
        </button>
      </div>
      <small>النداء الصوتي غير متاح في هذا الإصدار.</small>
      {!status?.runtime && <p role="status">افتح شاشة العرض لاختبار التنبيه.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>اختر مخرج شاشة العرض من إعدادات صوت Windows ليصل التنبيه إلى سماعاتها.</p>
    </section>
  );
}
