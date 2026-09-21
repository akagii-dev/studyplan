param([string]$Source = 'src-tauri/target/release/studyplan.exe')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$sourceExe = (Resolve-Path -LiteralPath (Join-Path $root $Source)).Path
$packageDir = Join-Path $root ('release/StudyPlan-update-' + $version)
$archive = $packageDir + '.zip'
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $packageDir 'StudyPlan.exe') -Force
# Windows PowerShell 5.1 requires BOM for Japanese source text.
$scriptText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Update-StudyPlan.ps1') -Raw -Encoding UTF8
[System.IO.File]::WriteAllText((Join-Path $packageDir 'Update-StudyPlan.ps1'), $scriptText, (New-Object System.Text.UTF8Encoding($true)))
@{ product = 'StudyPlan'; version = $version; sha256 = (Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageDir 'update.json') -Encoding UTF8
$cmdText = @(
  '@echo off'
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-StudyPlan.ps1"'
  'pause'
) -join [Environment]::NewLine
$cmdText | Set-Content -LiteralPath (Join-Path $packageDir 'Update.cmd') -Encoding ASCII
$instructions = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update-instructions.txt') -Raw -Encoding UTF8).Replace('{{VERSION}}', $version)
$instructions | Set-Content -LiteralPath (Join-Path $packageDir 'README.txt') -Encoding UTF8
Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $archive -Force
Write-Output $archive
