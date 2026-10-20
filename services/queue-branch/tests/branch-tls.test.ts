import { it, expect } from 'vitest';
import https from 'node:https';
import { randomUUID, randomBytes, X509Certificate } from 'node:crypto';
import {
  createBranchAuthority,
  issueBranchCertificate,
  authorityTrust,
  validateBranchTrust,
  branchFetch,
} from '@saraf/queue-core/branch-tls';

it('creates an offline branch authority and encrypted server keys, isolates trust, checks SANs and rejects expired certificates before credentials are sent', async () => {
  const branchId = randomUUID();
  const authority = await createBranchAuthority(branchId, new Date(Date.now() - 500 * 86400000));
  const leaf = await issueBranchCertificate(authority, '127.0.0.1');
  expect(leaf.key).toContain('BEGIN ENCRYPTED PRIVATE KEY');
  expect(new X509Certificate(leaf.cert).checkIP('127.0.0.1')).toBe('127.0.0.1');
  const trust = authorityTrust(authority);
  expect(leaf.trust).toEqual(trust);
  expect(() => validateBranchTrust({ ...trust, fingerprint: '0'.repeat(64) })).toThrow();
  const wrong = authorityTrust(await createBranchAuthority(randomUUID()));
  let received = 0;
  const server = https.createServer(
    { cert: leaf.cert, key: leaf.key, passphrase: leaf.passphrase },
    (req, res) => {
      received++;
      res.end(JSON.stringify({ authorization: req.headers.authorization }));
    },
  );
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const url = `https://127.0.0.1:${port}`;
  try {
    await expect(
      branchFetch(url, { headers: { authorization: 'Bearer test-only' } }, wrong),
    ).rejects.toThrow();
    await expect(branchFetch(`https://localhost:${port}`, {}, trust)).rejects.toThrow();
    expect(received).toBe(0);
    expect(
      await (
        await branchFetch(url, { headers: { authorization: 'Bearer test-only' } }, trust)
      ).json(),
    ).toEqual({ authorization: 'Bearer test-only' });
    expect(received).toBe(1);
    await expect(branchFetch(url)).rejects.toThrow();
    expect(() => branchFetch('http://127.0.0.1', {}, trust)).toThrow('HTTPS');
    const expired = await issueBranchCertificate(
      authority,
      '127.0.0.1',
      new Date(Date.now() - 400 * 86400000),
    );
    server.setSecureContext({
      cert: expired.cert,
      key: expired.key,
      passphrase: expired.passphrase,
    });
    server.setTicketKeys(randomBytes(48));
    server.closeAllConnections();
    await expect(
      branchFetch(url, { headers: { authorization: 'Bearer test-only' } }, trust),
    ).rejects.toThrow();
    expect(received).toBe(1);
    const renewed = await issueBranchCertificate(authority, '127.0.0.1');
    expect(renewed.trust.fingerprint).toBe(trust.fingerprint);
    expect(renewed.key).not.toBe(leaf.key);
    await expect(issueBranchCertificate(authority, '../../other')).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 30000);
