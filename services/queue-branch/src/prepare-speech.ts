import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { planSpeech, speechPlanSchema } from './speech-plan';
import { speechTestText } from '@saraf/queue-core/speech';
import { NeuralSpeech, speechCacheKey, speechModelSchema } from './speech';

const { values } = parseArgs({
  options: {
    plan: { type: 'string' },
    execute: { type: 'boolean', default: false },
    'max-new-clips': { type: 'string' },
  },
});
if (!values.plan) throw new Error('Supply --plan with a JSON range/prefixes/counters file');
if ((await stat(values.plan)).size > 131072) throw new Error('Plan too large');
const plan = speechPlanSchema.parse(JSON.parse(await readFile(values.plan, 'utf8')));
const prepared = planSpeech(plan);
const clips = [
  {
    code: 'AUDIO TEST',
    counterName: '3',
    text: speechTestText,
  },
  ...prepared,
];
const directory = path.resolve(process.env.QUEUE_SPEECH_CACHE_DIR ?? './speech-cache');
const voiceId = process.env.QUEUE_SPEECH_VOICE_ID;
if (!voiceId) throw new Error('Set QUEUE_SPEECH_VOICE_ID first');
const model = speechModelSchema.parse(process.env.QUEUE_SPEECH_MODEL ?? 'eleven_multilingual_v2');
const missing: typeof clips = [];
for (const clip of clips) {
  const file = path.join(directory, speechCacheKey(voiceId, model, clip.text) + '.mp3');
  try {
    await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    missing.push(clip);
  }
}
console.log(
  JSON.stringify(
    {
      mode: plan.mode,
      combinations:
        (plan.end - plan.start + 1) * new Set(plan.prefixes).size * new Set(plan.counters).size,
      totalClips: clips.length,
      newClips: missing.length,
      newCharacters: missing.reduce((sum, clip) => sum + clip.text.length, 0),
      voiceId,
      model,
      execute: values.execute,
    },
    null,
    2,
  ),
);
if (values.execute) {
  if (model === 'chatterbox_multilingual_v3')
    throw new Error(
      'Use prepare:speech:local for the free local voice library; no paid provider is contacted',
    );
  const max = Number(values['max-new-clips']);
  if (!Number.isInteger(max) || max < 0 || max > 10000 || missing.length > max)
    throw new Error(
      'Review the dry run, then supply --max-new-clips with an explicit generation limit',
    );
  if (!process.env.QUEUE_SPEECH_API_KEY) throw new Error('Set a private QUEUE_SPEECH_API_KEY');
  // One writer per cache. Never run batch preparation beside the live branch host.
  const hostLock = path.join(
    path.resolve(process.env.QUEUE_DATA_DIR ?? './queue-data'),
    '.queue-host.lock',
  );
  try {
    await stat(hostLock);
    throw new Error('Stop the branch host before preparing its cache');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const speech = new NeuralSpeech({
    directory,
    voiceId,
    model,
    apiKey: process.env.QUEUE_SPEECH_API_KEY,
    dailyLimit: Number(process.env.QUEUE_SPEECH_DAILY_LIMIT ?? 500),
  });
  for (const clip of missing) {
    await speech.audio(clip.text);
    console.log(`Prepared ${clip.code} → ${clip.counterName}`);
  }
  console.log('Preparation completed. Existing queue database was not opened or modified.');
}
