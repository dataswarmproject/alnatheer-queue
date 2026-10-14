import { open, unlink, readFile, mkdir, rmdir, readlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const owned = new Set<string>();
export async function lockDatabase(directory: string) {
  if (directory === 'memory://') return async () => {};
  const file = path.join(path.resolve(directory), '.queue-host.lock');
  const namespace = process.platform === 'linux' ? await readlink('/proc/self/ns/pid') : null;
  const locked = () =>
    new Error('Branch database is locked. Stop the other host before opening it.');
  let handle;
  try {
    handle = await open(file, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const recovery = file + '.recovery';
    try {
      await mkdir(recovery);
    } catch {
      throw locked();
    }
    try {
      const text = await readFile(file, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw locked();
      }
      const pid = typeof parsed === 'number' ? parsed : parsed.pid;
      if (!Number.isSafeInteger(pid) || pid < 1 || owned.has(file)) throw locked();
      if (namespace && (typeof parsed === 'number' || parsed.namespace !== namespace))
        throw locked();
      if (
        typeof parsed !== 'number' &&
        ((parsed.hostname && parsed.hostname !== hostname()) ||
          (parsed.namespace && parsed.namespace !== namespace))
      )
        throw locked();
      let live = true;
      try {
        process.kill(pid, 0);
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === 'ESRCH') live = false;
      }
      // Only within this machine and PID namespace can a reused self PID be recovered.
      if (live && pid !== process.pid) throw locked();
      await unlink(file);
      handle = await open(file, 'wx', 0o600);
    } finally {
      await rmdir(recovery);
    }
  }
  const token = JSON.stringify({
    pid: process.pid,
    instance: randomUUID(),
    hostname: hostname(),
    namespace,
  });
  await handle.writeFile(token);
  await handle.close();
  owned.add(file);
  return async () => {
    try {
      if ((await readFile(file, 'utf8')) !== token) throw locked();
      await unlink(file);
    } finally {
      owned.delete(file);
    }
  };
}
