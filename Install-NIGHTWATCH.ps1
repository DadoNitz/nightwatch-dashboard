$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $appDir

function Assert-Command([string]$name, [string]$friendly) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "$friendly não encontrado. Instale-o e execute novamente." }
}

Assert-Command 'node.exe' 'Node.js'
Assert-Command 'npm.cmd' 'npm'
if (-not (Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue)) { Write-Warning '.NET SDK não encontrado: sensores avançados serão instalados quando o SDK estiver disponível.' }

if (-not (Test-Path (Join-Path $appDir 'node_modules'))) {
  npm.cmd install --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências Node.js.' }
}

$project = Join-Path $appDir 'sensor-bridge\SensorBridge.csproj'
if ((Test-Path $project) -and (Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue)) {
  dotnet.exe build $project --configuration Release --nologo
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar a ponte de sensores.' }
}

$shell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path $appDir 'NIGHTWATCH.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe')
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $appDir 'Iniciar Painel.ps1')`""
$shortcut.WorkingDirectory = $appDir
$shortcut.IconLocation = "$(Join-Path $appDir 'nightwatch.ico'),0"
$shortcut.Description = 'NIGHTWATCH // System Intelligence'
$shortcut.Save()

$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
New-Item -ItemType Directory -Force -Path $startup | Out-Null
Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $startup 'NIGHTWATCH.lnk') -Force

$watchdogPath = Join-Path $startup 'NIGHTWATCH-Watchdog.lnk'
$watchdog = $shell.CreateShortcut($watchdogPath)
$watchdog.TargetPath = (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe')
$watchdog.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $appDir 'Watchdog-NIGHTWATCH.ps1')`""
$watchdog.WorkingDirectory = $appDir
$watchdog.IconLocation = "$(Join-Path $appDir 'nightwatch.ico'),0"
$watchdog.Description = 'NIGHTWATCH // Local node watchdog'
$watchdog.Save()

Write-Host 'NIGHTWATCH instalado com inicializacao automatica e watchdog local.' -ForegroundColor Green
