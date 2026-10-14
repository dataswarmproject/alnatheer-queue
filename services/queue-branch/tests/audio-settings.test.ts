import { it, expect } from 'vitest';
import {
  audioSettingsSchema,
  defaultAudioSettings,
  effectiveAudioSettings,
} from '../../../apps/queue-desktop/src/audio-contract';
it('migrates legacy saved settings without unmuting a disabled display and retains independent channel choices', () => {
  const legacy = { enabled: false, mode: 'auto', voiceURI: '', volume: 0.7 };
  expect(audioSettingsSchema.parse(legacy)).toEqual({
    ...legacy,
    voiceEnabled: false,
    alertEnabled: true,
  });
  for (const [voiceEnabled, alertEnabled] of [
    [true, false],
    [false, true],
    [true, true],
    [false, false],
  ]) {
    const saved = { ...legacy, enabled: true, voiceEnabled, alertEnabled };
    expect(audioSettingsSchema.parse(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  }
});
it('starts new displays with voice off and alert sound on until voice quality is approved', () => {
  expect(defaultAudioSettings.voiceEnabled).toBe(false);
  expect(defaultAudioSettings.alertEnabled).toBe(true);
  expect(defaultAudioSettings.enabled).toBe(true);
});
it('keeps speech disabled for saved and attempted enabled settings without changing alert or volume', () => {
  for (const alertEnabled of [true, false]) {
    const saved = { ...defaultAudioSettings, voiceEnabled: true, alertEnabled, volume: 0.65 };
    expect(effectiveAudioSettings(saved)).toEqual({ ...saved, voiceEnabled: false });
  }
});
