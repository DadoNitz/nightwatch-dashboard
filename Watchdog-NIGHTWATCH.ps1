$ErrorActionPreference = 'SilentlyContinue'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $appDir 'Iniciar Painel.ps1'
$failures = 0

while ($true) {
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:4280/api/version' -TimeoutSec 2
    if ($response.version) { $failures = 0 } else { $failures++ }
  } catch { $failures++ }

  if ($failures -ge 3) {
    Start-Process -FilePath 'powershell.exe' -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -ServerOnly" -WindowStyle Hidden
    $failures = 0
    Start-Sleep -Seconds 20
  }
  Start-Sleep -Seconds 10
}
