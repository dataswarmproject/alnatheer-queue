import { Select } from './Select';
import { useEffect, useState } from 'react';
import type { Service, Role } from '@saraf/queue-core';
import type { QueueController } from './useQueue';
import { Plus, Xmark } from 'iconoir-react';
import { Form } from './Form';
const roleNames: Record<Role, string> = {
  manager: 'مدير الفرع',
  teller: 'موظف كاونتر',
  kiosk: 'كشك التذاكر والطابعة',
  display: 'شاشة عرض',
};
export function Management({
  queue,
  onCounters,
}: {
  queue: QueueController;
  onCounters: () => void;
}) {
  const [services, setServices] = useState<Service[]>(queue.snapshot!.services),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>('teller'),
    [counterId, setCounterId] = useState(''),
    [name, setName] = useState(''),
    [staffRef, setStaffRef] = useState(''),
    [key, setKey] = useState('');
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof window.queue.devices>>>([]);
  const [firstCounterName, setFirstCounterName] = useState('');
  const [firstCounterId] = useState(() => crypto.randomUUID());
  const load = async () => {
    try {
      setDevices(await window.queue.devices());
    } catch (e) {
      setError(String((e as Error).message));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="management">
      <h2>خدمات الفرع</h2>
      <Form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await window.queue.configure({
              services,
              counters: queue.snapshot!.counters.length
                ? queue.snapshot!.counters
                : [
                    {
                      id: firstCounterId,
                      number: 1,
                      name: `كاونتر 1${firstCounterName ? ' · ' + firstCounterName : ''}`,
                      serviceIds: services.filter(s => s.active).map(s => s.id),
                      paused: true,
                      revision: 0,
                    },
                  ],
            });
            await queue.refresh();
          } catch (e) {
            setError(String((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        {!queue.snapshot!.counters.length && (
          <section className="geist-card">
            <h3>تهيئة أول كاونتر</h3>
            <p>
              أضف خدمة مفعلة ثم احفظها مع أول كاونتر. يبدأ الاستقبال متوقفًا إلى أن تربط الموظف
              وتفعّله.
            </p>
            <label>
              اسم إضافي لأول كاونتر · اختياري
              <input
                maxLength={50}
                value={firstCounterName}
                onChange={e => setFirstCounterName(e.target.value)}
                placeholder="مثال: الحوالات"
              />
            </label>
          </section>
        )}
        {services.map((s, i) => (
          <div className="config-row service-editor" key={s.id}>
            <label>
              اسم الخدمة
              <input
                aria-label="اسم الخدمة"
                placeholder="مثال: بيع وشراء العملات"
                required
                maxLength={80}
                value={s.name}
                onChange={e =>
                  setServices(
                    services.map((n, j) => (j === i ? { ...n, name: e.target.value } : n)),
                  )
                }
              />
            </label>
            <label>
              اسم الخدمة بالإنجليزية · اختياري
              <input
                aria-label="اسم الخدمة بالإنجليزية · اختياري"
                placeholder="e.g. Currency exchange"
                maxLength={80}
                dir="ltr"
                value={s.nameEn ?? ''}
                onChange={e =>
                  setServices(
                    services.map((n, j) =>
                      j === i ? { ...n, nameEn: e.target.value || undefined } : n,
                    ),
                  )
                }
              />
            </label>
            <label>
              بادئة الرقم
              <input
                aria-label="بادئة الرقم"
                aria-describedby={`prefix-help-${s.id}`}
                placeholder="مثال: A"
                title="استخدم حرفًا إلى ثلاثة أحرف إنجليزية، مثل A أو FX، دون أرقام أو مسافات."
                required
                pattern="[A-Z]{1,3}"
                maxLength={3}
                dir="ltr"
                value={s.prefix}
                disabled={queue.snapshot!.services.some(n => n.id === s.id)}
                onChange={e =>
                  setServices(
                    services.map((n, j) =>
                      j === i ? { ...n, prefix: e.target.value.toUpperCase() } : n,
                    ),
                  )
                }
              />
              <small id={`prefix-help-${s.id}`}>
                {queue.snapshot!.services.some(n => n.id === s.id) ? (
                  'ثابتة بعد الحفظ للحفاظ على أرقام التذاكر.'
                ) : (
                  <>
                    1–3 أحرف إنجليزية: <bdi dir="ltr">A → A-23</bdi>. اختر بادئة مختلفة لكل خدمة.
                  </>
                )}
              </small>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={s.active}
                onChange={e =>
                  setServices(
                    services.map((n, j) => (j === i ? { ...n, active: e.target.checked } : n)),
                  )
                }
              />
              مفعلة
            </label>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setServices([
              ...services,
              { id: crypto.randomUUID(), name: '', prefix: '', active: true },
            ])
          }
        >
          <Plus /> إضافة خدمة
        </button>
        <h2>الكاونترات والأجهزة</h2>
        <p>أنشئ الكاونترات وعدّلها وتحكم باستقبالها من لوحة الكاونترات.</p>
        <div className="row">
          <button type="button" onClick={onCounters}>
            فتح إدارة الكاونترات
          </button>
          <button
            className="primary"
            disabled={busy || !queue.online || !services.some(s => s.active)}
          >
            حفظ إعدادات الفرع
          </button>
        </div>
      </Form>
      <h2>إنشاء وربط الأجهزة</h2>
      <p>
        ثبّت التطبيق نفسه على جهاز الموظف أو الكشك أو الشاشة، ثم اختر الدور واستورد ملف الاقتران.
        الكشك يضبط طابعته من إعدادات الجهاز. شاشة العرض المتصلة بكمبيوتر المدير عبر HDMI يُدار من
        تبويب شاشات العرض.
      </p>
      <Form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const result = await window.queue.provision({
              role,
              counterId: (role === 'teller' || role === 'display') && counterId ? counterId : null,
              ...(name ? { name } : {}),
              ...(staffRef ? { staffRef } : {}),
            });
            setKey(result.token);
            await load();
          } catch (e) {
            setError(String((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="config-row">
          <label>
            نوع الجهاز
            <Select value={role} onChange={e => setRole(e.target.value as Role)}>
              <option value="teller">موظف كاونتر</option>
              <option value="kiosk">كشك التذاكر والطابعة</option>
              <option value="display">شاشة انتظار / شاشة كاونتر</option>
              <option value="manager">إدارة الفرع</option>
            </Select>
          </label>
          {(role === 'teller' || role === 'display') && (
            <label>
              الكاونتر
              <Select
                required={role === 'teller'}
                value={counterId}
                onChange={e => setCounterId(e.target.value)}
              >
                <option value="">{role === 'display' ? 'جميع الكاونترات' : 'اختر كاونتر'}</option>
                {queue.snapshot!.counters.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
        <div className="config-row">
          <label>
            اسم الموظف / الجهاز
            <input
              aria-label="اسم الموظف / الجهاز"
              placeholder={
                role === 'teller'
                  ? 'مثال: أحمد محمد'
                  : role === 'kiosk'
                    ? 'مثال: كشك المدخل'
                    : 'مثال: شاشة الانتظار'
              }
              required={role === 'teller'}
              value={name}
              maxLength={80}
              onChange={e => setName(e.target.value)}
            />
          </label>
          {role === 'teller' && (
            <label>
              معرّف الموظف
              <input
                aria-label="معرّف الموظف"
                aria-describedby="staff-ref-help"
                placeholder="مثال: EMP-001"
                required
                value={staffRef}
                maxLength={80}
                dir="ltr"
                onChange={e => setStaffRef(e.target.value)}
              />
              <small id="staff-ref-help">
                الرقم الوظيفي من سجل الموظفين، ويُستخدم لربط تقارير الأداء.
              </small>
            </label>
          )}
        </div>
        <button disabled={busy || !queue.online}>إصدار مفتاح جهاز</button>
      </Form>
      {key && (
        <div className="pairing">
          <strong>مفتاح الاقتران · احفظه في الجهاز المطلوب</strong>
          <textarea readOnly value={key} aria-label="مفتاح الجهاز الجديد" dir="ltr" />
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await window.queue.savePairing();
              } catch {
                setError('تعذر حفظ ملف الاقتران. اختر اسم ملف جديدًا.');
              } finally {
                setBusy(false);
              }
            }}
          >
            حفظ ملف الاقتران
          </button>
          <button onClick={() => setKey('')}>
            <Xmark /> إخفاء المفتاح
          </button>
        </div>
      )}
      <h2>الأجهزة المسندة</h2>
      <ul className="device-list">
        {devices.map(d => (
          <li key={d.id}>
            <span>
              {d.name ?? roleNames[d.role]} ·{' '}
              {queue.snapshot!.counters.find(c => c.id === d.counterId)?.name ??
                (d.counterId ? 'كاونتر مؤرشف' : 'الفرع')}
              <small>
                <span className="device-kind">{roleNames[d.role]}</span> · {d.staffRef ?? '—'} ·{' '}
                {d.enabled ? 'مفتاح مفعل' : 'مفتاح ملغى'}
              </small>
            </span>
            <button
              disabled={!d.enabled || d.id === queue.snapshot!.actor.id || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await window.queue.revoke(d.id);
                  await load();
                } catch (e) {
                  setError(String((e as Error).message));
                } finally {
                  setBusy(false);
                }
              }}
            >
              إلغاء المفتاح
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
