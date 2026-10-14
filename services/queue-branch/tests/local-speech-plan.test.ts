import { expect, it } from 'vitest';
import { planLocalSpeech, localVoiceId, localVoiceModel } from '../src/local-speech-plan';
import { announcementText } from '@saraf/queue-core/speech';
import { speechCacheKey } from '../src/speech';
it('prepares an independent free voice library for 999 tickets and 10 counters with the approved clear A', () => {
  const manifest = planLocalSpeech({
    mode: 'split',
    prefixes: ['A'],
    start: 1,
    end: 999,
    counters: Array.from({ length: 10 }, (_, i) => `كاونتر ${i + 1}`),
  });
  expect(manifest.totalClips).toBe(1010);
  expect(manifest.combinations).toBe(9990);
  expect(manifest.samples[1].text).toBe(
    'على صاحب التذكرة رقم A... ثلاثة وعشرين، التوجّه إلى الكاونتر رقم ثلاثة.',
  );
  const sample = manifest.samples[3];
  expect(sample.key).toBe(speechCacheKey(localVoiceId, localVoiceModel, announcementText(sample)));
  expect(manifest.entries.filter(x => x.code === 'DESTINATION')).toHaveLength(10);
  expect(new Set(manifest.entries.map(x => x.key)).size).toBe(1010);
  expect(JSON.stringify(manifest)).not.toContain('apiKey');
});
it('does not silently multiply the local generation workload into full recordings', () => {
  expect(() =>
    planLocalSpeech({ mode: 'full', prefixes: ['A'], start: 1, end: 999, counters: ['1'] }),
  ).toThrow('split');
});
