import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueController } from './useQueue';
import { Announcements, type CallPhase } from './Announcements';
import { SaudiDate } from './SaudiDate';

const MAX_VISIBLE_COUNTERS = 6;

export function WaitingDisplay({ queue }: { queue: QueueController }) {
  const snapshot = queue.snapshot!;
  const active = snapshot.active.filter(
    t => !snapshot.actor.counterId || t.counterId === snapshot.actor.counterId,
  );
  const current = [...snapshot.announcements]
    .reverse()
    .find(a => active.some(t => t.id === a.ticketId && t.counterId === a.counterId));
  const [visualCall, setVisualCall] = useState<number | null>(null);
  const [speakingCall, setSpeakingCall] = useState<number | null>(null);
  const [finishedCall, setFinishedCall] = useState<number | null>(null);
  const [preparingCall, setPreparingCall] = useState<number | null>(null);
  const speaking = useRef<number | null>(null),
    afterVoiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCall = useRef<number | null>(null);
  const currentStatus = active.find(ticket => ticket.id === current?.ticketId)?.status;
  const onCallingChange = useCallback((sequence: number | null, phase: CallPhase) => {
    if (afterVoiceTimer.current) clearTimeout(afterVoiceTimer.current);
    afterVoiceTimer.current = null;
    setPreparingCall(phase === 'preparing' ? sequence : null);
    if (phase === 'preparing') {
      setVisualCall(null);
      return;
    }
    if (phase === 'started') {
      speaking.current = sequence;
      setSpeakingCall(sequence);
      setFinishedCall(null);
    } else {
      setSpeakingCall(null);
      setVisualCall(null);
      if (phase === 'finished' && sequence !== null && speaking.current === sequence) {
        setFinishedCall(sequence);
        afterVoiceTimer.current = setTimeout(
          () => setFinishedCall(previous => (previous === sequence ? null : previous)),
          5000,
        );
      } else setFinishedCall(null);
      speaking.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      if (afterVoiceTimer.current) clearTimeout(afterVoiceTimer.current);
    },
    [],
  );
  useEffect(() => {
    setVisualCall(null);
    if (lastCall.current === null) {
      lastCall.current = snapshot.announcements.at(-1)?.sequence ?? 0;
      return;
    }
    if (!queue.online || !current) return;
    if (current.sequence <= lastCall.current) return;
    lastCall.current = current.sequence;
    setFinishedCall(null);
    if (afterVoiceTimer.current) clearTimeout(afterVoiceTimer.current);
    const age = Date.parse(snapshot.serverTime) - Date.parse(current.occurredAt);
    // Muted TVs still briefly draw attention to fresh calls; refreshes never extend it.
    if (age < 0 || age >= 5000) return;
    setVisualCall(current.sequence);
    const sequence = current.sequence;
    const timer = setTimeout(
      () => setVisualCall(previous => (previous === sequence ? null : previous)),
      5000 - age,
    );
    return () => clearTimeout(timer);
  }, [current?.sequence, currentStatus, queue.online]);
  const calling =
    queue.online &&
    !!current &&
    ((visualCall === current.sequence && preparingCall !== current.sequence) ||
      speakingCall === current.sequence ||
      finishedCall === current.sequence);
  const counters = [...snapshot.counters].sort((a, b) =>
    a.name.localeCompare(b.name, 'ar', { numeric: true }),
  );
  const visibleCounters = counters.slice(0, MAX_VISIBLE_COUNTERS);
  return (
    <main className="customer-screen tv-screen" dir="rtl">
      <header className="customer-header">
        <img src="/icon.png" className="customer-logo" alt="النذير للصرافة" />
        <div>
          <strong>النذير للصرافة</strong>
          <span>Alnatheer Exchange</span>
        </div>
        <SaudiDate />
      </header>
      {!queue.online && (
        <div role="alert" className="connection-warning">
          انقطع اتصال الفرع · الأرقام المعروضة قديمة حتى عودة الاتصال
        </div>
      )}
      <div className={`tv-body ${snapshot.actor.counterId ? 'tv-single-counter' : ''}`}>
        <section
          className={`tv-current ${calling ? 'tv-current-called' : ''}`}
          aria-live="polite"
          key={current?.sequence ?? 'idle'}
        >
          <span>{current ? 'يرجى التوجه إلى الكاونتر' : 'أهلًا بكم'}</span>
          <strong className="tv-ticket" dir="ltr">
            {current?.code ?? '—'}
          </strong>
          <div className="tv-counter">{current?.counterName ?? 'بانتظار النداء التالي'}</div>
          <p>يرجى تجهيز تذكرتك عند النداء</p>
        </section>
        {!snapshot.actor.counterId && (
          <section className="tv-other">
            <div className="tv-board-heading">
              <h2>الكاونترات · الأرقام الحالية</h2>
            </div>
            {visibleCounters.length ? (
              <div className="tv-counters">
                {visibleCounters.map(counter => {
                  const ticket = active.find(t => t.counterId === counter.id);
                  return (
                    <article
                      key={counter.id}
                      data-counter-id={counter.id}
                      className={`${ticket ? 'tv-counter-active' : 'tv-counter-idle'} ${current?.counterId === counter.id ? 'tv-counter-latest' : ''}`}
                    >
                      <span>{counter.name}</span>
                      <strong dir="ltr">{ticket?.code ?? '—'}</strong>
                      <small>
                        {ticket
                          ? ticket.status === 'serving'
                            ? 'في الخدمة'
                            : 'تم النداء'
                          : counter.paused
                            ? 'متوقف مؤقتًا'
                            : 'متاح'}
                      </small>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="customer-empty">لم تُضبط الكاونترات بعد.</p>
            )}
          </section>
        )}
      </div>
      <Announcements snapshot={snapshot} onCallingChange={onCallingChange} />
    </main>
  );
}
