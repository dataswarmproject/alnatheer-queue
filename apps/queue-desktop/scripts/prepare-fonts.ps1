param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fontZip=[System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive).Path)
try {
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetFullPath($Destination)) | Out-Null
  foreach($weight in @('Regular','Medium','Bold','Black','Light')) {
    $name='thmanyahsans-'+$weight+'.woff2'
    $entry=@($fontZip.Entries | Where-Object { [System.IO.Path]::GetFileName($_.FullName) -ceq $name })
    if($entry.Count -ne 1 -or $entry[0].Length -gt 1048576){throw 'Missing or ambiguous original Sans font'}
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry[0],[System.IO.Path]::Combine($Destination,$name),$true)
  }
  $licence=@($fontZip.Entries | Where-Object { $_.FullName -ceq 'LICENSE.pdf' })
  if($licence.Count -ne 1){throw 'Original font licence missing'}
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($licence[0],[System.IO.Path]::Combine($Destination,'Thmanyah-LICENSE.pdf'),$true)
} finally { $fontZip.Dispose() }
