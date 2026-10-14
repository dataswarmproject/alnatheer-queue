import { z } from 'zod';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';

export const releasePayloadSchema = z
  .object({
    format: z.literal(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    platform: z.literal('windows-x64'),
    fileName: z.string().regex(/^alnatheer-queue-\d+\.\d+\.\d+-windows-x64\.exe$/),
    size: z
      .number()
      .int()
      .positive()
      .max(512 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    publishedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    value => value.fileName === `alnatheer-queue-${value.version}-windows-x64.exe`,
    'Installer version mismatch',
  );
export const signedReleaseSchema = z
  .object({ payload: releasePayloadSchema, signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) })
  .strict();
export type SignedRelease = z.infer<typeof signedReleaseSchema>;
export function verifyRelease(input: unknown, publicKey: string): SignedRelease {
  const release = signedReleaseSchema.parse(input);
  const key = createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    format: 'der',
    type: 'spki',
  });
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(
      null,
      Buffer.from(JSON.stringify(release.payload)),
      key,
      Buffer.from(release.signature, 'base64'),
    )
  )
    throw new Error('Invalid queue release signature');
  return release;
}
export async function verifyReleaseFile(file: string, release: SignedRelease, publicKey: string) {
  verifyRelease(release, publicKey);
  const info = await lstat(file);
  if (!info.isFile() || info.size !== release.payload.size)
    throw new Error('Invalid installer size');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest('hex') !== release.payload.sha256) throw new Error('Invalid installer digest');
}
