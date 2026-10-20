[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]
param(
  [Parameter(Mandatory=$true)][string]$Certificate,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedSha256,
  [ValidateSet('CurrentUser','LocalMachine')][string]$Scope = 'CurrentUser'
)
$ErrorActionPreference = 'Stop'
$file = [System.IO.Path]::GetFullPath($Certificate)
$hash = [System.Security.Cryptography.SHA256]::Create()
try { $actual = [BitConverter]::ToString($hash.ComputeHash([System.IO.File]::ReadAllBytes($file))).Replace('-','') }
finally { $hash.Clear() }
if ($actual -ine $ExpectedSha256) { throw 'Certificate fingerprint mismatch' }
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($file)
if ($cert.HasPrivateKey -or $cert.GetNameInfo('SimpleName',$false) -cne 'Digital Trendz' `
    -or $cert.Subject -cne $cert.Issuer -or $cert.NotAfter -le (Get-Date) -or $cert.NotBefore -gt (Get-Date)) {
  throw 'Expected a current public-only Digital Trendz internal certificate'
}
$eku = $cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' }
$usage = @($eku.EnhancedKeyUsages | ForEach-Object { $_.Value })
if ($usage.Count -ne 1 -or $usage[0] -ne '1.3.6.1.5.5.7.3.3') { throw 'Certificate must allow code signing only' }
$basic = $cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' }
if ($basic -and $basic.CertificateAuthority) { throw 'Certificate must not be a general-purpose CA' }
if ($PSCmdlet.ShouldProcess("$Scope Root and TrustedPublisher", "Trust only certificate $($cert.Thumbprint) for internal Digital Trendz code signing")) {
  $location = [Enum]::Parse([System.Security.Cryptography.X509Certificates.StoreLocation], $Scope)
  foreach ($storeName in @('Root','TrustedPublisher')) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store -ArgumentList @($storeName,$location)
    try {
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $store.Add($cert)
    } finally { $store.Close() }
  }
  Write-Output "Internal publisher trusted in $Scope. Public SmartScreen reputation is unchanged."
}
