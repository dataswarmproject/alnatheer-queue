import { app } from 'electron';
import { mkdir, readFile, stat, realpath, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { publishLocalRecording } from './publish-local-recording';

const profileSchema = z
  .object({
    version: z.literal(1),
    voiceId: z
      .string()
      .regex(/^alnatheer-arabic-local-[a-zA-Z0-9_-]+$/)
      .max(80),
    model: z.literal('chatterbox_multilingual_v3'),
    complete: z.literal(true),
    recordings: z.number().int().min(1).max(10000),
  })
  .strict();
const manifestSchema = z.object({
  voiceId: z.string(),
  model: z.literal('chatterbox_multilingual_v3'),
  entries: z
    .array(z.object({ key: z.string().regex(/^[a-f0-9]{64}$/) }))
    .min(1)
    .max(10000),
});
const recordingSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(100).max(2097152),
});
const reportSchema = z.object({ complete: z.literal(true), recordings: z.record(recordingSchema) });
function libraryRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'branch/voice-library-free')
    : path.resolve(__dirname, '../../release/arabic-voice-library-free');
}
async function readJson(file: string, max: number) {
  if ((await stat(file)).size > max) throw new Error('Voice library metadata is too large');
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function localVoiceAvailable() {
  try {
    profileSchema.parse(
      await readJson(path.join(libraryRoot(), 'speech-cache/voice-library.json'), 4096),
    );
    return true;
  } catch {
    return false;
  }
}
export async function installLocalVoice(directory: string) {
  if (!(await localVoiceAvailable())) return false;
  const root = libraryRoot();
  const profile = profileSchema.parse(
    await readJson(path.join(root, 'speech-cache/voice-library.json'), 4096),
  );
  const manifest = manifestSchema.parse(await readJson(path.join(root, 'manifest.json'), 16777216));
  const report = reportSchema.parse(
    await readJson(path.join(root, 'generation-report.json'), 16777216),
  );
  if (
    manifest.voiceId !== profile.voiceId ||
    manifest.entries.length !== profile.recordings ||
    new Set(manifest.entries.map(x => x.key)).size !== profile.recordings
  )
    throw new Error('Voice library is incomplete');
  const cache = path.join(directory, 'speech-cache');
  await mkdir(cache, { recursive: true });
  const relative = path.relative(await realpath(directory), await realpath(cache));
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Voice cache is outside the branch folder');
  for (const entry of manifest.entries) {
    const name = entry.key + '.mp3',
      source = path.join(root, 'speech-cache', name);
    const expected = report.recordings['speech-cache/' + name];
    if (!expected) throw new Error('Voice recording receipt is missing');
    const sourceInfo = await stat(source);
    if (!sourceInfo.isFile() || sourceInfo.size !== expected.bytes)
      throw new Error('Voice recording size mismatch');
    const buffer = await readFile(source);
    await publishLocalRecording(cache, entry.key, buffer, expected);
  }
  // Publish only after all recordings are copied; operational database files are untouched.
  const pending = path.join(cache, `voice-library.${randomUUID()}.tmp`);
  try {
    await writeFile(pending, JSON.stringify(profile), { flag: 'wx', mode: 0o600 });
    await rename(pending, path.join(cache, 'voice-library.json'));
  } finally {
    await unlink(pending).catch(() => {});
  }
  return true;
}
