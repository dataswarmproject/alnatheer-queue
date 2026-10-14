import { it, expect, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyRelease, verifyReleaseFile } from '@saraf/queue-core/update-release';
import { GithubReleaseBroker } from '@saraf/queue-core/github-release-broker';
import { SignedReleaseEngine } from '../../../apps/queue-desktop/src/signed-release-engine';
import { UpdateController } from '../../../apps/queue-desktop/src/update-controller';
function fixture() {
  const key = generateKeyPairSync('ed25519'),
    bytes = Buffer.from('MZ TEST ONLY - NEVER EXECUTE');
  const publicKey = key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const payload = {
    format: 1 as const,
    version: '0.4.1',
    platform: 'windows-x64' as const,
    fileName: 'alnatheer-queue-0.4.1-windows-x64.exe',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    publishedAt: new Date().toISOString(),
  };
  return {
    publicKey,
    bytes,
    release: {
      payload,
      signature: sign(null, Buffer.from(JSON.stringify(payload)), key.privateKey).toString(
        'base64',
      ),
    },
  };
}
it('rejects changed release metadata, another signer, non-files and altered installer bytes', async () => {
  const f = fixture(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'queue-release-test-')),
    file = path.join(directory, 'installer.exe');
  try {
    expect(verifyRelease(f.release, f.publicKey)).toEqual(f.release);
    expect(() =>
      verifyRelease(
        { ...f.release, payload: { ...f.release.payload, size: f.bytes.length + 1 } },
        f.publicKey,
      ),
    ).toThrow('signature');
    expect(() => verifyRelease(f.release, fixture().publicKey)).toThrow('signature');
    await writeFile(file, f.bytes);
    await verifyReleaseFile(file, f.release, f.publicKey);
    const changed = Buffer.from(f.bytes);
    changed[3] ^= 1;
    await writeFile(file, changed);
    await expect(verifyReleaseFile(file, f.release, f.publicKey)).rejects.toThrow('digest');
    await expect(verifyReleaseFile(directory, f.release, f.publicKey)).rejects.toThrow('size');
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-release-test-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
it('broker authenticates private GitHub reads, strips credentials from CDN requests and pins asset version/hash', async () => {
  const f = fixture(),
    calls: { url: string; headers: Headers }[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(options?.headers) });
    if (url.includes('/releases/assets/1')) return new Response(JSON.stringify(f.release));
    if (url.includes('/releases/assets/2'))
      return new Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/TEST-ONLY' },
      });
    if (url.startsWith('https://release-assets')) return new Response(f.bytes);
    return Response.json({
      draft: false,
      prerelease: false,
      tag_name: 'queue-v0.4.1',
      assets: [
        { id: 1, name: 'queue-release.json', size: 1000 },
        { id: 2, name: f.release.payload.fileName, size: f.bytes.length },
      ],
    });
  });
  const broker = new GithubReleaseBroker({
    repository: 'test-owner/private-queue',
    token: 'TEST ONLY',
    publicKey: f.publicKey,
    fetch: fetcher as typeof fetch,
  });
  expect((await broker.release())?.release).toEqual(f.release);
  expect(
    Buffer.from(await (await broker.download('0.4.1', f.release.payload.sha256)).arrayBuffer()),
  ).toEqual(f.bytes);
  expect(
    calls
      .filter(call => call.url.startsWith('https://api.github.com'))
      .every(call => call.headers.get('authorization') === 'Bearer TEST ONLY'),
  ).toBe(true);
  expect(
    calls.find(call => call.url.startsWith('https://release-assets'))!.headers.has('authorization'),
  ).toBe(false);
  await expect(broker.download('0.4.1', 'a'.repeat(64))).rejects.toThrow('digest');
});
it('an inaccessible private repository is an error, while an accessible repository with no release is empty', async () => {
  const f = fixture(),
    missing = new GithubReleaseBroker({
      repository: 'test/private',
      token: 'TEST',
      publicKey: f.publicKey,
      fetch: vi.fn(async () => new Response('', { status: 404 })) as typeof fetch,
    });
  await expect(missing.release()).rejects.toThrow('unavailable');
  const empty = new GithubReleaseBroker({
    repository: 'test/private',
    token: 'TEST',
    publicKey: f.publicKey,
    fetch: vi.fn(async input =>
      String(input).endsWith('/releases/latest')
        ? new Response('', { status: 404 })
        : Response.json({ private: true }),
    ) as typeof fetch,
  });
  expect(await empty.release()).toBeNull();
});
it('controller checks a signed newer release and refuses installation after its downloaded bytes are changed', async () => {
  const f = fixture(),
    directory = await mkdtemp(path.join(os.tmpdir(), 'queue-release-engine-')),
    file = path.join(directory, 'installer.exe'),
    prepareInstall = vi.fn(async () => {}),
    download = vi.fn(async (_release: unknown, progress: (percent: number) => void) => {
      await writeFile(file, f.bytes);
      progress(100);
      return file;
    }),
    install = vi.fn(async () => {});
  try {
    const engine = new SignedReleaseEngine({
      publicKey: f.publicKey,
      latest: async () => f.release,
      download,
      install,
    });
    const controller = new UpdateController({
      currentVersion: '0.4.0',
      engine,
      preferences: { ignoredVersion: null, scheduledVersion: null, scheduledAt: null },
      isManager: () => true,
      save: async () => {},
      verify: file => engine.verify(file),
      prepareInstall,
    });
    expect((await controller.action({ action: 'check' })).state).toBe('available');
    expect((await controller.action({ action: 'download' })).state).toBe('downloaded');
    await writeFile(file, Buffer.alloc(f.bytes.length));
    await expect(controller.action({ action: 'install' })).rejects.toThrow('digest');
    expect(install).not.toHaveBeenCalled();
    expect(prepareInstall).not.toHaveBeenCalled();
    expect((await controller.action({ action: 'download' })).state).toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(2);
    await controller.action({ action: 'install' });
    expect(prepareInstall).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
  } finally {
    if (
      path.dirname(directory) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('queue-release-engine-')
    )
      await rm(directory, { recursive: true, force: true });
  }
});
