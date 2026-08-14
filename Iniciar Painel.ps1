$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$healthUrl = 'http://127.0.0.1:4280/api/stats'
$panelUrl = 'http://127.0.0.1:4280'
$expectedVersion = '2026.08.14.3'
Set-Location -LiteralPath $appDir

function Show-NightwatchError([string]$message) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($message, 'NIGHTWATCH', 'OK', 'Error') | Out-Null
}

function Test-NightwatchServer {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false }
}

function Test-NightwatchSensors {
  try {
    $hardware = Invoke-RestMethod -Uri 'http://127.0.0.1:4280/api/hardware' -TimeoutSec 2
    return $hardware.ok -eq $true
  } catch { return $false }
}

function Test-NightwatchVersion {
  try {
    $version = Invoke-RestMethod -Uri 'http://127.0.0.1:4280/api/version' -TimeoutSec 2
    return $version.version -eq $expectedVersion
  } catch { return $false }
}

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $sensorsReady = Test-NightwatchSensors
  $versionReady = Test-NightwatchVersion
  if (-not $isAdmin -and (-not $sensorsReady -or -not $versionReady)) {
    $self = $MyInvocation.MyCommand.Path
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$self`""
    exit 0
  }

  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source

  if (-not (Test-Path (Join-Path $appDir 'node_modules'))) {
    Start-Process -FilePath $npm -ArgumentList 'install' -WorkingDirectory $appDir -Wait -WindowStyle Hidden
  }

  $sensorProject = Join-Path $appDir 'sensor-bridge\SensorBridge.csproj'
  $sensorDll = Join-Path $appDir 'sensor-bridge\bin\Release\net8.0-windows\Nightwatch.SensorBridge.dll'
  if ((Test-Path -LiteralPath $sensorProject) -and -not (Test-Path -LiteralPath $sensorDll)) {
    $dotnet = (Get-Command dotnet.exe -ErrorAction Stop).Source
    & $dotnet build $sensorProject --configuration Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'NÃ£o foi possÃ­vel compilar a ponte de sensores .NET.' }
  }

  if (-not (Test-NightwatchServer) -or -not $versionReady -or ($isAdmin -and -not $sensorsReady)) {
    $listener = Get-NetTCPConnection -LocalPort 4280 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
      if ($owner.CommandLine -like '*server.js*' -and $owner.CommandLine -like '*node*') {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 400
      } else {
        throw 'A porta 4280 está sendo usada por outro programa.'
      }
    }

    Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      Start-Sleep -Milliseconds 500
      if (Test-NightwatchServer) { $ready = $true; break }
    }
    if (-not $ready) { throw 'O servidor local não respondeu após 20 segundos.' }
  }

  Add-Type -AssemblyName System.Windows.Forms
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $target = $screens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X } | Select-Object -Last 1
  if (-not $target) { $target = $screens | Select-Object -First 1 }

  $browserCandidates = @(
    "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
    "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $browser = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $browser) { Start-Process $panelUrl; exit 0 }

  $b = $target.Bounds
  $arguments = @(
    "--app=$panelUrl",
    '--new-window',
    '--start-fullscreen',
    "--window-position=$($b.X),$($b.Y)",
    "--window-size=$($b.Width),$($b.Height)",
    '--no-first-run'
  )
  Start-Process -FilePath $browser -ArgumentList $arguments
} catch {
  Show-NightwatchError "Não foi possível iniciar o painel.`n`n$($_.Exception.Message)"
  exit 1
}
