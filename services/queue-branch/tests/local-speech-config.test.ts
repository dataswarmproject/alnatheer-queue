import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { localSpeechConfiguration } from '../src/local-speech-config';
it('auto-configures a complete free library without a speech API key and rejects partial metadata', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-local-voice-test-'));
  try {
    expect(await localSpeechConfiguration(directory)).toBeNull();
    await writeFile(
      path.join(directory, 'voice-library.json'),
      JSON.stringify({
        version: 1,
        voiceId: 'alnatheer-arabic-local-v3-5bb1f6ee-cfg0',
        model: 'chatterbox_multilingual_v3',
        complete: false,
        recordings: 1010,
      }),
    );
    await expect(localSpeechConfiguration(directory)).rejects.toThrow();
    await writeFile(
      path.join(directory, 'voice-library.json'),
      JSON.stringify({
        version: 1,
        voiceId: 'alnatheer-arabic-local-v3-5bb1f6ee-cfg0',
        model: 'chatterbox_multilingual_v3',
        complete: true,
        recordings: 1010,
      }),
    );
    expect(await localSpeechConfiguration(directory)).toEqual({
      voiceId: 'alnatheer-arabic-local-v3-5bb1f6ee-cfg0',
      model: 'chatterbox_multilingual_v3',
    });
    await writeFile(
      path.join(directory, 'voice-library.json'),
      JSON.stringify({
        version: 1,
        voiceId: 'remote-voice',
        model: 'eleven_multilingual_v2',
        complete: true,
        recordings: 1010,
      }),
    );
    await expect(localSpeechConfiguration(directory)).rejects.toThrow();
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-local-voice-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
