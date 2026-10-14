import { useEffect, useState } from 'react';
import { hostSetupSchema, type HostSetupInfo } from '../../setup-contract';

export function HostSetupForm({
  onConnected,
  onBusy,
}: {
  onConnected: () => Promise<void>;
  onBusy: (value: boolean) => void;
}) {
  const [info, setInfo] = useState<HostSetupInfo | null>(null),
    [directory, setDirectory] = useState('');
  const [branchId, setBranchId] = useState(''),
    [localEvaluation, setLocalEvaluation] = useState(false),
    [port, setPort] = useState(4318),
    [host, setHost] = useState('127.0.0.1');
  const [url, setUrl] = useState(''),
    [cert, setCert] = useState(''),
    [key, setKey] = useState('');
  const [syncUrl, setSyncUrl] = useState(''),
    [syncKey, setSyncKey] = useState(''),
    [openAtLogin, setOpenAtLogin] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [speechVoiceId, setSpeechVoiceId] = useState(''),
    [speechApiKey, setSpeechApiKey] = useState('');
  useEffect(() => {
    let alive = true;
    window.queue
      .hostSetupInfo()
      .then(value => {
        if (alive) {
          setInfo(value);
          setDirectory(value.directory);
          setOpenAtLogin(value.startupSupported);
        }
      })
      .catch(() => {
        if (alive) setError('تعذر تحميل إعدادات الخادم.');
      });
    return () => {
      alive = false;
    };
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إعداد الخادم');
      setInfo(await window.queue.hostSetupInfo().catch(() => info));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  const pick = async (kind: 'directory' | 'cert' | 'key') =>
    run(async () => {
      const value = await window.queue.chooseSetupPath(kind);
      if (value) (kind === 'directory' ? setDirectory : kind === 'cert' ? setCert : setKey)(value);
    });
  return (
    <>
      <p>
        ثبّت خادمًا واحدًا على كمبيوتر دائم التشغيل لكل فرع. تُنشأ قاعدة فارغة؛ بيانات الفرع الحالية
        تبقى محفوظة.
      </p>
      {info?.configured ? (
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await window.queue.resumeHost();
              await onConnected();
            })
          }
        >
          استئناف إعداد الخادم
        </button>
      ) : (
        <form
          noValidate
          aria-busy={busy}
          onSubmit={e => {
            e.preventDefault();
            void run(async () => {
              const parsed = hostSetupSchema.safeParse({
                branchId,
                localEvaluation,
                directory,
                port,
                host,
                url: host === '127.0.0.1' ? `http://127.0.0.1:${port}` : url,
                ...(host !== '127.0.0.1' ? { cert, key } : {}),
                ...(syncUrl ? { syncUrl, syncKey } : {}),
                openAtLogin,
                ...(!info?.localVoiceAvailable && speechVoiceId
                  ? { speechVoiceId, ...(speechApiKey ? { speechApiKey } : {}) }
                  : {}),
              });
              if (!parsed.success) throw new Error(parsed.error.issues[0].message);
              await window.queue.createHost(parsed.data);
              setSyncKey('');
              setSpeechApiKey('');
              await onConnected();
            });
          }}
        >
          <label>
            معرّف الفرع في SARAF
            <input
              value={branchId}
              onChange={e => {
                setBranchId(e.target.value.trim());
                setLocalEvaluation(false);
              }}
              disabled={busy}
              required
              dir="ltr"
              placeholder="UUID"
              aria-describedby="branch-id-help"
            />
          </label>
          <small id="branch-id-help">
            يوفّره مسؤول SARAF من سجل الفرع. ليس اسم الفرع أو مفتاح الجهاز. لا تغيّر معرّف قاعدة
            موجودة.
          </small>
          <button
            type="button"
            disabled={busy || !!syncUrl}
            onClick={() => {
              setBranchId(crypto.randomUUID());
              setLocalEvaluation(true);
              setSyncKey('');
              setError('');
            }}
          >
            إنشاء معرّف لتجربة محلية فقط
          </button>
          {localEvaluation && (
            <p role="status">
              تجربة محلية مستقلة بدون مزامنة SARAF. للإنتاج، استخدم معرّف الفرع الحقيقي قبل إنشاء
              قاعدة البيانات.
            </p>
          )}
          <label>
            مجلد بيانات الفرع
            <input value={directory} readOnly dir="ltr" />
          </label>
          <button type="button" disabled={busy || !info} onClick={() => void pick('directory')}>
            اختيار مجلد فارغ
          </button>
          <label className="checkbox setup-startup">
            <input
              type="checkbox"
              disabled={busy || !info?.startupSupported}
              checked={openAtLogin}
              onChange={e => setOpenAtLogin(e.target.checked)}
            />
            تشغيل الخادم عند تسجيل الدخول إلى Windows
          </label>
          <details className="setup-advanced">
            <summary>اتصال أجهزة الفرع والمركز</summary>
            <label>
              الوصول إلى الخادم
              <select value={host} disabled={busy} onChange={e => setHost(e.target.value)}>
                <option value="127.0.0.1">هذا الكمبيوتر فقط</option>
                {info?.addresses.map(address => (
                  <option key={address} value={address}>
                    شبكة محلية أو VPN · {address}
                  </option>
                ))}
              </select>
            </label>
            <label>
              منفذ الخادم
              <input
                type="number"
                min={1024}
                max={65535}
                value={port}
                disabled={busy}
                onChange={e => setPort(Number(e.target.value))}
              />
            </label>
            {host !== '127.0.0.1' && (
              <>
                <label>
                  عنوان الخادم HTTPS
                  <input
                    type="url"
                    value={url}
                    disabled={busy}
                    onChange={e => setUrl(e.target.value)}
                    required
                    dir="ltr"
                    placeholder={`https://branch-server:${port}`}
                  />
                </label>
                <button type="button" disabled={busy} onClick={() => void pick('cert')}>
                  اختيار شهادة TLS
                </button>
                <small dir="ltr">{cert}</small>
                <button type="button" disabled={busy} onClick={() => void pick('key')}>
                  اختيار المفتاح الخاص للشهادة
                </button>
                <small dir="ltr">{key}</small>
                <p>
                  اختر عنوانًا ثابتًا يمكن لأجهزة الفرع الوصول إليه عبر LAN أو VPN. يجب أن تطابق
                  شهادة TLS اسم الخادم وأن تثق بها الأجهزة. يضبط مسؤول التقنية المسار وDNS وفتح
                  المنفذ للشبكة المصرّح بها فقط.
                </p>
              </>
            )}
            <label>
              عنوان مزامنة SARAF · اختياري
              <input
                type="url"
                value={syncUrl}
                disabled={busy || localEvaluation}
                onChange={e => setSyncUrl(e.target.value)}
                dir="ltr"
                placeholder="https://saraf.example/api/queue/sync"
              />
            </label>
            <small>
              تبقى قاعدة الفرع محلية. عند انقطاع VPN إلى SARAF تستمر أجهزة LAN وتُعاد محاولة
              المزامنة تلقائيًا. يحتاج الجهاز المتصل عبر VPN إلى اتصال فعّال بخادم الفرع.
            </small>
            {syncUrl && (
              <label>
                مفتاح مزامنة الفرع
                <input
                  type="password"
                  value={syncKey}
                  disabled={busy}
                  onChange={e => setSyncKey(e.target.value)}
                  dir="ltr"
                  minLength={64}
                  maxLength={64}
                  required
                  autoComplete="off"
                />
              </label>
            )}
          </details>
          {info?.localVoiceAvailable ? (
            <p>نداء عربي جاهز يعمل دون اشتراك أو اتصال بالإنترنت.</p>
          ) : (
            <details className="setup-advanced">
              <summary>النداء بصوت عربي طبيعي · اختياري</summary>
              <p>
                أدخل معرّف صوت عربي ومفتاح خدمة الصوت. تُحفظ النداءات على الخادم لإعادة استخدامها،
                ويُحفظ المفتاح مشفرًا على هذا الكمبيوتر.
              </p>
              <label>
                معرّف الصوت
                <input
                  value={speechVoiceId}
                  disabled={busy}
                  dir="ltr"
                  onChange={e => setSpeechVoiceId(e.target.value.trim())}
                  maxLength={80}
                />
              </label>
              <label>
                مفتاح خدمة الصوت
                <input
                  type="password"
                  value={speechApiKey}
                  disabled={busy}
                  dir="ltr"
                  autoComplete="off"
                  onChange={e => setSpeechApiKey(e.target.value)}
                  maxLength={300}
                />
              </label>
              <small>
                بدون مفتاح، تتاح النداءات المحفوظة فقط. تُنشأ الجمل الجديدة عند توفر الاتصال.
              </small>
            </details>
          )}
          <button className="primary" disabled={busy || !info}>
            {busy ? 'جارٍ إنشاء الخادم…' : 'إنشاء خادم الفرع'}
          </button>
        </form>
      )}
      {busy && <p role="status">يرجى الانتظار حتى اكتمال الإعداد.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
