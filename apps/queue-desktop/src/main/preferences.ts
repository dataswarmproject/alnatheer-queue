import { app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { devicePreferencesSchema, defaultDevicePreferences } from '@saraf/queue-core/device';
const file = () => path.join(app.getPath('userData'), 'device-preferences.json');
export async function readPreferences() {
  try {
    return devicePreferencesSchema.parse(JSON.parse(await readFile(file(), 'utf8')));
  } catch {
    return { ...defaultDevicePreferences };
  }
}
export async function savePreferences(input: unknown) {
  const value = devicePreferencesSchema.parse(input);
  await writeFile(file(), JSON.stringify(value), { mode: 0o600 });
  return value;
}
