import { Expand } from 'iconoir-react';
import { TellerActions } from './TellerActions';
import type { QueueController } from './useQueue';

export function Dock({ queue, onTransfer }: { queue: QueueController; onTransfer: () => void }) {
  const { snapshot, online } = queue;
  const ticket = snapshot?.current,
    paused = snapshot?.counter?.paused;
  const status = !online
    ? 'غير متصل'
    : paused
      ? 'متوقف مؤقتًا'
      : ticket?.status === 'serving'
        ? 'في الخدمة'
        : ticket
          ? 'بانتظار العميل'
          : 'جاهز';
  return (
    <div
      className="dock-shell"
      onMouseMove={event =>
        window.queue.pointer(!!(event.target as Element).closest('button,.dock-rail'))
      }
      onMouseLeave={() => window.queue.pointer(false)}
    >
      <aside className="dock-rail" aria-label="أدوات الكاونتر">
        <div className="ticket-head" aria-live="polite">
          <span>الرقم الحالي</span>
          <strong dir="ltr">{ticket?.code ?? '—'}</strong>
          <small className={!online ? 'offline' : paused ? 'paused' : 'ready'}>{status}</small>
        </div>
        <TellerActions queue={queue} onTransfer={onTransfer} mode="dock" />
      </aside>
      <button
        className="expand-button"
        aria-label="توسيع عرض قائمة الانتظار"
        title="توسيع العرض"
        disabled={queue.busy}
        onClick={() => void queue.expand(true)}
      >
        <Expand aria-hidden="true" />
      </button>
    </div>
  );
}
