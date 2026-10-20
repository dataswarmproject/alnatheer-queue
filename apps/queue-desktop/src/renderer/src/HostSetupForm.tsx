import { Select } from './Select';
import { NetworkCertificate } from './NetworkCertificate';
import { useEffect, useState } from 'react';
import { hostSetupRequestSchema, type HostSetupInfo } from '../../setup-contract';

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
    [port, setPort] = useState(4318),
    [host, setHost] = useState('127.0.0.1');
  const [url, setUrl] = useState(''),
    [cert, setCert] = useState(''),
    [key, setKey] = useState('');
  const [tlsMode, setTlsMode] = useState<'automatic' | 'manual'>('automatic');
  const endpoint = tlsMode === 'automatic' ? `https://${host}:${port}` : url;
  const [syncUrl, setSyncUrl] = useState(''),
    [syncKey, setSyncKey] = useState(''),
    [openAtLogin, setOpenAtLogin] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
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
      <p>جهّز خادمًا واحدًا لكل فرع، ثم اربط به أجهزة الموظفين وإصدار التذاكر.</p>
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
              const parsed = hostSetupRequestSchema.safeParse({
                ...(branchId ? { branchId } : {}),
                directory,
                port,
                host,
                url: host === '127.0.0.1' ? `http://127.0.0.1:${port}` : endpoint,
                ...(host !== '127.0.0.1'
                  ? { tlsMode, ...(tlsMode === 'manual' ? { cert, key } : {}) }
                  : {}),
                ...(syncUrl ? { syncUrl, syncKey } : {}),
                openAtLogin,
              });
              if (!parsed.success) throw new Error(parsed.error.issues[0].message);
              await window.queue.createHost(parsed.data);
              setSyncKey('');
              await onConnected();
            });
          }}
        >
          <p id="branch-id-help">
            يُنشأ معرّف الفرع تلقائيًا ويُحفظ مع قاعدة البيانات. يمكنك نسخه أو حفظ ملفه من «إدارة
            النظام» لربط الفرع بـ SARAF لاحقًا.
          </p>
          <details className="setup-advanced">
            <summary>لديّ معرّف فرع مسجّل في SARAF</summary>
            <label>
              معرّف الفرع الحالي · اختياري
              <input
                value={branchId}
                onChange={e => setBranchId(e.target.value.trim())}
                disabled={busy}
                dir="ltr"
                placeholder="اتركه فارغًا لإنشاء معرّف تلقائيًا"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="branch-id-help"
              />
            </label>
            <small>
              إذا كان الفرع مسجّلًا بالفعل، استخدم معرّفه الحالي لتجنّب إنشاء هوية أخرى له.
            </small>
          </details>
          <label>
            مجلد بيانات الفرع
            <span className="path-picker">
              <input
                value={directory}
                readOnly
                dir="ltr"
                placeholder="اختر مجلدًا محليًا فارغًا"
                aria-describedby="database-folder-help"
              />
              <button
                type="button"
                aria-label="اختيار مجلد فارغ"
                disabled={busy || !info}
                onClick={() => void pick('directory')}
              >
                تصفح…
              </button>
            </span>
          </label>
          <small id="database-folder-help">تُنشأ قاعدة البيانات تلقائيًا داخل هذا المجلد.</small>
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
              <Select value={host} disabled={busy} onChange={e => setHost(e.target.value)}>
                <option value="127.0.0.1">هذا الكمبيوتر فقط</option>
                {info?.addresses.map(address => (
                  <option key={address} value={address}>
                    شبكة محلية أو VPN · {address}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              منفذ الخادم
              <input
                type="number"
                min={1024}
                max={65535}
                value={port}
                placeholder="4318"
                dir="ltr"
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
                    value={endpoint}
                    readOnly={tlsMode === 'automatic'}
                    disabled={busy}
                    onChange={e => setUrl(e.target.value)}
                    required
                    dir="ltr"
                    placeholder={`https://branch-server:${port}`}
                  />
                </label>
                <NetworkCertificate
                  mode={tlsMode}
                  onMode={setTlsMode}
                  cert={cert}
                  keyFile={key}
                  pick={kind => void pick(kind)}
                  busy={busy}
                />
                <p>
                  اختر عنوانًا ثابتًا يمكن لأجهزة الفرع الوصول إليه عبر LAN أو VPN. يجب أن تطابق
                  شهادة الشركة اسم الخادم عند اختيار الإعداد اليدوي. يضبط مسؤول التقنية المسار وDNS
                  وفتح المنفذ للشبكة المصرّح بها فقط.
                </p>
              </>
            )}
            <label>
              عنوان مزامنة SARAF · اختياري
              <input
                type="url"
                value={syncUrl}
                disabled={busy}
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
                  placeholder="الصق مفتاح المزامنة من مسؤول SARAF"
                />
              </label>
            )}
          </details>
          <button className="primary" disabled={busy || !info}>
            {busy ? 'جارٍ إنشاء الخادم…' : 'إنشاء خادم الفرع'}
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
