import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { QueueError, businessDay } from '@saraf/queue-core';
import { announcementParts, announcementText, type SpeechAudio } from '@saraf/queue-core/speech';

const maxAudio = 2 * 1024 * 1024;
const maxCache = 512 * 1024 * 1024;
const usageSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    attempts: z.number().int().nonnegative(),
  })
  .strict();
export const speechModelSchema = z.enum([
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_turbo_v2_5',
  'eleven_v3',
  'chatterbox_multilingual_v3',
]);
type Settings = {
  directory: string;
  voiceId: string;
  apiKey?: string;
  model?: z.infer<typeof speechModelSchema>;
  dailyLimit?: number;
  fetch?: typeof fetch;
};
type SpeechClip = Extract<SpeechAudio, { audio: string }>;
export function speechCacheKey(voiceId: string, model: string, text: string) {
  return createHash('sha256')
    .update(JSON.stringify({ version: 2, voice: voiceId, model, text }))
    .digest('hex');
}
/** Full-sentence synthesis; no number-fragment concatenation or implicit paid retry. */
export class NeuralSpeech {
  private pending = new Map<string, Promise<SpeechClip>>();
  private tail: Promise<unknown> = Promise.resolve();
  private cooldownUntil = 0;
  private cacheBytes: number | null = null;
  private settings: Settings;
  private model: z.infer<typeof speechModelSchema>;
  constructor(settings: Settings) {
    z.string()
      .regex(/^[a-zA-Z0-9_-]{1,80}$/)
      .parse(settings.voiceId);
    this.model = speechModelSchema.parse(settings.model ?? 'eleven_multilingual_v2');
    z.number()
      .int()
      .min(1)
      .max(10000)
      .parse(settings.dailyLimit ?? 500);
    this.settings = { ...settings, directory: path.resolve(settings.directory) };
  }
  status() {
    return {
      configured: true,
      cachedOnly: this.model === 'chatterbox_multilingual_v3' || !this.settings.apiKey,
    };
  }
  async callAudio(
    call: { code: string; counterName: string },
    deadline = Infinity,
  ): Promise<SpeechAudio> {
    const text = announcementText(call);
    const full = await this.cachedAudio(text);
    if (full) return full;
    const parts = announcementParts(call);
    const cachedParts = await Promise.all(parts.map(part => this.cachedAudio(part)));
    if (cachedParts.every(part => part !== null))
      return {
        text,
        segments: cachedParts.map(part => ({ audio: part!.audio, mime: part!.mime })),
        cached: true,
      };
    return this.audio(text, deadline);
  }
  private async cachedAudio(text: string): Promise<Extract<SpeechAudio, { audio: string }> | null> {
    const key = speechCacheKey(this.settings.voiceId, this.model, text);
    const file = path.join(this.settings.directory, key + '.mp3');
    try {
      const meta = await lstat(file);
      if (!meta.isFile() || meta.size > maxAudio)
        throw new QueueError('SPEECH_CACHE', 'ملف النداء المحفوظ غير صالح.', 503);
      const audio = await readFile(file);
      if (!this.validAudio(audio))
        throw new QueueError('SPEECH_CACHE', 'ملف النداء المحفوظ غير صالح.', 503);
      return { text, audio: audio.toString('base64'), mime: 'audio/mpeg', cached: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async audio(text: string, deadline = Infinity): Promise<SpeechClip> {
    z.string().min(1).max(600).parse(text);
    const key = speechCacheKey(this.settings.voiceId, this.model, text);
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 16)
      throw new QueueError('SPEECH_BUSY', 'النداء مشغول، أعد التجربة لاحقًا.', 503);
    const work = this.tail.catch(() => {}).then(() => this.synthesize(key, text, deadline));
    this.pending.set(key, work);
    this.tail = work;
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
  private async atomic(file: string, data: string | Buffer) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  private validAudio(audio: Buffer) {
    return (
      audio.length >= 100 &&
      audio.length <= maxAudio &&
      (audio.subarray(0, 3).toString() === 'ID3' ||
        (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0))
    );
  }
  private async synthesize(key: string, text: string, deadline: number): Promise<SpeechClip> {
    const directory = this.settings.directory;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, key + '.mp3');
    const cached = await this.cachedAudio(text);
    if (cached) return cached;
    if (Date.now() >= deadline) throw new QueueError('SPEECH_STALE', 'النداء لم يعد نشطًا.', 409);
    if (this.model === 'chatterbox_multilingual_v3')
      throw new QueueError(
        'SPEECH_OFFLINE',
        'هذا النداء غير محفوظ. جهّز مكتبة الصوت المحلية أولًا.',
        503,
      );
    if (!this.settings.apiKey)
      throw new QueueError(
        'SPEECH_OFFLINE',
        'هذا النداء غير محفوظ. يلزم اتصال خدمة الصوت لتجهيزه.',
        503,
      );
    if (Date.now() < this.cooldownUntil)
      throw new QueueError('SPEECH_COOLDOWN', 'خدمة الصوت غير متاحة مؤقتًا. جرّب بعد دقيقة.', 503);
    if (this.cacheBytes === null) {
      const files = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.mp3$/.test(name));
      this.cacheBytes = 0;
      for (const name of files) this.cacheBytes += (await lstat(path.join(directory, name))).size;
    }
    if (this.cacheBytes + maxAudio > maxCache)
      throw new QueueError(
        'SPEECH_CAPACITY',
        'مخزن النداءات ممتلئ. اطلب من مسؤول التقنية توسيع المخزن.',
        503,
      );
    const usageFile = path.join(directory, 'usage.json'),
      day = businessDay(new Date());
    let usage = { day, attempts: 0 };
    try {
      const saved = usageSchema.parse(JSON.parse(await readFile(usageFile, 'utf8')));
      if (saved.day === day) usage = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new QueueError('SPEECH_BUDGET', 'تعذر التحقق من حد استخدام الصوت.', 503);
    }
    if (usage.attempts >= (this.settings.dailyLimit ?? 500))
      throw new QueueError('SPEECH_BUDGET', 'تم بلوغ حد إنشاء النداءات لهذا اليوم.', 429);
    // Reserve before network submission; uncertain requests are never silently resubmitted.
    await this.atomic(usageFile, JSON.stringify({ day, attempts: usage.attempts + 1 }));
    try {
      const response = await (this.settings.fetch ?? fetch)(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.settings.voiceId}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(12000),
          headers: { 'xi-api-key': this.settings.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: this.model,
            voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.95 },
            ...(this.model !== 'eleven_v3' &&
            text.startsWith('على صاحب التذكرة رقم') &&
            !text.includes('التوجّه')
              ? { next_text: 'التوجّه إلى الكاونتر المطلوب.' }
              : {}),
            ...(this.model !== 'eleven_v3' && text.startsWith('التوجّه')
              ? { previous_text: 'على صاحب التذكرة رقم،' }
              : {}),
          }),
        },
      );
      if (
        !response.ok ||
        !response.headers.get('content-type')?.startsWith('audio/') ||
        Number(response.headers.get('content-length') ?? 0) > maxAudio
      )
        throw new Error('Invalid speech response');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty speech response');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > maxAudio) {
            await reader.cancel();
            throw new Error('Audio too large');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const audio = Buffer.concat(chunks);
      if (!this.validAudio(audio)) throw new Error('Invalid MP3');
      await this.atomic(file, audio);
      this.cacheBytes += audio.length;
      return { text, audio: audio.toString('base64'), mime: 'audio/mpeg', cached: false };
    } catch {
      this.cooldownUntil = Date.now() + 60000;
      throw new QueueError(
        'SPEECH_PROVIDER',
        'تعذر إنشاء النداء الطبيعي. تحقق من اتصال خدمة الصوت وحسابها.',
        503,
      );
    }
  }
}
