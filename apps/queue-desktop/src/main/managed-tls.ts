import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { randomUUID, X509Certificate } from 'node:crypto';
import path from 'node:path';
import {
  authoritySchema,
  authorityTrust,
  createBranchAuthority,
  issueBranchCertificate,
} from '@saraf/queue-core/branch-tls';

// CA signing keys are encrypted for this Windows account. Leaf private keys
// are encrypted PKCS#8; their passphrase lives only in the encrypted host config.
export async function prepareManagedTls(branchId: string, address: string) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS credential encryption is unavailable');
  const directory = path.join(app.getPath('userData'), 'network-certificates', branchId);
  // branchId is also validated before it can become a filesystem path.
  authoritySchema.shape.branchId.parse(branchId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const authorityFile = path.join(directory, 'authority.enc');
  let authority;
  try {
    if ((await stat(authorityFile)).size > 32768) throw new Error('Invalid branch authority');
    authority = authoritySchema.parse(
      JSON.parse(safeStorage.decryptString(await readFile(authorityFile))),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    authority = await createBranchAuthority(branchId);
    await writeFile(authorityFile, safeStorage.encryptString(JSON.stringify(authority)), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  if (authority.branchId !== branchId) throw new Error('Branch certificate identity mismatch');
  authorityTrust(authority);
  const leaf = await issueBranchCertificate(authority, address);
  const version = randomUUID();
  const cert = path.join(directory, version + '.crt');
  const key = path.join(directory, version + '.key');
  await writeFile(key, leaf.key, { flag: 'wx', mode: 0o600 });
  await writeFile(cert, leaf.cert, { flag: 'wx', mode: 0o600 });
  return {
    cert,
    key,
    tlsMode: 'automatic' as const,
    managedTls: { trust: leaf.trust, passphrase: leaf.passphrase },
  };
}

export async function managedCertificateNeedsRenewal(file: string) {
  if ((await stat(file)).size > 8192) throw new Error('Invalid managed server certificate');
  const cert = new X509Certificate(await readFile(file));
  return Date.parse(cert.validTo) < Date.now() + 30 * 86400000;
}
