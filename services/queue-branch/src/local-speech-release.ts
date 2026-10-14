import assert from 'node:assert/strict';
import { planLocalSpeech } from './local-speech-plan';

export function checkLocalSpeechRelease(manifest: unknown, profile: unknown, releasePlan: unknown) {
  const expected = planLocalSpeech(releasePlan);
  assert.deepEqual(manifest, expected, 'Manifest must match the release recording plan');
  assert.deepEqual(
    profile,
    {
      version: 1,
      voiceId: expected.voiceId,
      model: expected.model,
      complete: true,
      recordings: expected.totalClips,
    },
    'Activation profile must match the completed library',
  );
  return expected;
}
