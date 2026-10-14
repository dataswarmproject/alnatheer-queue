import * as tls from 'node:tls';

// Node fetch does not automatically inherit the Windows enterprise CA store.
// Add IT-approved system roots before the first connection, preserving bundled roots.
export function useWindowsNetworkTrust() {
  if (process.platform !== 'win32') return;
  if (typeof tls.setDefaultCACertificates !== 'function')
    throw new Error('Windows network trust requires Node 22.19+ or the bundled desktop runtime');
  tls.setDefaultCACertificates([
    ...tls.getCACertificates('default'),
    ...tls.getCACertificates('system'),
  ]);
}
