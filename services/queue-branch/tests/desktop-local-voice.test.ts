import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publishLocalRecording } from '../../../apps/queue-desktop/src/main/publish-local-recording';
import { freeSpeechPolicy, requireFreeSpeech } from '../../../apps/queue-desktop/src/speech-policy';

it('repairs an interrupted library copy, preserves damaged bytes and leaves database files intact', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-local-publish-test-'));
  try {
    const key = 'a'.repeat(64),
      audio = Buffer.from('ID3' + 'VALID TEST AUDIO'.repeat(10));
    const receipt = {
      bytes: audio.length,
      sha256: createHash('sha256').update(audio).digest('hex'),
    };
    await writeFile(path.join(directory, 'existing.db'), 'PRESERVE');
    await writeFile(path.join(directory, key + '.mp3'), 'INTERRUPTED COPY');
    await publishLocalRecording(directory, key, audio, receipt);
    expect(await readFile(path.join(directory, key + '.mp3'))).toEqual(audio);
    const damaged = (await readdir(directory)).find(x => x.startsWith(key + '.invalid.'))!;
    expect(await readFile(path.join(directory, damaged), 'utf8')).toBe('INTERRUPTED COPY');
    await publishLocalRecording(directory, key, audio, receipt);
    expect((await readdir(directory)).filter(x => x.startsWith(key + '.invalid.'))).toHaveLength(1);
    expect(await readFile(path.join(directory, 'existing.db'), 'utf8')).toBe('PRESERVE');
    expect((await readdir(directory)).filter(x => x.endsWith('.tmp'))).toHaveLength(0);
    await expect(publishLocalRecording(directory, '../escape', audio, receipt)).rejects.toThrow(
      'checksum',
    );
    await mkdir(path.join(directory, 'b'.repeat(64) + '.mp3'));
    await expect(publishLocalRecording(directory, 'b'.repeat(64), audio, receipt)).rejects.toThrow(
      'regular file',
    );
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-local-publish-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
it('blocks an older paid host until free playback is activated, while retaining standalone free playback', () => {
  const paid = { configured: true, cachedOnly: false };
  expect(freeSpeechPolicy(paid, true)).toEqual({
    configured: false,
    cachedOnly: true,
    restartRequired: true,
  });
  expect(() => requireFreeSpeech(paid, true)).toThrow('FREE_VOICE_RESTART_REQUIRED');
  expect(() => requireFreeSpeech({ configured: true, cachedOnly: true }, true)).not.toThrow();
  expect(freeSpeechPolicy(paid, false)).toEqual(paid);
});
