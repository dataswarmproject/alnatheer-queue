import { it, expect } from 'vitest';
import { audioSettingsSchema } from '../../../apps/queue-desktop/src/audio-contract';
it('migrates legacy saved settings without unmuting a disabled display and retains independent channel choices', () => {
  const legacy = { enabled: false, mode: 'auto', voiceURI: '', volume: 0.7 };
  expect(audioSettingsSchema.parse(legacy)).toEqual({
    ...legacy,
    voiceEnabled: true,
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
