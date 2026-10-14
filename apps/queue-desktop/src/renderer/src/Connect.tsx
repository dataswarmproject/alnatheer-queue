import { useEffect, useRef, useState } from 'react';
import { Xmark, User, Printer, Settings, Server, Tv } from 'iconoir-react';
import type { DeviceMode } from '../../setup-contract';
import { HostSetupForm } from './HostSetupForm';

const choices = [
  {
    mode: 'teller',
    title: 'موظف الكاونتر',
    description: 'شريط جانبي صغير فوق برنامج الصرافة.',
    icon: User,
  },
  {
    mode: 'kiosk',
    title: 'جهاز إصدار التذاكر',
    description: 'شاشة لمس للعميل وطابعة التذاكر.',
    icon: Printer,
  },
  {
    mode: 'manager',
    title: 'إدارة الفرع',
    description: 'الخدمات والموظفون وتقارير الأداء.',
    icon: Settings,
  },
  {
    mode: 'hdmi',
    title: 'شاشات العرض',
    description: 'عرض أرقام التذاكر على شاشة متصلة بكمبيوتر المدير.',
    icon: Tv,
  },
  {
    mode: 'server',
    title: 'خادم الفرع',
    description: 'قاعدة محلية مستقلة تعمل في الخلفية.',
    icon: Server,
  },
] as const;

export function Connect({
  onConnect,
  onConnected,
}: {
  onConnect: (url: string, key: string, mode?: DeviceMode) => Promise<void>;
  onConnected: () => Promise<void>;
}) {
  const [mode, setMode] = useState<DeviceMode | 'server' | null>(null);
  const [url, setUrl] = useState('http://127.0.0.1:4318'),
    [key, setKey] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [mode]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إكمال الإعداد');
    } finally {
      setBusy(false);
    }
  };
  const title = choices.find(c => c.mode === mode)?.title ?? 'شاشة مستقلة';
  return (
    <main className="panel setup setup-wizard">
      <header>
        <div className="brand-heading">
          <img className="brand-logo" src="/icon.png" alt="النذير للصرافة" />
          <span>النذير · إعداد الجهاز</span>
        </div>
        <button aria-label="إغلاق التطبيق" disabled={busy} onClick={() => void window.queue.quit()}>
          <Xmark />
        </button>
      </header>
      <h1 ref={heading} tabIndex={-1}>
        {mode ? title : 'كيف سيُستخدم هذا الكمبيوتر؟'}
      </h1>
      {mode ? (
        <>
          <button
            className="setup-back"
            disabled={busy}
            onClick={() => {
              setMode(null);
              setKey('');
              setError('');
            }}
          >
            تغيير الاستخدام
          </button>
          {mode === 'server' ? (
            <HostSetupForm onConnected={onConnected} onBusy={setBusy} />
          ) : (
            <>
              {mode === 'hdmi' ? (
                <p>وصّل شاشة العرض بهذا الكمبيوتر عبر HDMI</p>
              ) : (
                <p>استخدم ملف الاقتران أو مفتاح الجهاز الذي أصدره مدير الفرع.</p>
              )}
              {mode === 'hdmi' && (
                <p>
                  استخدم مفتاح مدير الفرع، ثم اختر الشاشة الثانية. اختر «توسيع» في Windows حتى تبقى
                  الإدارة على الشاشة الرئيسية.
                </p>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    if (await window.queue.importPairing(mode)) await onConnected();
                  })
                }
              >
                استيراد ملف الاقتران
              </button>
              <form
                aria-busy={busy}
                onSubmit={e => {
                  e.preventDefault();
                  void act(async () => {
                    await onConnect(url, key.trim(), mode);
                    setKey('');
                  });
                }}
              >
                <label>
                  عنوان خدمة الفرع
                  <input
                    value={url}
                    disabled={busy}
                    onChange={e => setUrl(e.target.value)}
                    dir="ltr"
                    required
                    type="url"
                    autoComplete="off"
                  />
                </label>
                <label>
                  مفتاح الجهاز
                  <input
                    value={key}
                    disabled={busy}
                    onChange={e => setKey(e.target.value)}
                    dir="ltr"
                    required
                    type="password"
                    autoComplete="off"
                    minLength={64}
                    maxLength={64}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? 'جارٍ الاتصال…' : 'اتصال'}
                </button>
              </form>
              <small>
                يُتحقق من الاستخدام قبل حفظ المفتاح بتشفير Windows. لن يمنح اختيار نوع الجهاز
                صلاحيات إضافية.
              </small>
            </>
          )}
        </>
      ) : (
        <>
          <p>اختر استخدام الجهاز. يمكنك تغيير الاتصال لاحقًا من إعداداته.</p>
          <div className="setup-choices">
            {choices.map(({ mode, title, description, icon: Icon }) => (
              <button key={mode} onClick={() => setMode(mode)}>
                <Icon aria-hidden="true" />
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
              </button>
            ))}
          </div>
          <details className="setup-advanced">
            <summary>شاشات مستقلة · إعداد متقدم</summary>
            <p>لشاشة لها كمبيوتر مستقل. الشاشة المتصلة بكمبيوتر المدير لا تحتاج إلى تثبيت منفصل.</p>
            <div className="row">
              <button onClick={() => setMode('display')}>شاشة انتظار مستقلة</button>
              <button onClick={() => setMode('counter-display')}>شاشة رقم الكاونتر</button>
            </div>
          </details>
          <small>
            جهّز خادم الفرع أولًا، ثم اربط أجهزة الموظفين وإصدار التذاكر به عبر الشبكة المحلية.
          </small>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
