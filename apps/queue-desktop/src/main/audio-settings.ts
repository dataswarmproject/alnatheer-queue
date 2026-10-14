import { app, type BrowserWindow } from 'electron';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  audioSettingsSchema,
  audioRuntimeSchema,
  defaultAudioSettings,
  type AudioRuntime,
} from '../audio-contract';

export async function createAudioController(windows: () => BrowserWindow[]) {
  const file = path.join(app.getPath('userData'), 'announcement-settings.json');
  let settings = { ...defaultAudioSettings };
  try {
    settings = audioSettingsSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {}
  let runtime: AudioRuntime | null = null;
  const broadcast = (channel: string, value?: unknown) => {
    for (const win of windows()) if (!win.isDestroyed()) win.webContents.send(channel, value);
  };
  let saving = false;
  return {
    status: () => ({ settings, runtime }),
    report: (input: unknown) => {
      runtime = audioRuntimeSchema.parse(input);
    },
    clear: () => {
      runtime = null;
    },
    test: () => broadcast('queue:audio-test'),
    save: async (input: unknown) => {
      if (saving) throw new Error('Audio settings are being saved');
      const value = audioSettingsSchema.parse(input);
      saving = true;
      try {
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        await rename(temp, file);
        settings = value;
        broadcast('queue:audio-settings', settings);
        return settings;
      } finally {
        saving = false;
      }
    },
  };
}
