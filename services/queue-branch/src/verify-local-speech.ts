import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { announcementParts } from '@saraf/queue-core/speech';
import { checkLocalSpeechRelease } from './local-speech-release';
import { NeuralSpeech, speechCacheKey } from './speech';

const { values } = parseArgs({ options: { library: { type: 'string' } } });
if (!values.library) throw new Error('Supply --library for a completed free library');
const root = path.resolve(values.library);
async function json(name: string, max = 16777216) {
  const file = path.join(root, name);
  if ((await stat(file)).size > max) throw new Error('Library metadata too large');
  return JSON.parse(await readFile(file, 'utf8'));
}
const manifest = await json('manifest.json');
const profile = await json('speech-cache/voice-library.json', 4096);
const releasePlan = JSON.parse(
  await readFile(new URL('../voice-plan-10x999.json', import.meta.url), 'utf8'),
);
const expected = checkLocalSpeechRelease(manifest, profile, releasePlan);
const report = await json('generation-report.json');
assert.equal(report.complete, true, 'Recording preparation is incomplete');
assert.equal(report.voiceId, manifest.voiceId);
assert.equal(report.model, expected.model);
assert.deepEqual(report.engine, expected.engine);
const keys = new Set<string>();
for (const item of [...expected.entries, ...expected.samples]) {
  const receipt = report.recordings[item.file];
  assert.ok(receipt, `Missing receipt: ${item.code}`);
  const file = path.join(root, item.file);
  assert.equal((await stat(file)).size, receipt.bytes);
  const audio = await readFile(file);
  assert.equal(createHash('sha256').update(audio).digest('hex'), receipt.sha256);
  assert.ok(receipt.duration > 0.3 && receipt.duration < 22);
  if (item.file.startsWith('speech-cache/')) keys.add(item.key);
}
let combinations = 0;
for (const prefix of expected.plan.prefixes)
  for (let number = expected.plan.start; number <= expected.plan.end; number++)
    for (const counterName of expected.plan.counters) {
      for (const part of announcementParts({ code: `${prefix}-${number}`, counterName }))
        assert.ok(
          keys.has(speechCacheKey(expected.voiceId, expected.model, part)),
          `Missing ${prefix}${number} → ${counterName}`,
        );
      combinations++;
    }
let providerRequests = 0;
const speech = new NeuralSpeech({
  directory: path.join(root, 'speech-cache'),
  voiceId: expected.voiceId,
  model: expected.model,
  fetch: async () => {
    providerRequests++;
    throw new Error('Unexpected provider request');
  },
});
for (const number of [1, 23, 101, 999])
  for (const counterName of expected.plan.counters) {
    const result = await speech.callAudio({ code: `A-${number}`, counterName });
    assert.equal(result.cached, true);
    assert.ok('segments' in result || 'audio' in result);
  }
await assert.rejects(() => speech.callAudio({ code: 'B-1', counterName: 'كاونتر 1' }), /غير محفوظ/);
assert.equal(providerRequests, 0);
console.log(
  JSON.stringify({
    verifiedRecordings: keys.size,
    samples: expected.samples.length,
    combinations,
    cachedOnly: speech.status().cachedOnly,
    providerRequests,
  }),
);
