import { announcementText, speechTestText } from '@saraf/queue-core/speech';
import { planSpeech, speechPlanSchema } from './speech-plan';
import { speechCacheKey } from './speech';

export const localVoiceId = 'alnatheer-arabic-local-v3-5bb1f6ee-cfg0';
export const localVoiceModel = 'chatterbox_multilingual_v3' as const;
export function planLocalSpeech(input: unknown) {
  const plan = speechPlanSchema.parse(input);
  if (plan.mode !== 'split') throw new Error('Use split mode for the reusable local library');
  const phrases = [
    { code: 'AUDIO TEST', counterName: '3', text: speechTestText },
    ...planSpeech(plan),
  ];
  const key = (text: string) => speechCacheKey(localVoiceId, localVoiceModel, text);
  const samples = [
    { code: 'A-001', counterName: 'كاونتر 1' },
    { code: 'A-023', counterName: 'كاونتر 3' },
    { code: 'A-101', counterName: 'كاونتر 7' },
    { code: 'A-999', counterName: 'كاونتر 10' },
  ].map((call, index) => {
    const text = announcementText(call);
    return {
      ...call,
      text,
      key: key(text),
      file: `samples/${call.code}-counter-${[1, 3, 7, 10][index]}.mp3`,
    };
  });
  return {
    version: 1,
    voiceId: localVoiceId,
    model: localVoiceModel,
    engine: {
      codeRevision: '5de7a54aa4e5e2baadb0182dde554908b48b85c2',
      modelRevision: '5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18',
      license: 'MIT',
      builtInVoice: true,
      language: 'ar',
      cfgWeight: 0,
      exaggeration: 0.3,
    },
    plan,
    combinations:
      (plan.end - plan.start + 1) * new Set(plan.prefixes).size * new Set(plan.counters).size,
    totalClips: phrases.length,
    entries: phrases.map((phrase, index) => ({
      ...phrase,
      index,
      key: key(phrase.text),
      file: `speech-cache/${key(phrase.text)}.mp3`,
    })),
    samples,
  };
}
