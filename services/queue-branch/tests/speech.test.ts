import { it, expect } from 'vitest';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NeuralSpeech, speechCacheKey } from '../src/speech';
import { announcementParts, announcementText } from '@saraf/queue-core/speech';

const mp3 = Buffer.from([0x49, 0x44, 0x33, ...new Array(200).fill(0)]);
it('serves a free local voice cache without ever sending a missing phrase to a paid provider', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-speech-test-'));
  let requests = 0;
  try {
    const model = 'chatterbox_multilingual_v3';
    const voiceId = 'alnatheer-arabic-local';
    const speech = new NeuralSpeech({
      directory,
      model,
      voiceId,
      apiKey: 'TEST-ONLY',
      fetch: async () => {
        requests++;
        throw new Error('Paid provider must not be called');
      },
    });
    expect(speech.status()).toEqual({ configured: true, cachedOnly: true });
    await expect(
      speech.callAudio({ code: 'A-023', counterName: 'كاونتر 3' }),
    ).rejects.toMatchObject({ code: 'SPEECH_OFFLINE' });
    const call = { code: 'A-999', counterName: 'كاونتر 10' };
    for (const part of announcementParts(call))
      await writeFile(path.join(directory, speechCacheKey(voiceId, model, part) + '.mp3'), mp3);
    const audio = await speech.callAudio(call);
    expect('segments' in audio && audio.segments.length).toBe(2);
    expect(audio.cached).toBe(true);
    expect(requests).toBe(0);
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-speech-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
it('combines cached whole phrases offline and prefers a complete recording when present', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-speech-test-'));
  try {
    const generator = new NeuralSpeech({
      directory,
      voiceId: 'test-voice',
      apiKey: 'TEST-ONLY',
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.text.startsWith('على صاحب') && !body.text.includes('التوجّه')) {
          expect(body.next_text).toBe('التوجّه إلى الكاونتر المطلوب.');
        } else if (body.text.startsWith('التوجّه')) {
          expect(body.previous_text).toBe('على صاحب التذكرة رقم،');
          expect(body.previous_text).not.toContain('ثلاثة وعشرين');
        }
        return new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } });
      },
    });
    const call = { code: 'A-999', counterName: 'كاونتر 10' };
    for (const part of announcementParts(call)) await generator.audio(part);
    const offline = new NeuralSpeech({ directory, voiceId: 'test-voice' });
    const combined = await offline.callAudio(call);
    expect('segments' in combined && combined.segments.length).toBe(2);
    expect(combined.cached).toBe(true);
    await generator.audio(announcementText(call));
    const full = await offline.callAudio(call);
    expect('audio' in full).toBe(true);
    expect('segments' in full).toBe(false);
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-speech-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
it('deduplicates requests, persists complete phrases and reuses them offline after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-speech-test-'));
  let calls = 0;
  try {
    const speech = new NeuralSpeech({
      directory,
      voiceId: 'test-voice',
      apiKey: 'TEST-ONLY',
      fetch: async (_url, init) => {
        calls++;
        expect(JSON.parse(String(init?.body)).text).toBe('على صاحب التذكرة رقم A... ثلاثة وعشرين،');
        return new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } });
      },
    });
    const text = 'على صاحب التذكرة رقم A... ثلاثة وعشرين،';
    const [a, b] = await Promise.all([speech.audio(text), speech.audio(text)]);
    expect(a.audio).toBe(b.audio);
    expect(calls).toBe(1);
    const offline = new NeuralSpeech({ directory, voiceId: 'test-voice' });
    expect((await offline.audio(text)).cached).toBe(true);
    await expect(offline.audio('new phrase')).rejects.toMatchObject({ code: 'SPEECH_OFFLINE' });
    const changed = new NeuralSpeech({ directory, voiceId: 'different-voice' });
    await expect(changed.audio(text)).rejects.toMatchObject({ code: 'SPEECH_OFFLINE' });
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-speech-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
it('persists the Riyadh daily generation budget and does not charge for cache hits', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-speech-test-'));
  const config = {
    directory,
    voiceId: 'test-voice',
    apiKey: 'TEST-ONLY',
    dailyLimit: 1,
    fetch: async () => new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } }),
  };
  try {
    await new NeuralSpeech(config).audio('one');
    const restarted = new NeuralSpeech(config);
    expect((await restarted.audio('one')).cached).toBe(true);
    await expect(restarted.audio('two')).rejects.toMatchObject({ code: 'SPEECH_BUDGET' });
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-speech-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
it('never caches errors or secrets, and backs off instead of retrying paid synthesis', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-speech-test-'));
  let calls = 0;
  try {
    const speech = new NeuralSpeech({
      directory,
      voiceId: 'test-voice',
      apiKey: 'TEST-ONLY',
      fetch: async () => {
        calls++;
        return new Response('SECRET provider error', { status: 401 });
      },
    });
    await expect(speech.audio('one')).rejects.toMatchObject({ code: 'SPEECH_PROVIDER' });
    await expect(speech.audio('two')).rejects.toMatchObject({ code: 'SPEECH_COOLDOWN' });
    expect(calls).toBe(1);
    expect((await readdir(directory)).filter(x => x.endsWith('.mp3'))).toEqual([]);
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-speech-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
