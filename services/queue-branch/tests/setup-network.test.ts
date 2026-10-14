import { it, expect } from 'vitest';
import { randomUUID, X509Certificate } from 'node:crypto';
import * as tls from 'node:tls';
import { hostSetupSchema } from '../../../apps/queue-desktop/src/setup-contract';
import { trustedEndpoint } from '@saraf/queue-core';
import { useWindowsNetworkTrust } from '@saraf/queue-core/network-trust';

const settings = {
  branchId: randomUUID(),
  directory: 'D:/queue-test',
  port: 4318,
  host: '127.0.0.1',
  url: 'http://127.0.0.1:4318',
  openAtLogin: false,
};
it('explains missing branch identity and blocks headquarters sync with a local evaluation identity', () => {
  const missing = hostSetupSchema.safeParse({ ...settings, branchId: '' });
  expect(missing.success).toBe(false);
  if (!missing.success) expect(missing.error.issues[0].message).toContain('SARAF');
  expect(hostSetupSchema.parse(settings).localEvaluation).toBe(false);
  expect(hostSetupSchema.parse({ ...settings, localEvaluation: true }).branchId).toBe(
    settings.branchId,
  );
  expect(() =>
    hostSetupSchema.parse({
      ...settings,
      localEvaluation: true,
      syncUrl: 'https://saraf.internal/api/queue/sync',
      syncKey: 'a'.repeat(64),
    }),
  ).toThrow('معرّف التجربة المحلية');
});
it('allows HTTPS LAN and VPN endpoints but does not accept plaintext or embedded credentials', () => {
  for (const url of [
    'https://192.168.10.20:4318',
    'https://10.8.0.12:4318',
    'https://branch.internal:4318',
  ])
    expect(trustedEndpoint(url).protocol).toBe('https:');
  for (const url of ['http://10.8.0.12:4318', 'https://user:password@branch.internal:4318'])
    expect(() => trustedEndpoint(url)).toThrow();
});
it('adds existing Windows enterprise roots without removing public roots', () => {
  const before = tls.getCACertificates('default');
  try {
    useWindowsNetworkTrust();
    const after = new Set(
      tls.getCACertificates('default').map(cert => new X509Certificate(cert).fingerprint256),
    );
    for (const cert of before)
      expect(after.has(new X509Certificate(cert).fingerprint256)).toBe(true);
    if (process.platform === 'win32')
      for (const cert of tls.getCACertificates('system'))
        expect(after.has(new X509Certificate(cert).fingerprint256)).toBe(true);
  } finally {
    tls.setDefaultCACertificates(before);
  }
});
