[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string[]]$Files,
  [Parameter(Mandatory=$true)][string]$Publisher,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$Thumbprint,
  [ValidateSet('internal','public')][string]$Mode = 'internal'
)
$ErrorActionPreference = 'Stop'
# A PowerShell 7 parent can pass its module paths to Windows PowerShell.
# Load the security module belonging to this verifier's actual host.
$securityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
if (Test-Path -LiteralPath $securityModule) { Import-Module $securityModule -ErrorAction Stop }
foreach ($file in $Files) {
  $resolved = (Resolve-Path -LiteralPath $file).Path
  $signature = Get-AuthenticodeSignature -FilePath $resolved
  $cert = $signature.SignerCertificate
  if (!$cert -or $cert.Thumbprint -ine $Thumbprint -or $cert.GetNameInfo('SimpleName',$false) -cne $Publisher) {
    throw "Expected publisher signature missing: $resolved"
  }
  if ($Mode -eq 'public' -and $cert.Subject -ceq $cert.Issuer) { throw 'Self-signed certificate cannot satisfy public release signing' }
  if (!$signature.TimeStamperCertificate) { throw "Timestamp missing: $resolved" }
  if ($signature.Status -ne 'Valid') { throw "Windows trust validation failed: $($signature.Status). Deploy the pinned public certificate on the signing machine for internal builds." }
  Write-Output ("Valid timestamped signature: {0}; publisher={1}; thumbprint={2}; trust={3}" -f $resolved,$Publisher,$cert.Thumbprint,$Mode)
}
