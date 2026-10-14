import { z } from 'zod';

export const audioSettingsSchema = z
  .object({
    enabled: z.boolean(),
    voiceEnabled: z.boolean().default(true),
    alertEnabled: z.boolean().default(true),
    mode: z.enum(['auto', 'natural', 'local']),
    voiceURI: z.string().max(500),
    volume: z.number().min(0).max(1),
  })
  .strict();
export type AudioSettings = z.infer<typeof audioSettingsSchema>;
export const defaultAudioSettings: AudioSettings = {
  enabled: true,
  voiceEnabled: true,
  alertEnabled: true,
  mode: 'auto',
  voiceURI: '',
  volume: 1,
};
export const audioRuntimeSchema = z
  .object({
    mode: z.enum(['natural', 'local']),
    ready: z.boolean(),
    voiceURI: z.string().max(500),
    natural: z
      .object({
        configured: z.boolean(),
        cachedOnly: z.boolean(),
        restartRequired: z.boolean().optional(),
      })
      .nullable(),
    voices: z
      .array(z.object({ voiceURI: z.string().max(500), name: z.string().max(500) }))
      .max(100),
    error: z.string().max(1000),
  })
  .strict();
export type AudioRuntime = z.infer<typeof audioRuntimeSchema>;
export type AudioStatus = { settings: AudioSettings; runtime: AudioRuntime | null };
