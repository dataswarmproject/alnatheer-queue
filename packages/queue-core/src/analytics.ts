import type { Counter, QueueEvent, Service, Ticket } from './index';

export type StaffAssignment = {
  id: string;
  name: string | null;
  staffRef: string | null;
  counterId: string | null;
};
type Leg = {
  ticketId: string;
  counterId: string;
  actorId: string;
  serviceId: string;
  from: number;
  to: number;
  complete: boolean;
};
type Counts = {
  calls: number;
  recalls: number;
  transfers: number;
  noShows: number;
  completed: number;
  starts: number;
};
const counts = (): Counts => ({
  calls: 0,
  recalls: 0,
  transfers: 0,
  noShows: 0,
  completed: 0,
  starts: 0,
});
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    position = (sorted.length - 1) * fraction;
  return (
    sorted[Math.floor(position)] +
    (sorted[Math.ceil(position)] - sorted[Math.floor(position)]) * (position % 1)
  );
}
const seconds = (from: number, to: number) => Math.max(0, (to - from) / 1000);

export function analyzeQueue(
  events: QueueEvent[],
  options: {
    from: string;
    to: string;
    counters: Counter[];
    services: Service[];
    openingCounters: Counter[];
    openingTickets?: Ticket[];
    openingLegs?: QueueEvent[];
    staff: StaffAssignment[];
    partial: boolean;
    slaSeconds?: number;
  },
) {
  const from = Date.parse(options.from),
    to = Date.parse(options.to);
  const tickets = new Map((options.openingTickets ?? []).map(t => [t.id, t]));
  const firstStarted = new Set(
    (options.openingTickets ?? []).filter(t => t.startedAt).map(t => t.id),
  );
  const active = new Map<string, Omit<Leg, 'to' | 'complete'>>();
  for (const event of options.openingLegs ?? []) {
    const ticket = event.payload.ticket;
    if (ticket?.counterId)
      active.set(ticket.id, {
        ticketId: ticket.id,
        counterId: ticket.counterId,
        actorId: event.actorId,
        serviceId: ticket.serviceId,
        from: Date.parse(event.occurredAt),
      });
  }
  const legs: Leg[] = [],
    waits: number[] = [],
    callDelays: number[] = [];
  const byActor = new Map<string, Counts>();
  const byService = new Map<string, Counts>();
  const byCounter = new Map<string, Counts>();
  const counterWaits = new Map<string, number[]>();
  const hourly = new Map<string, number>();
  const availability = new Map<
    string,
    {
      since: number;
      knownFrom: number;
      paused: boolean;
      windows: [number, number][];
      known: boolean;
    }
  >();
  for (const c of options.counters) {
    const initial = options.openingCounters.find(o => o.id === c.id);
    availability.set(c.id, {
      since: from,
      knownFrom: initial ? from : to,
      paused: initial?.paused ?? true,
      windows: [],
      known: !!initial,
    });
  }
  const actorCounts = (id: string) => {
    if (!byActor.has(id)) byActor.set(id, counts());
    return byActor.get(id)!;
  };
  const serviceCounts = (id: string) => {
    if (!byService.has(id)) byService.set(id, counts());
    return byService.get(id)!;
  };
  const counterCounts = (id: string) => {
    if (!byCounter.has(id)) byCounter.set(id, counts());
    return byCounter.get(id)!;
  };
  const closeLeg = (ticketId: string, at: number, complete: boolean) => {
    const leg = active.get(ticketId);
    if (leg) {
      legs.push({ ...leg, to: at, complete });
      active.delete(ticketId);
    }
  };
  const changeAvailability = (counter: Counter, at: number) => {
    const state = availability.get(counter.id) ?? {
      since: at,
      knownFrom: at,
      paused: true,
      windows: [] as [number, number][],
      known: false,
    };
    if (!state.known) state.knownFrom = at;
    if (state.known && !state.paused) state.windows.push([state.since, at]);
    state.since = at;
    state.paused = counter.paused;
    state.known = true;
    availability.set(counter.id, state);
  };
  let arrivals = 0,
    completed = 0,
    noShows = 0,
    transfers = 0,
    recalls = 0,
    missingLegStarts = 0;
  for (const event of events) {
    const at = Date.parse(event.occurredAt);
    if (at < from || at >= to) continue;
    if (event.kind === 'configuration')
      for (const counter of event.payload.configuration?.counters ?? [])
        changeAvailability(counter, at);
    if (event.kind === 'pause' || event.kind === 'resume')
      changeAvailability(event.payload.counter!, at);
    const ticket = event.payload.ticket;
    if (!ticket) continue;
    const prior = tickets.get(ticket.id);
    tickets.set(ticket.id, ticket);
    const actor = actorCounts(event.actorId),
      service = serviceCounts(ticket.serviceId);
    const counterId = event.payload.counter?.id ?? ticket.counterId ?? prior?.counterId;
    const counter = counterId ? counterCounts(counterId) : undefined;
    if (counter && event.kind !== 'issue') {
      const fields: Partial<Record<QueueEvent['kind'], keyof Counts>> = {
        next: 'calls',
        recall: 'recalls',
        start: 'starts',
        complete: 'completed',
        no_show: 'noShows',
        transfer: 'transfers',
      };
      const field = fields[event.kind];
      if (field) counter[field]++;
    }
    switch (event.kind) {
      case 'issue': {
        arrivals++;
        const key = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Riyadh',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(at));
        hourly.set(key, (hourly.get(key) ?? 0) + 1);
        break;
      }
      case 'next':
        actor.calls++;
        service.calls++;
        break;
      case 'recall':
        actor.recalls++;
        service.recalls++;
        recalls++;
        break;
      case 'start': {
        actor.starts++;
        service.starts++;
        if (!firstStarted.has(ticket.id)) {
          waits.push(seconds(Date.parse(ticket.issuedAt), at));
          if (counterId) {
            if (!counterWaits.has(counterId)) counterWaits.set(counterId, []);
            counterWaits.get(counterId)!.push(seconds(Date.parse(ticket.issuedAt), at));
          }
          if (ticket.calledAt) callDelays.push(seconds(Date.parse(ticket.calledAt), at));
          firstStarted.add(ticket.id);
        }
        if (ticket.counterId)
          active.set(ticket.id, {
            ticketId: ticket.id,
            counterId: ticket.counterId,
            actorId: event.actorId,
            serviceId: ticket.serviceId,
            from: at,
          });
        break;
      }
      case 'transfer':
        closeLeg(ticket.id, at, false);
        actor.transfers++;
        transfers++;
        serviceCounts(prior?.serviceId ?? ticket.originalServiceId).transfers++;
        break;
      case 'complete':
        if (!active.has(ticket.id)) missingLegStarts++;
        closeLeg(ticket.id, at, true);
        actor.completed++;
        service.completed++;
        completed++;
        break;
      case 'no_show':
        actor.noShows++;
        service.noShows++;
        noShows++;
        break;
    }
  }
  for (const [ticketId] of Array.from(active)) closeLeg(ticketId, to, false);
  for (const state of Array.from(availability.values()))
    if (state.known && !state.paused) state.windows.push([state.since, to]);
  const counterRows = options.counters.map(counter => {
    const state = availability.get(counter.id)!;
    const availableMilliseconds = state.windows.reduce(
      (sum, [a, b]) => sum + Math.max(0, b - a),
      0,
    );
    const availableSeconds = availableMilliseconds / 1000;
    const busySeconds = legs
      .filter(l => l.counterId === counter.id)
      .reduce(
        (sum, l) =>
          sum +
          state.windows.reduce(
            (s, [a, b]) => s + seconds(Math.max(a, l.from), Math.min(b, l.to)),
            0,
          ),
        0,
      );
    const completedLegs = legs.filter(l => l.counterId === counter.id && l.complete);
    const durations = completedLegs.map(l => seconds(l.from, l.to));
    const ownWaits = counterWaits.get(counter.id) ?? [];
    return {
      id: counter.id,
      name: counter.name,
      archived: !!counter.archived,
      ...(byCounter.get(counter.id) ?? counts()),
      availableSeconds,
      pausedSeconds: state.known
        ? Math.max(0, to - state.knownFrom - availableMilliseconds) / 1000
        : null,
      unknownSeconds: seconds(from, state.knownFrom),
      busySeconds,
      utilization: availableSeconds ? busySeconds / availableSeconds : null,
      completed: byCounter.get(counter.id)?.completed ?? 0,
      coverageKnown: state.knownFrom === from,
      meanServiceSeconds: mean(durations),
      p90ServiceSeconds: percentile(durations, 0.9),
      sampleSize: durations.length,
      meanWaitSeconds: mean(ownWaits),
      p90WaitSeconds: percentile(ownWaits, 0.9),
      waitSampleSize: ownWaits.length,
      services: Array.from(new Set(completedLegs.map(l => l.serviceId))).map(serviceId => ({
        id: serviceId,
        name: options.services.find(s => s.id === serviceId)?.name ?? serviceId,
        completed: completedLegs.filter(l => l.serviceId === serviceId).length,
        meanServiceSeconds: mean(
          completedLegs.filter(l => l.serviceId === serviceId).map(l => seconds(l.from, l.to)),
        ),
      })),
    };
  });
  for (const leg of legs) actorCounts(leg.actorId);
  const tellerRows = Array.from(byActor)
    .filter(
      ([actorId, value]) =>
        value.calls ||
        value.starts ||
        value.completed ||
        value.recalls ||
        value.noShows ||
        value.transfers ||
        legs.some(l => l.actorId === actorId),
    )
    .map(([actorId, value]) => {
      const observed = [...events, ...(options.openingLegs ?? [])].find(
        e => e.actorId === actorId,
      )?.actor;
      const assignment =
        options.staff.find(s => s.id === actorId) ??
        (observed ? { id: actorId, ...observed } : undefined);
      const ownLegs = legs.filter(l => l.actorId === actorId),
        durations = ownLegs.filter(l => l.complete).map(l => seconds(l.from, l.to));
      const counterId =
        assignment?.counterId ??
        ownLegs[0]?.counterId ??
        events.find(e => e.actorId === actorId && e.payload.counter)?.payload.counter?.id;
      const counter = counterRows.find(c => c.id === counterId);
      return {
        actorId,
        name: assignment?.name ?? (observed?.role === 'manager' ? 'إدارة الفرع' : 'موظف غير مسمى'),
        staffRef: assignment?.staffRef ?? null,
        counter: counter?.name ?? null,
        ...value,
        serviceSeconds: ownLegs.reduce((sum, l) => sum + seconds(Math.max(from, l.from), l.to), 0),
        meanServiceSeconds: mean(durations),
        p90ServiceSeconds: percentile(durations, 0.9),
        sampleSize: durations.length,
        utilization: counter?.utilization ?? null,
        services: Array.from(new Set(ownLegs.map(l => l.serviceId))).map(serviceId => ({
          serviceId,
          name: options.services.find(s => s.id === serviceId)?.name ?? serviceId,
          completed: ownLegs.filter(l => l.serviceId === serviceId && l.complete).length,
          meanServiceSeconds: mean(
            ownLegs
              .filter(l => l.serviceId === serviceId && l.complete)
              .map(l => seconds(l.from, l.to)),
          ),
        })),
      };
    });
  const openTickets = Array.from(tickets.values()).filter(t =>
    ['waiting', 'called', 'serving'].includes(t.status),
  );
  const waitingAges = openTickets
    .filter(t => t.status === 'waiting')
    .map(t => seconds(Date.parse(t.queuedAt), to));
  const summary = {
    arrivals,
    completed,
    noShows,
    transfers,
    recalls,
    open: openTickets.length,
    meanWaitSeconds: mean(waits),
    p90WaitSeconds: percentile(waits, 0.9),
    waitSampleSize: waits.length,
    meanCallResponseSeconds: mean(callDelays),
    completionRate: completed + noShows ? completed / (completed + noShows) : null,
    noShowRate: completed + noShows ? noShows / (completed + noShows) : null,
    oldestWaitingSeconds: waitingAges.length ? Math.max(...waitingAges) : null,
    slaSeconds: options.slaSeconds ?? null,
    slaMetRate:
      options.slaSeconds != null && waits.length
        ? waits.filter(w => w <= options.slaSeconds!).length / waits.length
        : null,
    overdueWaiting:
      options.slaSeconds != null ? waitingAges.filter(w => w > options.slaSeconds!).length : null,
  };
  const serviceRows = options.services.map(s => ({
    id: s.id,
    name: s.name,
    ...(byService.get(s.id) ?? counts()),
    meanServiceSeconds: mean(
      legs.filter(l => l.serviceId === s.id && l.complete).map(l => seconds(l.from, l.to)),
    ),
  }));
  const insights: { title: string; detail: string }[] = [];
  if (!events.length)
    insights.push({
      title: 'لا توجد بيانات للفترة',
      detail: 'تظهر التحليلات بعد تسجيل عمليات فعلية في الفرع.',
    });
  if (noShows)
    insights.push({
      title: 'تذاكر لم تحضر',
      detail: `${noShows} تذكرة أُغلقت لعدم الحضور. راجع وضوح النداء وزمن الاستجابة قبل تفسيرها كضعف أداء للموظف.`,
    });
  if (transfers)
    insights.push({
      title: 'تحويلات بين الخدمات',
      detail: `${transfers} عملية تحويل. افحص اختيار الخدمة في جهاز التذاكر وتوزيع مهارات الكاونترات.`,
    });
  const peak = Array.from(hourly).sort((a, b) => b[1] - a[1])[0];
  if (peak)
    insights.push({
      title: 'ذروة الوصول',
      detail: `${peak[0]} بتوقيت الرياض: ${peak[1]} تذكرة جديدة. قارنها بساعات توفر الكاونترات لتخطيط المناوبات.`,
    });
  if (waitingAges.length)
    insights.push({
      title: 'قائمة الانتظار المفتوحة',
      detail: `${waitingAges.length} عميل ينتظر؛ أقدم انتظار ${Math.round(Math.max(...waitingAges) / 60)} دقيقة.`,
    });
  if (tellerRows.some(t => t.sampleSize < 10))
    insights.push({
      title: 'المقارنة تحتاج عينة أكبر',
      detail: 'تظهر أحجام العينات ومزيج الخدمات؛ السرعة وحدها ليست قياسًا لجودة الموظف.',
    });
  if (tellerRows.some(t => !t.staffRef))
    insights.push({
      title: 'إسناد الموظفين غير مكتمل',
      detail:
        'اربط جهاز كل كاونتر بمعرّف الموظف. هذه النتائج تقيس الجهاز أو الكاونتر عند غياب إسناد موثوق.',
    });
  if (options.partial || missingLegStarts)
    insights.push({
      title: 'حدود تغطية الفترة',
      detail:
        'توجد بيانات مقتطعة أو خدمات بدأت قبل بداية الفترة. لا تُستخدم النتائج الجزئية لترتيب الموظفين.',
    });
  return {
    from: options.from,
    to: options.to,
    timezone: 'Asia/Riyadh',
    summary,
    tellers: tellerRows,
    counters: counterRows,
    services: serviceRows,
    hourly: Array.from(hourly).map(([hour, arrivals]) => ({ hour, arrivals })),
    insights,
    coverage: {
      partial: options.partial,
      events: events.length,
      missingLegStarts,
      unassignedTellers: tellerRows.filter(t => !t.staffRef).length,
    },
    definitions: {
      wait: 'وقت إصدار التذكرة حتى أول بدء خدمة؛ العينة هي العملاء الذين بدأوا الخدمة خلال الفترة.',
      service:
        'مدة مقطع الخدمة المسجل من بدء الخدمة إلى الإنجاز؛ التحويل ينهي المقطع، ولا يحتسب كإنجاز.',
      completion:
        'الزيارات المنجزة ÷ (الزيارات المنجزة + عدم الحضور) خلال الفترة؛ التذاكر المفتوحة معروضة منفصلة.',
      utilization:
        'وقت الخدمة المتقاطع مع وقت إتاحة الكاونتر ÷ وقت إتاحته؛ هذا مقياس للكاونتر لا للحضور الوظيفي.',
      attribution:
        'إسناد الجهاز إلى الموظف يحتاج تحديثًا عند كل تغيير مناوبة. جودة الخدمة والإيرادات تحتاج ربطًا منفصلًا موثوقًا.',
    },
  };
}
export type QueueAnalytics = ReturnType<typeof analyzeQueue>;
