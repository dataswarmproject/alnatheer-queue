import { it, expect } from 'vitest';
import { planSpeech } from '../src/speech-plan';
import { announcementParts } from '@saraf/queue-core/speech';
it('prepares every prefix, number and destination once without customer data or dates', () => {
  const clips = planSpeech({
    prefixes: ['A', 'B', 'A'],
    counters: ['كاونتر ٣', 'Counter 3', 'كاونتر 4'],
    start: 23,
    end: 24,
  });
  expect(clips).toHaveLength(8);
  expect(clips.some(x => x.text.includes('بي، أربعة وعشرين') && x.text.includes('رقم أربعة'))).toBe(
    true,
  );
  expect(
    clips.some(x => x.text.includes('A... ثلاثة وعشرين') && x.text.includes('رقم ثلاثة')),
  ).toBe(true);
});
it('rejects enormous and reversed batches before creating any speech', () => {
  expect(() =>
    planSpeech({ prefixes: ['A', 'B'], counters: ['1', '2'], start: 1, end: 9999 }),
  ).toThrow();
  expect(() => planSpeech({ prefixes: ['A'], counters: ['1'], start: 24, end: 23 })).toThrow();
});
it('covers 10 counters and tickets 1-999 with 1009 complete phrase segments', () => {
  const clips = planSpeech({
    mode: 'split',
    prefixes: ['A'],
    counters: Array.from({ length: 10 }, (_, i) => `كاونتر ${i + 1}`),
    start: 1,
    end: 999,
  });
  expect(clips).toHaveLength(1009);
  expect(clips.filter(x => x.text.startsWith('على صاحب التذكرة رقم'))).toHaveLength(999);
  expect(clips.filter(x => x.text.startsWith('التوجّه'))).toHaveLength(10);
  expect(clips.some(x => x.text === 'على صاحب التذكرة رقم A... تسعمائة وتسعة وتسعين،')).toBe(true);
  const saved = new Set(clips.map(clip => clip.text));
  // Every whole-call combination can be served using only the 1009 prepared recordings.
  const complete = planSpeech({
    prefixes: ['A'],
    counters: Array.from({ length: 10 }, (_, i) => `كاونتر ${i + 1}`),
    start: 1,
    end: 999,
  });
  expect(complete).toHaveLength(9990);
  for (const call of complete) {
    const parts = announcementParts(call);
    expect(parts.every(part => saved.has(part))).toBe(true);
    expect(parts.join(' ')).toBe(call.text);
  }
});
