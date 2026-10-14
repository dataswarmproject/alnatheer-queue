function windowsSigning(env = process.env) {
  const thumb = env.QUEUE_SIGNING_CERT_SHA1 || '';
  const file = env.WIN_CSC_LINK || env.CSC_LINK || '';
  const publisher = (env.QUEUE_SIGNING_PUBLISHER || env.QUEUE_UPDATE_PUBLISHER_NAME || '').trim();
  const mode = env.QUEUE_SIGNING_MODE || (thumb || file || publisher ? 'public' : 'none');
  if (!['none', 'internal', 'public'].includes(mode))
    throw new Error('Invalid Windows signing mode');
  if (mode === 'none') {
    if (thumb || file || publisher || env.QUEUE_REQUIRE_WINDOWS_SIGNATURE === '1')
      throw new Error('Windows signing is required; configure a certificate and publisher');
    return {
      enabled: false,
      mode,
      publisher: '',
      certificateSha1: '',
      win: { signExecutable: false },
    };
  }
  if (!publisher || publisher.length > 200 || /[\r\n]/.test(publisher))
    throw new Error('Configure the exact certificate publisher name');
  if (!thumb && !file) throw new Error('Configure a Windows signing certificate');
  if (thumb && !/^[a-fA-F0-9]{40}$/.test(thumb)) throw new Error('Invalid certificate thumbprint');
  if (thumb && file) throw new Error('Select only one signing credential source');
  if (mode === 'internal' && !thumb)
    throw new Error('Internal signing uses a non-exportable Windows certificate-store key');
  const certificateSha1 = thumb.toUpperCase();
  return {
    enabled: true,
    mode,
    publisher,
    certificateSha1,
    win: {
      signExecutable: true,
      signtoolOptions: {
        publisherName: publisher,
        ...(certificateSha1 ? { certificateSha1 } : {}),
        signingHashAlgorithms: ['sha256'],
        rfc3161TimeStampServer: 'http://timestamp.digicert.com',
      },
    },
  };
}
module.exports = { windowsSigning };
