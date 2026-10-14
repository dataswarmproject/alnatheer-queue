import { it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, copyFile, writeFile, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

it('never replaces an established release root when its private signer is missing or different', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'queue-signer-test-'));
  try {
    const script = path.join(directory, 'apps/queue-desktop/scripts/prepare-release-signing.cjs');
    const trust = path.join(directory, 'packages/queue-core/src/release-trust.ts');
    await mkdir(path.dirname(script), { recursive: true });
    await mkdir(path.dirname(trust), { recursive: true });
    await copyFile('../../apps/queue-desktop/scripts/prepare-release-signing.cjs', script);
    const key = generateKeyPairSync('ed25519');
    const publicKey = key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const original = `export const queueReleasePublicKey = '${publicKey}';\n`;
    await writeFile(trust, original);
    const env = { ...process.env, LOCALAPPDATA: directory, QUEUE_RELEASE_SIGNING_KEY: '' };
    expect(spawnSync(process.execPath, [script, '--bootstrap'], { env }).status).toBe(1);
    expect(await readFile(trust, 'utf8')).toBe(original);
    await expect(
      access(path.join(directory, 'AlnatheerQueue/ReleaseSigning/private.pem')),
    ).rejects.toThrow();
    const other = generateKeyPairSync('ed25519')
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();
    expect(
      spawnSync(process.execPath, [script], { env: { ...env, QUEUE_RELEASE_SIGNING_KEY: other } })
        .status,
    ).toBe(1);
    expect(await readFile(trust, 'utf8')).toBe(original);
    const matching = key.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    expect(
      spawnSync(process.execPath, [script], {
        env: { ...env, QUEUE_RELEASE_SIGNING_KEY: matching },
      }).status,
    ).toBe(0);
    expect(await readFile(trust, 'utf8')).toBe(original);
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-signer-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
