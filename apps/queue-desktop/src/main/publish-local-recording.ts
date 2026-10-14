import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function publishLocalRecording(
  cache: string,
  key: string,
  audio: Buffer,
  receipt: { bytes: number; sha256: string },
) {
  if (
    !/^[a-f0-9]{64}$/.test(key) ||
    audio.length > 2097152 ||
    audio.length !== receipt.bytes ||
    createHash('sha256').update(audio).digest('hex') !== receipt.sha256
  )
    throw new Error('Voice recording checksum mismatch');
  const destination = path.join(cache, key + '.mp3');
  let exists = false;
  try {
    const saved = await lstat(destination);
    if (!saved.isFile()) throw new Error('Voice recording path is not a regular file');
    exists = true;
    if (
      saved.size === receipt.bytes &&
      createHash('sha256')
        .update(await readFile(destination))
        .digest('hex') === receipt.sha256
    )
      return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pending = path.join(cache, `${key}.${randomUUID()}.tmp`);
  try {
    await writeFile(pending, audio, { flag: 'wx', mode: 0o600 });
    // Repair only this library's content-addressed audio; preserve damaged bytes.
    if (exists) await rename(destination, path.join(cache, `${key}.invalid.${randomUUID()}`));
    await rename(pending, destination);
  } finally {
    await unlink(pending).catch(() => {});
  }
}
