[CmdletBinding()]
param([string]$Directory = "$env:LOCALAPPDATA\AlnatheerQueue\WindowsSigning")
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($Directory)
if ($target.StartsWith('\\')) { throw 'Use a protected local signing folder' }
$receiptPath = Join-Path $target 'signer.json'
$certificatePath = Join-Path $target 'digital-trendz-internal.cer'
if (Test-Path -LiteralPath $receiptPath) {
  $saved = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($saved.thumbprint -notmatch '^[A-F0-9]{40}$') { throw 'Invalid saved signer' }
  $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$($saved.thumbprint)" -ErrorAction Stop
  if (!$certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) { throw 'Restore the existing signer or plan an explicit trust renewal' }
  if ((Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash -cne $saved.publicCertificateSha256) { throw 'Saved public certificate changed' }
  Write-Output "Existing internal signer retained: $($saved.thumbprint)"
  exit 0
}
if (Test-Path -LiteralPath $certificatePath) { throw 'Existing certificate found without receipt; refusing replacement' }
New-Item -ItemType Directory -Path $target -Force | Out-Null
$certificate = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject 'CN=Digital Trendz,O=Digital Trendz,C=DZ' `
  -FriendlyName 'Digital Trendz - INTERNAL queue signing' `
  -CertStoreLocation 'Cert:\CurrentUser\My' -Provider 'Microsoft Software Key Storage Provider' `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy NonExportable `
  -TextExtension '2.5.29.19={text}' `
  -NotAfter (Get-Date).AddYears(1)
Export-Certificate -Cert $certificate -FilePath $certificatePath -Type CERT | Out-Null
$receipt = [ordered]@{
  trust = 'internal-only'; publisher = 'Digital Trendz'; country = 'DZ'
  thumbprint = $certificate.Thumbprint
  publicCertificateSha256 = (Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash
  expiresAt = $certificate.NotAfter.ToUniversalTime().ToString('o')
  certificate = $certificatePath
}
$receipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
Write-Output ($receipt | ConvertTo-Json)
Write-Output 'No trust stores were changed. Private key stays non-exportable in this Windows account.'
