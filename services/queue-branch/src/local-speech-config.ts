import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
const profile = z
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
export async function localSpeechConfiguration(directory: string) {
  const file = path.join(directory, 'voice-library.json');
  try {
    if ((await stat(file)).size > 4096) throw new Error('Invalid local voice profile');
    const saved = profile.parse(JSON.parse(await readFile(file, 'utf8')));
    return { voiceId: saved.voiceId, model: saved.model };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
