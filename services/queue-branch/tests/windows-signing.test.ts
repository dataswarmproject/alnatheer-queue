import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { windowsSigning } = require('../../../apps/queue-desktop/scripts/windows-signing.cjs');
it('enables certificate-store signing independently of a generic update feed', () => {
  const signing = windowsSigning({
    QUEUE_SIGNING_MODE: 'internal',
    QUEUE_SIGNING_PUBLISHER: 'Digital Trendz',
    QUEUE_SIGNING_CERT_SHA1: 'a'.repeat(40),
  });
  expect(signing).toMatchObject({
    enabled: true,
    mode: 'internal',
    publisher: 'Digital Trendz',
    certificateSha1: 'A'.repeat(40),
  });
  expect(signing.win).toMatchObject({
    signExecutable: true,
    signtoolOptions: { certificateSha1: 'A'.repeat(40), signingHashAlgorithms: ['sha256'] },
  });
});
it('rejects missing or ambiguous credentials without printing secret values', () => {
  expect(() => windowsSigning({ QUEUE_REQUIRE_WINDOWS_SIGNATURE: '1' })).toThrow('signing');
  expect(() =>
    windowsSigning({ QUEUE_SIGNING_MODE: 'internal', QUEUE_SIGNING_PUBLISHER: 'Digital Trendz' }),
  ).toThrow('certificate');
  expect(() =>
    windowsSigning({
      QUEUE_SIGNING_MODE: 'internal',
      QUEUE_SIGNING_PUBLISHER: 'Digital Trendz',
      QUEUE_SIGNING_CERT_SHA1: 'invalid',
    }),
  ).toThrow('thumbprint');
  expect(() =>
    windowsSigning({
      QUEUE_SIGNING_MODE: 'internal',
      QUEUE_SIGNING_PUBLISHER: 'Digital Trendz',
      QUEUE_SIGNING_CERT_SHA1: 'a'.repeat(40),
      CSC_LINK: 'SECRET-MUST-NOT-PRINT',
    }),
  ).toThrow('one');
});
it('keeps explicit evaluation builds unsigned and requires a publisher for future public signing', () => {
  expect(windowsSigning({})).toMatchObject({ enabled: false, mode: 'none' });
  expect(() =>
    windowsSigning({ QUEUE_SIGNING_MODE: 'public', QUEUE_SIGNING_CERT_SHA1: 'a'.repeat(40) }),
  ).toThrow('publisher');
  expect(
    windowsSigning({
      QUEUE_SIGNING_MODE: 'public',
      QUEUE_SIGNING_PUBLISHER: 'Digital Trendz',
      QUEUE_SIGNING_CERT_SHA1: 'a'.repeat(40),
    }).enabled,
  ).toBe(true);
});
