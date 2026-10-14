[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ($env:QUEUE_SIGNING_MODE -notin @('internal','public') -or !$env:QUEUE_SIGNING_PUBLISHER `
    -or $env:QUEUE_SIGNING_CERT_SHA1 -notmatch '^[A-Fa-f0-9]{40}$') {
  throw 'Configure signing mode, exact publisher name and certificate thumbprint'
}
$cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$env:QUEUE_SIGNING_CERT_SHA1" -ErrorAction Stop
if (!$cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date) -or $cert.NotBefore -gt (Get-Date)) {
  throw 'Signing certificate is not current or has no private key in this Windows account'
}
if ($cert.GetNameInfo('SimpleName',$false) -cne $env:QUEUE_SIGNING_PUBLISHER) { throw 'Certificate publisher differs from configuration' }
$eku = $cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' }
if (!($eku.EnhancedKeyUsages | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' })) { throw 'A code-signing certificate is required' }
if ($env:QUEUE_SIGNING_MODE -eq 'internal') {
  if ($cert.Subject -cne $cert.Issuer) { throw 'Internal workflow expects the explicitly deployed self-signed publisher' }
} elseif ($cert.Subject -ceq $cert.Issuer) { throw 'A self-signed certificate is not public publisher validation' }
Write-Output "Signing key available for $env:QUEUE_SIGNING_PUBLISHER; mode=$env:QUEUE_SIGNING_MODE. Client trust must be deployed separately."
