import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { analyzeQueue } from '@saraf/queue-core/analytics';
import { analyticsSchema } from '@saraf/queue-core/analytics-contract';
import type { QueueEvent, Ticket, Counter } from '@saraf/queue-core';

describe('performance evidence, not a fastest-teller leaderboard', () => {
  const from = '2026-10-13T06:00:00.000Z',
    to = '2026-10-13T07:00:00.000Z';
  const branchId = randomUUID(),
    serviceId = randomUUID(),
    actorId = randomUUID();
  const counter: Counter = {
    id: randomUUID(),
    name: '١',
    serviceIds: [serviceId],
    paused: false,
    revision: 0,
  };
  const base: Ticket = {
    id: randomUUID(),
    code: 'A-001',
    serviceId,
    originalServiceId: serviceId,
    counterId: counter.id,
    status: 'waiting',
    issuedAt: from,
    queuedAt: from,
    calledAt: null,
    startedAt: null,
    completedAt: null,
  };
  const ev = (
    kind: QueueEvent['kind'],
    minute: number,
    ticket: Ticket | null,
    counterBody = counter,
  ): QueueEvent => ({
    id: randomUUID(),
    branchId,
    actorId,
    actor: { role: 'teller', counterId: counter.id, name: null, staffRef: null },
    sequence: minute + 1,
    kind,
    occurredAt: new Date(Date.parse(from) + minute * 60000).toISOString(),
    payload: { ticket, counter: counterBody, configuration: null },
  });
  it('accepts an unpaused counter with subsecond availability boundaries', () => {
    const report = analyzeQueue([{ ...ev('resume', 100 / 60000, null), sequence: 1 }], {
      from,
      to: new Date(Date.parse(from) + 300).toISOString(),
      counters: [counter],
      services: [],
      openingCounters: [counter],
      staff: [],
      partial: false,
    });
    expect(report.counters[0].availableSeconds).toBe(0.3);
    expect(report.counters[0].pausedSeconds).toBe(0);
    expect(() => analyticsSchema.parse(report)).not.toThrow();
  });
  it('keeps full utilization at one across subsecond availability boundaries', () => {
    const report = analyzeQueue(
      [
        { ...ev('start', 0, { ...base, status: 'serving', startedAt: from }), sequence: 1 },
        { ...ev('resume', 100 / 60000, null), sequence: 2 },
      ],
      {
        from,
        to: new Date(Date.parse(from) + 300).toISOString(),
        counters: [counter],
        services: [],
        openingCounters: [counter],
        staff: [],
        partial: false,
      },
    );
    expect(report.counters[0].utilization).toBe(1);
    expect(() => analyticsSchema.parse(report)).not.toThrow();
  });
  it('measures wait to first start and separate service duration, not recall timestamps', () => {
    const events = [
      ev('issue', 0, base),
      ev('next', 2, { ...base, status: 'called' }),
      ev('recall', 3, { ...base, status: 'called' }),
      ev('start', 5, { ...base, status: 'serving' }),
      ev('complete', 15, { ...base, status: 'completed' }),
    ];
    const report = analyzeQueue(events, {
      from,
      to,
      counters: [counter],
      services: [{ id: serviceId, name: 'الصرافة', prefix: 'A', active: true }],
      openingCounters: [counter],
      partial: false,
      staff: [],
    });
    expect(report.summary.meanWaitSeconds).toBe(300);
    expect(report.summary.p90WaitSeconds).toBe(300);
    expect(report.tellers[0].meanServiceSeconds).toBe(600);
    expect(report.tellers[0].recalls).toBe(1);
    expect(report.summary.completed).toBe(1);
    expect(report.summary.completionRate).toBe(1);
    expect(report.tellers[0].utilization).toBeCloseTo(600 / 3600);
  });
  it('exposes pause duration, open tickets, missing identity and incomplete evidence', () => {
    const report = analyzeQueue(
      [
        ev('issue', 0, base),
        ev('pause', 10, null, { ...counter, paused: true }),
        ev('resume', 20, null, counter),
      ],
      {
        from,
        to,
        counters: [counter],
        services: [],
        openingCounters: [counter],
        partial: true,
        staff: [],
      },
    );
    expect(report.counters[0].pausedSeconds).toBe(600);
    expect(report.summary.open).toBe(1);
    expect(report.summary.meanWaitSeconds).toBeNull();
    expect(report.coverage.partial).toBe(true);
    expect(report.insights.length).toBeGreaterThan(0);
  });
});
