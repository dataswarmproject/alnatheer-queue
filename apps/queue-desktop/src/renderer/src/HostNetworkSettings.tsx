import { useEffect, useState } from 'react';
import type { HostNetworkInfo } from '../../setup-contract';
import { Select } from './Select';
import { Form } from './Form';

export function HostNetworkSettings({ onChanged }: { onChanged: () => Promise<void> }) {
  const [info, setInfo] = useState<HostNetworkInfo | null>(null);
  const [open, setOpen] = useState(false),
    [host, setHost] = useState(''),
    [url, setUrl] = useState('');
  const [port, setPort] = useState(4318),
    [cert, setCert] = useState(''),
    [key, setKey] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    void window.queue
      .hostNetworkInfo()
      .then(value => {
        setInfo(value);
        setHost(value.addresses[0] ?? '');
        setPort(value.port);
      })
      .catch(() => {});
  }, []);
  const pick = async (kind: 'cert' | 'key') => {
    setBusy(true);
    setError('');
    try {
      const file = await window.queue.chooseSetupPath(kind);
      if (file) (kind === 'cert' ? setCert : setKey)(file);
    } catch {
      setError('تعذر اختيار ملف الشهادة.');
    } finally {
      setBusy(false);
    }
  };
  if (!info?.available && !message) return null;
  return (
    <section className="geist-card">
      <h3>اتصال أجهزة الفرع</h3>
      {!message && (
        <>
          <p>
            الخادم متاح لهذا الكمبيوتر فقط. فعّل HTTPS لربط أجهزة الموظفين والكشك عبر LAN أو VPN.
          </p>
          <button disabled={busy} onClick={() => setOpen(value => !value)}>
            إعداد اتصال الشبكة
          </button>
        </>
      )}
      {open && (
        <Form
          aria-busy={busy}
          onSubmit={event => {
            event.preventDefault();
            setBusy(true);
            setError('');
            void window.queue
              .enableHostNetwork({ host, url: url.trim(), port, cert, key })
              .then(async result => {
                setMessage(
                  `فُعّل اتصال الفرع: ${result.url}. حُفظت نسخة احتياطية قبل التغيير. أصدر ملفات اقتران جديدة للأجهزة؛ ملفات العنوان المحلي القديمة لا تتغير تلقائيًا.`,
                );
                setOpen(false);
                setInfo(null);
                await onChanged();
              })
              .catch(e => setError(e instanceof Error ? e.message : 'تعذر تفعيل اتصال الشبكة.'))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            واجهة شبكة الخادم
            <Select
              aria-label="واجهة شبكة الخادم"
              required
              disabled={busy}
              value={host}
              onChange={event => setHost(event.target.value)}
            >
              <option value="">اختر عنوان الشبكة الثابت</option>
              {info?.addresses.map(address => (
                <option key={address} value={address}>
                  {address}
                </option>
              ))}
            </Select>
          </label>
          <label>
            منفذ اتصال الشبكة
            <input
              aria-label="منفذ اتصال الشبكة"
              type="number"
              min={1024}
              max={65535}
              required
              dir="ltr"
              disabled={busy}
              value={port}
              onChange={event => setPort(Number(event.target.value))}
            />
          </label>
          <label>
            عنوان الخادم HTTPS
            <input
              aria-label="عنوان الخادم HTTPS"
              type="url"
              required
              dir="ltr"
              disabled={busy}
              value={url}
              placeholder={`https://branch-server:${port}`}
              onChange={event => setUrl(event.target.value)}
            />
          </label>
          <label>
            شهادة اتصال الشبكة
            <span className="path-picker">
              <input
                aria-label="شهادة اتصال الشبكة"
                value={cert}
                readOnly
                required
                placeholder="ملف PEM أو CRT المطابق لاسم الخادم"
                dir="ltr"
              />
              <button type="button" disabled={busy} onClick={() => void pick('cert')}>
                اختيار الشهادة
              </button>
            </span>
          </label>
          <label>
            مفتاح شهادة الشبكة
            <span className="path-picker">
              <input
                aria-label="مفتاح شهادة الشبكة"
                value={key}
                readOnly
                required
                placeholder="ملف المفتاح الخاص بالشهادة"
                dir="ltr"
              />
              <button type="button" disabled={busy} onClick={() => void pick('key')}>
                اختيار مفتاح الشهادة
              </button>
            </span>
          </label>
          <p>
            جهّز شهادة موثوقة تطابق العنوان وافتح المنفذ من نطاق أجهزة الفرع فقط. أغلق التذاكر
            المفتوحة قبل التطبيق؛ تُحفظ نسخة متحققة ثم يُعاد تشغيل الخادم بالقاعدة ومعرّف الفرع
            نفسيهما. أعد تشغيل شاشة العرض بعد التغيير.
          </p>
          <button className="primary" disabled={busy || !host || !cert || !key}>
            {busy ? 'جارٍ فحص الشبكة وتطبيق الإعداد…' : 'تفعيل اتصال الشبكة مع حفظ البيانات'}
          </button>
        </Form>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
