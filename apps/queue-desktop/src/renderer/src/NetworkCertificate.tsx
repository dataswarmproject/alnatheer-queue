import { Select } from './Select';

export function NetworkCertificate({
  mode,
  onMode,
  cert,
  keyFile,
  pick,
  busy,
}: {
  mode: 'automatic' | 'manual';
  onMode: (mode: 'automatic' | 'manual') => void;
  cert: string;
  keyFile: string;
  pick: (kind: 'cert' | 'key') => void;
  busy: boolean;
}) {
  return (
    <>
      <label>
        شهادة اتصال الشبكة
        <Select
          aria-label="طريقة إعداد الشهادة"
          value={mode}
          disabled={busy}
          onChange={event => onMode(event.target.value as 'automatic' | 'manual')}
        >
          <option value="automatic">إنشاء تلقائي · مجاني</option>
          <option value="manual">استخدام شهادة الشركة</option>
        </Select>
      </label>
      {mode === 'automatic' ? (
        <p>
          يُنشئ الخادم شهادة الفرع ويحفظ مفتاحها بأمان. استورد ملف الاقتران على الأجهزة لإتمام
          الاتصال، دون تثبيت شهادات في Windows.
        </p>
      ) : (
        <>
          <label>
            ملف شهادة الشبكة
            <span className="path-picker">
              <input
                aria-label="شهادة اتصال الشبكة"
                value={cert}
                readOnly
                required
                dir="ltr"
                placeholder="ملف PEM أو CRT"
              />
              <button type="button" disabled={busy} onClick={() => pick('cert')}>
                اختيار الشهادة
              </button>
            </span>
          </label>
          <label>
            مفتاح شهادة الشبكة
            <span className="path-picker">
              <input
                aria-label="مفتاح شهادة الشبكة"
                value={keyFile}
                readOnly
                required
                dir="ltr"
                placeholder="ملف المفتاح الخاص"
              />
              <button type="button" disabled={busy} onClick={() => pick('key')}>
                اختيار مفتاح الشهادة
              </button>
            </span>
          </label>
        </>
      )}
    </>
  );
}
