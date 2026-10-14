import { app } from 'electron';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { connectionInfo } from './client';
const layoutSchema = z
  .object({ url: z.string().max(200), displayId: z.number().int(), enabled: z.boolean() })
  .strict();
const file = () => path.join(app.getPath('userData'), 'tv-layout.json');
export async function saveTvLayout(displayId: number | null) {
  const url = connectionInfo().url;
  if (!url) return;
  const value = layoutSchema.parse({ url, displayId: displayId ?? 0, enabled: displayId !== null });
  const temp = file() + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  await rename(temp, file());
}
export async function restoreTvLayout(tv: {
  status: () => { open: boolean; monitors: { id: number; primary: boolean }[] };
  open: (id: number) => Promise<void>;
}) {
  if (connectionInfo().role !== 'manager' || tv.status().open) return;
  try {
    const saved = layoutSchema.parse(JSON.parse(await readFile(file(), 'utf8')));
    if (
      saved.enabled &&
      saved.url === connectionInfo().url &&
      tv.status().monitors.some(m => m.id === saved.displayId && !m.primary)
    )
      await tv.open(saved.displayId);
  } catch {
    /* Missing HDMI or offline LAN must not reset setup or block the manager. */
  }
}
