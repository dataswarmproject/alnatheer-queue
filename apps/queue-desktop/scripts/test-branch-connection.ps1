[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$BranchUrl)
$ErrorActionPreference = 'Stop'
$endpoint = [Uri]$BranchUrl
$loopback = $endpoint.Host -in @('localhost','127.0.0.1','[::1]','::1')
if ((!$endpoint.IsAbsoluteUri) -or ($endpoint.Scheme -ne 'https' -and !($loopback -and $endpoint.Scheme -eq 'http')) -or
    $endpoint.UserInfo -or $endpoint.Query -or $endpoint.Fragment -or $endpoint.AbsolutePath -ne '/') {
  throw 'Use a root HTTPS branch URL without credentials. HTTP is allowed only on loopback.'
}
$addresses = [System.Net.Dns]::GetHostAddresses($endpoint.DnsSafeHost)
if (!$addresses.Count) { throw 'DNS did not resolve the branch host. Check LAN/VPN DNS.' }
$client = New-Object System.Net.Sockets.TcpClient
try {
  $task = $client.ConnectAsync($endpoint.DnsSafeHost, $endpoint.Port)
  if (!$task.Wait(5000) -or !$client.Connected) { throw 'Branch TCP port unavailable. Check route, VPN, server binding and scoped firewall.' }
} finally { $client.Dispose() }
$oldProtocol = [System.Net.ServicePointManager]::SecurityProtocol
try {
  [System.Net.ServicePointManager]::SecurityProtocol = $oldProtocol -bor [System.Net.SecurityProtocolType]::Tls12
  $health = Invoke-WebRequest -Uri ([Uri]::new($endpoint, '/healthz')) -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0
  $body = $health.Content | ConvertFrom-Json
  if ($health.StatusCode -ne 200 -or $body.ok -ne $true -or !$body.version) { throw 'Unexpected branch health response.' }
  [pscustomobject]@{url=$endpoint.AbsoluteUri; dns=($addresses.IPAddressToString -join ','); tcp='passed';
    health='passed'; version=$body.version; certificateChecks=$(if ($endpoint.Scheme -eq 'https') {'verified'} else {'loopback-http'});
    note='Read-only check. Pairing permissions and real printing/HDMI/sync require application tests.'} | ConvertTo-Json
} finally { [System.Net.ServicePointManager]::SecurityProtocol = $oldProtocol }
