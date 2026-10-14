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
          if (alive) setError('تعذر قراءة إعدادات النداء.');
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
      setError(e instanceof Error ? e.message : 'تعذر تحديث إعدادات النداء.');
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: Partial<AudioSettings>) => {
    if (status) void run(() => window.queue.saveAudioSettings({ ...status.settings, ...patch }));
  };
  const runtime = status?.runtime;
  const toggle = (channel: 'voiceEnabled' | 'alertEnabled') => {
    if (!status) return;
    const settings = status.settings;
    save({
      enabled: true,
      voiceEnabled: settings.enabled && settings.voiceEnabled,
      alertEnabled: settings.enabled && settings.alertEnabled,
      [channel]: !(settings.enabled && settings[channel]),
    });
  };
  const voiceOn = !!status?.settings.enabled && !!status.settings.voiceEnabled;
  const alertOn = !!status?.settings.enabled && !!status.settings.alertEnabled;
  return (
    <section className="display-audio-settings">
      <h2>إعدادات النداء</h2>
      <p>
        تُحفظ الخيارات على كمبيوتر العرض وتُطبّق مباشرة على شاشة العرض. تبقى شاشة العملاء خالية من
        أدوات التحكم.
      </p>
      <label>
        أسلوب النداء
        <select
          disabled={busy || !status}
          value={status?.settings.mode ?? 'auto'}
          onChange={e => save({ mode: e.target.value as AudioSettings['mode'] })}
        >
          <option value="auto">تلقائي · المكتبة العربية أولًا</option>
          <option value="natural">صوت طبيعي · النداءات المحفوظة</option>
          <option value="local">صوت الجهاز</option>
        </select>
      </label>
      {runtime?.mode === 'local' && runtime.voices.length > 0 && (
        <label>
          الصوت العربي
          <select
            disabled={busy}
            value={status?.settings.voiceURI || runtime.voiceURI}
            onChange={e => save({ voiceURI: e.target.value })}
          >
            {runtime.voices.map(v => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        مستوى صوت النداء ({Math.round((status?.settings.volume ?? 1) * 100)}%)
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
          aria-pressed={voiceOn}
          onClick={() => toggle('voiceEnabled')}
        >
          {voiceOn ? 'كتم النداء الصوتي' : 'تشغيل النداء الصوتي'}
        </button>
        <button
          disabled={busy || !status}
          aria-pressed={alertOn}
          onClick={() => toggle('alertEnabled')}
        >
          {alertOn ? 'كتم صوت التنبيه' : 'تشغيل صوت التنبيه'}
        </button>
        <button
          disabled={busy || !runtime || (!alertOn && !(voiceOn && runtime.ready))}
          onClick={() => void run(() => window.queue.testTvAudio())}
        >
          اختبار النداء
        </button>
      </div>
      <p>
        {voiceOn && alertOn
          ? 'تنبيه ثم نداء عربي'
          : voiceOn
            ? 'نداء عربي دون تنبيه'
            : alertOn
              ? 'تنبيه دون نداء عربي'
              : 'نداء مرئي دون صوت'}
      </p>
      {!runtime && <p role="status">افتح شاشة العرض لقراءة حالة الصوت وإجراء الاختبار.</p>}
      {runtime?.ready && (
        <p role="status">
          {runtime.mode === 'natural'
            ? 'المكتبة العربية جاهزة · تعمل دون اتصال'
            : 'صوت الجهاز جاهز'}
        </p>
      )}
      {runtime &&
        !runtime.ready &&
        (status?.settings.mode === 'local' || !runtime.natural?.restartRequired) && (
          <p role="status">
            {runtime.mode === 'local'
              ? 'لا يوجد صوت عربي محلي متاح. أضف صوت العربية (السعودية) من إعدادات الكلام في Windows.'
              : 'مكتبة النداءات غير جاهزة على خادم الفرع.'}
          </p>
        )}
      {runtime?.natural?.restartRequired && (
        <p role="status">لتفعيل النداء العربي، أعد تشغيل خادم الفرع بعد تحديثه.</p>
      )}
      {(error || runtime?.error) && (
        <p className="error" role="alert">
          {error || runtime?.error}
        </p>
      )}
      <p>
        اختر مخرج HDMI في إعدادات صوت Windows ليصل التنبيه والنداء إلى سماعات شاشة العرض. يتحكم
        مستوى الصوت أعلاه في التنبيه والعبارة معًا. تغييرات المستوى تُطبّق على النداء التالي دون
        مقاطعة النداء الجاري.
      </p>
    </section>
  );
}
