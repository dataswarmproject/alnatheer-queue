import { useEffect, useState } from 'react';
import { Collapse, Xmark } from 'iconoir-react';
import { useQueue } from './useQueue';
import { Dock } from './Dock';
import { Connect } from './Connect';
import { QueuePanel } from './QueuePanel';
import { Performance } from './Performance';
import { Management } from './Management';
import { Journey } from './Journey';
import { WaitingDisplay } from './WaitingDisplay';
import { TicketKiosk } from './TicketKiosk';
import { DeviceSettings } from './DeviceSettings';
import { ServerPanel } from './ServerPanel';
import { OperatorAccess } from './OperatorAccess';
import { HdmiPanel } from './HdmiPanel';
import { Announcements } from './Announcements';
import { CounterManagement } from './CounterManagement';
import { SaudiDate } from './SaudiDate';
import { UpdateFooter } from './UpdateFooter';

export function App() {
  const queue = useQueue(),
    [tab, setTab] = useState('queue'),
    [transfer, setTransfer] = useState(false);
  const [analysisCounterId, setAnalysisCounterId] = useState('');
  const [restoredScope, setRestoredScope] = useState<string | null>(null);
  const manager = queue.snapshot?.actor.role === 'manager',
    teller = queue.snapshot?.actor.role === 'teller';
  const scope =
    manager && queue.snapshot
      ? `manager-view:${queue.snapshot.branchId}:${queue.snapshot.actor.id}`
      : null;
  useEffect(() => {
    if (!scope) return;
    try {
      const saved = localStorage.getItem(scope);
      if (
        saved &&
        ['queue', 'counters', 'performance', 'journey', 'management', 'server', 'tv'].includes(
          saved,
        )
      )
        setTab(saved);
    } catch {}
    setRestoredScope(scope);
  }, [scope]);
  useEffect(() => {
    if (
      !scope ||
      scope !== restoredScope ||
      !['queue', 'counters', 'performance', 'journey', 'management', 'server', 'tv'].includes(tab)
    )
      return;
    try {
      localStorage.setItem(scope, tab);
    } catch {}
  }, [scope, restoredScope, tab]);
  useEffect(() => {
    if (queue.setupMode === 'hdmi') setTab('tv');
  }, [queue.setupMode]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target as Element).closest?.('select,[role="combobox"]'))
        return;
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === 's' &&
        queue.role === 'display' &&
        !queue.companion
      ) {
        event.preventDefault();
        setTab('operator');
      }
      if (event.key === 'Escape' && teller) {
        if (transfer) setTransfer(false);
        else void queue.expand(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [teller, transfer, queue.role, queue.companion]);
  if (!queue.connected)
    return <Connect onConnect={queue.connect} onConnected={queue.adoptConnection} />;
  if (tab === 'operator')
    return <OperatorAccess onClose={() => setTab('queue')} onUnlocked={() => setTab('device')} />;
  if (!queue.snapshot)
    return (
      <main className="panel setup">
        <h1>اتصال الفرع</h1>
        <p role="status">بانتظار اتصال خادم الفرع. ستُحمّل البيانات تلقائيًا عند عودة الاتصال.</p>
        <button onClick={() => void queue.refresh()}>إعادة المحاولة</button>
        <button
          onClick={() =>
            ['kiosk', 'display'].includes(queue.role ?? '')
              ? setTab('operator')
              : void queue.disconnect()
          }
        >
          تغيير الاتصال
        </button>
      </main>
    );
  if (teller && !queue.expanded)
    return (
      <Dock
        queue={queue}
        onTransfer={() => {
          setTransfer(true);
          void queue.expand(true);
        }}
      />
    );
  if (tab === 'device')
    return (
      <>
        {queue.role === 'display' && <Announcements snapshot={queue.snapshot!} />}
        <DeviceSettings
          audio={queue.role === 'display'}
          onClose={() => {
            void window.queue.lockOperator();
            setTab('queue');
          }}
          onDisconnect={() => void queue.disconnect()}
        />
      </>
    );
  if (queue.snapshot.actor.role === 'display') return <WaitingDisplay queue={queue} />;
  if (queue.snapshot.actor.role === 'kiosk')
    return <TicketKiosk queue={queue} onSettings={() => setTab('operator')} />;
  return (
    <main className={`panel ${queue.snapshot.actor.role}`}>
      <header>
        <img className="brand-logo" src="/icon.png" alt="النذير للصرافة" />
        <div>
          <strong>النذير · إدارة الانتظار</strong>
          <small>{queue.snapshot.counter?.name ?? (manager ? 'إدارة الفرع' : 'الكاونتر')}</small>
        </div>
        <SaudiDate />
        <div className="header-buttons">
          {teller && (
            <button
              aria-label="تصغير إلى الشريط"
              disabled={queue.busy}
              onClick={() => void queue.expand(false)}
            >
              <Collapse />
            </button>
          )}
          {!manager && (
            <button aria-label="إغلاق التطبيق" onClick={() => void window.queue.quit()}>
              <Xmark />
            </button>
          )}
        </div>
      </header>
      {(!teller || !queue.online) && (
        <div className="connection-status">
          <span className={queue.online ? 'ready' : 'offline'}>
            {queue.online ? 'خدمة الفرع متصلة' : 'انقطع اتصال خدمة الفرع — الإجراءات متوقفة'}
          </span>
          <span>
            {queue.snapshot.sync.configured
              ? `${queue.snapshot.sync.pending} حدث بانتظار المزامنة`
              : 'مزامنة المركز لم تُضبط'}
          </span>
        </div>
      )}
      {manager && (
        <nav aria-label="إدارة الفرع">
          <button
            aria-current={tab === 'counters' ? 'page' : undefined}
            onClick={() => setTab('counters')}
          >
            الكاونترات
          </button>
          <button
            aria-current={tab === 'queue' ? 'page' : undefined}
            onClick={() => setTab('queue')}
          >
            الانتظار
          </button>
          <button
            aria-current={tab === 'performance' ? 'page' : undefined}
            onClick={() => setTab('performance')}
          >
            الأداء والتقارير
          </button>
          <button
            aria-current={tab === 'journey' ? 'page' : undefined}
            onClick={() => setTab('journey')}
          >
            متابعة التذاكر
          </button>
          <button
            aria-current={tab === 'management' ? 'page' : undefined}
            onClick={() => setTab('management')}
          >
            الإعدادات
          </button>
          <button
            aria-current={tab === 'server' ? 'page' : undefined}
            onClick={() => setTab('server')}
          >
            إدارة النظام
          </button>
          <button aria-current={tab === 'tv' ? 'page' : undefined} onClick={() => setTab('tv')}>
            شاشات العرض
          </button>
        </nav>
      )}
      {queue.error && (
        <div className="error" role="alert">
          <p>{queue.error}</p>
          <button onClick={() => void queue.retry().catch(() => {})}>إعادة محاولة الطلب</button>
          <button onClick={() => queue.setError('')}>إغلاق</button>
        </div>
      )}
      <div className="panel-content">
        {tab === 'tv' && manager ? (
          <HdmiPanel />
        ) : tab === 'server' && manager ? (
          <ServerPanel />
        ) : tab === 'performance' && manager ? (
          <Performance initialCounterId={analysisCounterId} />
        ) : tab === 'journey' && manager ? (
          <Journey />
        ) : tab === 'management' && manager ? (
          <Management queue={queue} onCounters={() => setTab('counters')} />
        ) : tab === 'counters' && manager ? (
          <CounterManagement
            queue={queue}
            onAnalyze={id => {
              setAnalysisCounterId(id);
              setTab('performance');
            }}
          />
        ) : (
          <QueuePanel
            queue={queue}
            transfer={transfer}
            onTransfer={() => setTransfer(true)}
            onTransferred={() => setTransfer(false)}
          />
        )}
      </div>
      <footer>
        {manager && <UpdateFooter />}
        <span>
          {teller
            ? queue.online
              ? 'متصل بالفرع'
              : 'غير متصل'
            : `${queue.snapshot.services.length} خدمة · ${queue.snapshot.counters.length} كاونتر`}
        </span>
        <button onClick={() => setTab('device')}>إعدادات الجهاز</button>
      </footer>
    </main>
  );
}
