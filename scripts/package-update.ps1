param(
    [string]$Source = 'src-tauri/target/release/studyplan.exe',
    [string]$OutputDirectory = 'release'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$sourceExe = (Resolve-Path -LiteralPath (Join-Path $root $Source)).Path
$packageDir = Join-Path (Join-Path $root $OutputDirectory) ('StudyPlan-update-' + $version)
$archive = $packageDir + '.zip'
New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $packageDir 'StudyPlan.exe') -Force
# Windows PowerShell 5.1 requires BOM for Japanese source text.
$scriptText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Update-StudyPlan.ps1') -Raw -Encoding UTF8
[System.IO.File]::WriteAllText((Join-Path $packageDir 'Update-StudyPlan.ps1'), $scriptText, (New-Object System.Text.UTF8Encoding($true)))
@{ product = 'StudyPlan'; version = $version; sha256 = (Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256).Hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageDir 'update.json') -Encoding UTF8
$instructions = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update-instructions.txt') -Raw -Encoding UTF8).Replace('{{VERSION}}', $version)
$instructions | Set-Content -LiteralPath (Join-Path $packageDir 'README.txt') -Encoding UTF8
# Explicit entries prevent obsolete launchers/checksum files from a prior build leaking into the ZIP.
$entries = @('StudyPlan.exe', 'Update-StudyPlan.ps1', 'update.json', 'README.txt') |
    ForEach-Object { Join-Path $packageDir $_ }
Compress-Archive -LiteralPath $entries -DestinationPath $archive -Force
Write-Output $archive
