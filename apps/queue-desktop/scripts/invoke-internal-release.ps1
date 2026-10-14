[CmdletBinding()]
param(
  [string]$SignerReceipt = "$env:LOCALAPPDATA\AlnatheerQueue\WindowsSigning\signer.json",
  [string]$ExpectedCommit = '',
  [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$checkout = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
function Invoke-Checked([string]$Command, [string[]]$CommandArgs) {
  & $Command @CommandArgs
  if ($LASTEXITCODE -ne 0) { throw "Release step failed: $Command" }
}
Push-Location -LiteralPath $checkout
try {
  $repo = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
  if ($repo.name -ne 'alnatheer-queue') { throw 'Run the release from the dedicated queue repository' }
  $remote = & git remote get-url origin
  if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^https://github\.com/dataswarmproject/alnatheer-queue(?:\.git)?$') { throw 'Unexpected release repository' }
  $dirty = & git status --porcelain
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit reviewed source before building a release' }
  $branch = & git branch --show-current
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect release checkout' }
  if ($ExpectedCommit) {
    if ($ExpectedCommit -notmatch '^[a-f0-9]{40}$' -or (& git rev-parse HEAD) -cne $ExpectedCommit) { throw 'Checkout differs from the reviewed workflow commit' }
    & git merge-base --is-ancestor HEAD origin/main
    if ($LASTEXITCODE -ne 0) { throw 'Workflow commit must belong to reviewed main' }
  } elseif ($branch -cne 'main') { throw 'Build reviewed main only' }
  $version = (Get-Content -LiteralPath 'apps/queue-desktop/package.json' -Raw | ConvertFrom-Json).version
  if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A stable release version is required' }
  foreach ($package in @('packages/queue-core/package.json','services/queue-branch/package.json')) {
    if ((Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version -cne $version) { throw 'Package versions differ' }
  }
  $coreSource = Get-Content -LiteralPath 'packages/queue-core/src/server.ts' -Raw
  if ($coreSource -notmatch "queueVersion = '([0-9.]+)'" -or $Matches[1] -cne $version) {
    throw 'Reported branch-service version differs from installer version'
  }
  $record = Get-Content -LiteralPath $SignerReceipt -Raw | ConvertFrom-Json
  if ($record.trust -cne 'internal-only' -or $record.publisher -cne 'Digital Trendz') { throw 'Unexpected internal signer receipt' }
  $env:QUEUE_SIGNING_MODE = 'internal'
  $env:QUEUE_SIGNING_PUBLISHER = $record.publisher
  $env:QUEUE_SIGNING_CERT_SHA1 = $record.thumbprint
  $env:QUEUE_REQUIRE_WINDOWS_SIGNATURE = '1'
  Invoke-Checked 'powershell.exe' @('-NoProfile','-NonInteractive','-File','apps/queue-desktop/scripts/check-signing-readiness.ps1')
  $cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$($record.thumbprint)"
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  try {
    if (!$chain.Build($cert)) { throw 'Approve and deploy the pinned public certificate on this signing account before building' }
  } finally { $chain.Dispose() }
  if ((Get-FileHash -LiteralPath $record.certificate -Algorithm SHA256).Hash -cne $record.publicCertificateSha256) { throw 'Public certificate fingerprint changed' }
  Invoke-Checked 'pnpm.cmd' @('install','--frozen-lockfile')
  Invoke-Checked 'pnpm.cmd' @('exec','prettier','--check','packages/queue-core/**/*.{ts,json}','services/queue-branch/**/*.{ts,json}','apps/queue-desktop/src/**/*.{ts,tsx,css}','apps/queue-desktop/scripts/*.{cjs,json}','apps/queue-desktop/tests/*.cjs')
  Invoke-Checked 'pnpm.cmd' @('typecheck')
  Invoke-Checked 'pnpm.cmd' @('test')
  Invoke-Checked 'pnpm.cmd' @('audit','--prod','--audit-level=high')
  Invoke-Checked 'pnpm.cmd' @('build')
  Invoke-Checked 'node.exe' @('apps/queue-desktop/scripts/prepare-voice-library.cjs')
  foreach ($suite in @('test:setup','test:devices','test:manager','test:tickets','test:audio-controls')) {
    Invoke-Checked 'pnpm.cmd' @('--filter','@saraf/queue-desktop',$suite)
  }
  Invoke-Checked 'pnpm.cmd' @('package:win')
  Invoke-Checked 'pnpm.cmd' @('--filter','@saraf/queue-desktop','test:package')
  Invoke-Checked 'node.exe' @('apps/queue-desktop/scripts/verify-windows-signatures.cjs')
  Invoke-Checked 'pnpm.cmd' @('--filter','@saraf/queue-desktop','release:sign')
  $release = Join-Path $checkout 'apps/queue-desktop/release'
  Copy-Item -LiteralPath $record.certificate -Destination (Join-Path $release 'digital-trendz-internal.cer') -Force
  [ordered]@{trust='internal-only'; publisher=$record.publisher; thumbprint=$record.thumbprint;
    publicCertificateSha256=$record.publicCertificateSha256; expiresAt=$record.expiresAt} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $release 'publisher-trust.json') -Encoding UTF8
  if ($Publish) {
    $private = & gh.exe repo view dataswarmproject/alnatheer-queue --json isPrivate --jq '.isPrivate'
    if ($LASTEXITCODE -ne 0 -or $private -cne 'true') { throw 'Internal releases require the private repository' }
    $tag = "queue-v$version"
    $tagCommit = & git rev-parse "refs/tags/$tag"
    if ($LASTEXITCODE -ne 0 -or $tagCommit -cne (& git rev-parse HEAD)) { throw 'Create the reviewed version tag at this exact commit and push it first' }
    Invoke-Checked 'gh.exe' @('release','create',$tag,(Join-Path $release "alnatheer-queue-$version-windows-x64.exe"),
      (Join-Path $release 'queue-release.json'),(Join-Path $release 'digital-trendz-internal.cer'),(Join-Path $release 'publisher-trust.json'),
      '--repo','dataswarmproject/alnatheer-queue','--verify-tag','--title',"Alnatheer Queue $version - internal trust",'--generate-notes')
  }
  Write-Output 'Internal signed release prepared. Each branch PC needs approved publisher trust. Public SmartScreen reputation is unchanged.'
} finally { Pop-Location }
