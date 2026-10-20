import { expect, it } from 'vitest';
import {
  parseDevicePairing,
  connectionFailure,
} from '../../../apps/queue-desktop/src/pairing-input';

it('reads an original pairing file including optional UTF8 BOM and rejects branch identity exports without leaking a key', () => {
  const token = 'a'.repeat(64);
  expect(
    parseDevicePairing(
      '\uFEFF' +
        JSON.stringify({ url: 'https://branch:4318', token: ' ' + token + ' ', role: 'teller' }),
    ),
  ).toEqual({ url: 'https://branch:4318', token });
  expect(() =>
    parseDevicePairing(
      JSON.stringify({
        kind: 'saraf-branch-identity',
        branchId: '03d1eac4-e978-4aa5-92cf-4ad2c50bc047',
      }),
    ),
  ).toThrow('معرّف الفرع');
  for (const value of [
    'not json',
    JSON.stringify({ url: 'https://branch:4318', token: 'a'.repeat(36) }),
    ' '.repeat(16385),
  ]) {
    expect(() => parseDevicePairing(value)).toThrow();
  }
});

it('distinguishes local-only addresses, network failures, certificate failures and rejected credentials', () => {
  expect(
    connectionFailure({ cause: { code: 'ECONNREFUSED' } }, 'http://127.0.0.1:4318').message,
  ).toContain('كمبيوتر الخادم فقط');
  expect(connectionFailure({ code: 'ETIMEDOUT' }, 'https://branch:4318').message).toContain(
    'LAN/VPN',
  );
  expect(
    connectionFailure({ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }, 'https://branch:4318')
      .message,
  ).toContain('الشهادة');
  const denied = new Error('[HTTP_401] Device key required');
  expect(connectionFailure(denied, 'https://branch:4318')).toBe(denied);
});
