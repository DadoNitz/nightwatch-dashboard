$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$releaseDir = Join-Path (Split-Path $appDir -Parent) 'releases'
$version = (Get-Content (Join-Path $appDir 'package.json') -Raw | ConvertFrom-Json).version
$stage = Join-Path $releaseDir "nightwatch-$version"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
robocopy $appDir $stage /E /XD node_modules .git bin obj captures /XF nightwatch.settings.json NIGHTWATCH.lnk *.log | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'Falha ao preparar release.' }
if (Test-Path (Join-Path $stage 'node_modules')) { Remove-Item -LiteralPath (Join-Path $stage 'node_modules') -Recurse -Force }
$zip = Join-Path $releaseDir "nightwatch-$version-windows.zip"
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host $zip
