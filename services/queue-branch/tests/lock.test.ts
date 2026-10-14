import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { lockDatabase } from '../src/lock';
it('recovers a dead local owner, refuses foreign owners and prevents double opens', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'saraf-queue-lock-'));
  const file = path.join(dir, '.queue-host.lock');
  try {
    const release = await lockDatabase(dir);
    await expect(lockDatabase(dir)).rejects.toThrow('locked');
    await release();
    // A dead PID within the current machine/namespace is safe to recover.
    const { readlink } = await import('node:fs/promises');
    const namespace = process.platform === 'linux' ? await readlink('/proc/self/ns/pid') : null;
    await writeFile(file, JSON.stringify({ pid: 2147483647, hostname: os.hostname(), namespace }));
    const recovered = await lockDatabase(dir);
    await recovered();
    await writeFile(
      file,
      JSON.stringify({ pid: process.pid, hostname: 'TEST-FOREIGN-HOST', namespace }),
    );
    await expect(lockDatabase(dir)).rejects.toThrow('locked');
    await access(file);
    await writeFile(file, '{corrupt');
    await expect(lockDatabase(dir)).rejects.toThrow('locked');
  } finally {
    if (
      path.dirname(dir) === path.resolve(os.tmpdir()) &&
      path.basename(dir).startsWith('saraf-queue-lock-')
    )
      await rm(dir, { recursive: true, force: true });
  }
});
