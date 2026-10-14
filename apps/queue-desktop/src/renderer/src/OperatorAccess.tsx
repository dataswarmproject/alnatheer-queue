import { useState } from 'react';
import { Form } from './Form';
export function OperatorAccess({
  onClose,
  onUnlocked,
}: {
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <main className="panel device-settings setup">
      <h1>إعدادات المشرف</h1>
      <p>أدخل مفتاح مدير الفرع لفتح إعدادات هذا الجهاز مؤقتًا.</p>
      <Form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await window.queue.unlockOperator(key);
            setKey('');
            onUnlocked();
          } catch {
            setKey('');
            setError('تعذر التحقق من صلاحية المشرف. تحقق من المفتاح واتصال الفرع.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          مفتاح مدير الفرع
          <input
            type="password"
            placeholder="الصق مفتاح مدير الفرع"
            dir="ltr"
            pattern="[a-f0-9]{64}"
            title="الصق مفتاح مدير الفرع كاملًا: 64 حرفًا ورقمًا."
            autoComplete="off"
            value={key}
            onChange={e => setKey(e.target.value)}
            maxLength={64}
            required
            disabled={busy}
          />
        </label>
        <button className="primary" disabled={busy}>
          فتح إعدادات المشرف
        </button>
      </Form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button onClick={onClose} disabled={busy}>
        العودة إلى الشاشة
      </button>
    </main>
  );
}
