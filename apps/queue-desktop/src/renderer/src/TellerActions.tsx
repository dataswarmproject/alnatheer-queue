import {
  Refresh,
  ArrowRight,
  Pause,
  Play,
  UserXmark,
  SkipNext,
  Check,
  Star,
  StarSolid,
} from 'iconoir-react';
import type { QueueController } from './useQueue';

export function TellerActions({
  queue,
  onTransfer,
  onFavorites,
  mode,
}: {
  queue: QueueController;
  onTransfer: () => void;
  onFavorites?: () => void;
  mode: 'dock' | 'panel';
}) {
  const { snapshot, online, busy } = queue,
    ticket = snapshot?.current,
    paused = snapshot?.counter?.paused;
  const run = (action: 'recall' | 'pause' | 'resume' | 'no_show' | 'start' | 'complete' | 'next') =>
    void queue.action(action).catch(() => {});
  const favorite = ticket ? queue.favorites.includes(ticket.serviceId) : false;
  const actions = [
    {
      label: mode === 'dock' ? 'تكرار' : 'إعادة النداء',
      hint: 'إعادة نداء التذكرة الحالية',
      Icon: Refresh,
      tone: 'orange',
      blocked: !ticket || paused,
      click: () => run('recall'),
    },
    {
      label: mode === 'dock' ? 'تحويل' : 'تحويل الخدمة',
      hint: 'تحويل إلى خدمة أخرى',
      Icon: ArrowRight,
      tone: 'green',
      blocked: !ticket || paused,
      click: onTransfer,
    },
    {
      label: paused ? 'استئناف' : 'إيقاف',
      hint: paused ? 'استئناف الكاونتر' : 'إيقاف استقبال تذاكر جديدة',
      Icon: paused ? Play : Pause,
      tone: paused ? 'yellow' : 'neutral',
      blocked: !snapshot?.counter,
      click: () => run(paused ? 'resume' : 'pause'),
    },
    {
      label: mode === 'dock' ? 'غياب' : 'عدم الحضور',
      hint: 'العميل لم يحضر',
      Icon: UserXmark,
      tone: 'yellow',
      blocked: ticket?.status !== 'called' || !!ticket?.startedAt || paused,
      click: () => run('no_show'),
    },
    {
      label:
        ticket?.status === 'serving'
          ? mode === 'dock'
            ? 'إنهاء'
            : 'إنجاز الخدمة'
          : ticket
            ? mode === 'dock'
              ? 'خدمة'
              : 'بدء الخدمة'
            : mode === 'dock'
              ? 'التالي'
              : 'نداء التالي',
      hint:
        ticket?.status === 'serving'
          ? 'إنجاز الخدمة'
          : ticket
            ? 'بدء الخدمة'
            : mode === 'dock'
              ? 'نداء التذكرة التالية'
              : 'نداء التالي',
      Icon: ticket?.status === 'serving' ? Check : ticket ? Play : SkipNext,
      tone: 'green',
      blocked: (paused && ticket?.status !== 'serving') || (!ticket && !snapshot?.waiting.length),
      click: () => run(ticket?.status === 'serving' ? 'complete' : ticket ? 'start' : 'next'),
      primary: true,
    },
    {
      label: mode === 'dock' ? 'مفضلة' : 'الخدمات المفضلة',
      hint: 'الخدمات المفضلة',
      Icon: favorite ? StarSolid : Star,
      tone: 'yellow',
      blocked: false,
      click: () => {
        if (onFavorites) onFavorites();
        else if (ticket) void queue.toggleFavorite(ticket.serviceId);
        else void queue.expand(true);
      },
    },
  ];
  return (
    <div className={mode === 'dock' ? 'dock-actions' : 'teller-actions'}>
      {actions.map(({ label, hint, Icon, tone, blocked, click, ...rest }) => (
        <button
          key={hint}
          className={
            mode === 'dock'
              ? `dock-action ${tone}`
              : rest.primary
                ? 'teller-action primary'
                : 'teller-action'
          }
          aria-label={hint}
          title={hint}
          disabled={busy || !online || blocked}
          onClick={click}
        >
          <span className="icon-well">
            <Icon strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="action-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
