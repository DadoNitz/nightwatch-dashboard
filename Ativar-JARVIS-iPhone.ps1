$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
  exit 0
}

[Environment]::SetEnvironmentVariable('NIGHTWATCH_LAN', '1', 'User')
$env:NIGHTWATCH_LAN = '1'

$ruleName = 'NIGHTWATCH JARVIS Local Network'
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4280 -RemoteAddress LocalSubnet -Profile Private | Out-Null

$listener = Get-NetTCPConnection -LocalPort 4280 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if ($owner.CommandLine -like '*server.js*' -and $owner.CommandLine -like '*node*') { Stop-Process -Id $listener.OwningProcess -Force; Start-Sleep -Milliseconds 500 }
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden
Start-Sleep -Seconds 2
$adapter = Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway -and $_.InterfaceAlias -notmatch 'Radmin|VPN|Virtual|Hyper-V|vEthernet' } | Select-Object -First 1
$ip = $adapter.IPv4Address.IPAddress
if (-not $ip) { throw 'Nao foi possivel localizar o IPv4 da rede local.' }
$url = "http://$($ip):4280/jarvis"
Set-Clipboard $url
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show("JARVIS liberado apenas para a rede privada local.`n`nNo iPhone, abra:`n$url`n`nO endereco foi copiado. Use o codigo de pareamento mostrado no PC.", 'NIGHTWATCH // iPhone', 'OK', 'Information') | Out-Null

