import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { planLocalSpeech } from '../src/local-speech-plan';
import { checkLocalSpeechRelease } from '../src/local-speech-release';

it('requires the activation profile and the canonical full release coverage', async () => {
  const plan = JSON.parse(
    await readFile(new URL('../voice-plan-10x999.json', import.meta.url), 'utf8'),
  );
  const manifest = planLocalSpeech(plan);
  const profile = {
    version: 1,
    voiceId: manifest.voiceId,
    model: manifest.model,
    complete: true,
    recordings: 1010,
  };
  expect(checkLocalSpeechRelease(manifest, profile, plan).combinations).toBe(9990);
  for (const invalid of [
    undefined,
    { ...profile, complete: false },
    { ...profile, recordings: 1 },
    { ...profile, voiceId: 'another-voice' },
  ])
    expect(() => checkLocalSpeechRelease(manifest, invalid, plan)).toThrow('Activation profile');
  const reduced = planLocalSpeech({ ...plan, counters: ['كاونتر 1'] });
  expect(() =>
    checkLocalSpeechRelease(reduced, { ...profile, recordings: reduced.totalClips }, plan),
  ).toThrow('release recording plan');
});
