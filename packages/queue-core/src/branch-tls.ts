import { X509Certificate, createPrivateKey, generateKeyPair, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { webcrypto } from 'node:crypto';
x509.cryptoProvider.set(webcrypto as unknown as Crypto);
const signingAlgorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
async function publicKey(key: import('node:crypto').KeyObject) {
  return (await webcrypto.subtle.importKey(
    'spki',
    new Uint8Array(key.export({ type: 'spki', format: 'der' })),
    signingAlgorithm,
    true,
    ['verify'],
  )) as unknown as CryptoKey;
}
async function signingKey(key: import('node:crypto').KeyObject) {
  return (await webcrypto.subtle.importKey(
    'pkcs8',
    new Uint8Array(key.export({ type: 'pkcs8', format: 'der' })),
    signingAlgorithm,
    false,
    ['sign'],
  )) as unknown as CryptoKey;
}
import { z } from 'zod';
import { legacyFetch } from './legacy-runtime';

import { branchTrustSchema, type BranchTrust } from './branch-trust';
export { branchTrustSchema, type BranchTrust } from './branch-trust';
export const authoritySchema = z
  .object({
    branchId: z.string().uuid(),
    ca: z.string().max(8192),
    key: z.string().max(8192),
  })
  .strict();
export type BranchAuthority = z.infer<typeof authoritySchema>;
const day = 86400000;
const pair = promisify(generateKeyPair);
const serial = () => '01' + randomBytes(19).toString('hex');
const fingerprint = (cert: X509Certificate) => cert.fingerprint256.replace(/:/g, '').toLowerCase();

export function validateBranchTrust(input: unknown): BranchTrust {
  const trust = branchTrustSchema.parse(input);
  if (
    !/^-----BEGIN CERTIFICATE-----\r?\n[\s\S]+\r?\n-----END CERTIFICATE-----\s*$/.test(trust.ca) ||
    trust.ca.match(/BEGIN CERTIFICATE/g)?.length !== 1
  )
    throw new Error('Invalid branch certificate');
  const cert = new X509Certificate(trust.ca);
  if (
    !cert.ca ||
    !cert.verify(cert.publicKey) ||
    fingerprint(cert) !== trust.fingerprint ||
    cert.publicKey.asymmetricKeyType !== 'rsa' ||
    (cert.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new Error('Invalid branch certificate identity');
  return trust;
}

export async function createBranchAuthority(
  branchId: string,
  now = new Date(),
): Promise<BranchAuthority> {
  z.string().uuid().parse(branchId);
  const keys = await pair('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
  const key = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial(),
    name: 'CN=Alnatheer Queue ' + branchId,
    notBefore: new Date(now.getTime() - 5 * 60000),
    notAfter: new Date(now.getTime() + 3650 * day),
    signingAlgorithm,
    keys: {
      privateKey: await signingKey(keys.privateKey),
      publicKey: await publicKey(keys.publicKey),
    },
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });
  return { branchId, ca: cert.toString('pem'), key };
}

export function authorityTrust(authority: BranchAuthority): BranchTrust {
  return validateBranchTrust({
    branchId: authority.branchId,
    ca: authority.ca,
    fingerprint: fingerprint(new X509Certificate(authority.ca)),
  });
}

export async function issueBranchCertificate(
  authority: BranchAuthority,
  address: string,
  now = new Date(),
) {
  authoritySchema.parse(authority);
  const trust = authorityTrust(authority);
  const ca = new X509Certificate(authority.ca);
  if (!ca.checkPrivateKey(createPrivateKey(authority.key)))
    throw new Error('Invalid branch signing key');
  if (Date.parse(ca.validTo) <= now.getTime() + 400 * day)
    throw new Error('Branch authority requires renewal');
  if (isIP(address) !== 4) throw new Error('Select a local IPv4 network address');
  const keys = await pair('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: 'CN=' + address,
    issuer: new x509.X509Certificate(authority.ca).subject,
    notBefore: new Date(now.getTime() - 5 * 60000),
    notAfter: new Date(now.getTime() + 397 * day),
    signingAlgorithm,
    publicKey: await publicKey(keys.publicKey),
    signingKey: await signingKey(createPrivateKey(authority.key)),
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
      new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),
      new x509.SubjectAlternativeNameExtension([{ type: 'ip', value: address }]),
    ],
  });
  const passphrase = randomBytes(32).toString('hex');
  const key = keys.privateKey
    .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase })
    .toString();
  return { cert: cert.toString('pem'), key, passphrase, trust };
}

// The supplied root applies to this request only, and never to Windows or other
// branches/HQ. Node still verifies the certificate chain, validity and IP SAN.
export function branchFetch(input: string | URL, options: RequestInit = {}, trust?: BranchTrust) {
  if (!trust) return fetch(input, options);
  const address = new URL(input);
  if (address.protocol !== 'https:') throw new Error('Branch certificates require HTTPS');
  return legacyFetch(address, options, [validateBranchTrust(trust).ca]);
}
