import { describe, it, expect } from 'vitest';
import { saudiDates } from '@saraf/queue-core/dates';
describe('dual Saudi calendars', () => {
  it('shows Gregorian and Umm al-Qura dates changing at Riyadh midnight', () => {
    const before = saudiDates(new Date('2026-10-13T20:59:59.000Z')),
      after = saudiDates(new Date('2026-10-13T21:00:00.000Z'));
    expect(before.hijri).not.toBe(after.hijri);
    expect(before.gregorian).not.toBe(after.gregorian);
    expect(after.hijri).toContain('١٤٤٨');
    expect(after.gregorian).toContain('٢٠٢٦');
  });
});
