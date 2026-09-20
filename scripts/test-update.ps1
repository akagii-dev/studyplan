param([Parameter(Mandatory=$true)][string]$Package, [Parameter(Mandatory=$true)][string]$OldExe)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testDir = Join-Path $root ('.test-data/update-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testDir | Out-Null
$packageDir = Join-Path $testDir 'package'
Copy-Item -LiteralPath $Package -Destination $packageDir -Recurse
$target = Join-Path $testDir '学習計画 アプリ.exe'
Copy-Item -LiteralPath $OldExe -Destination $target
$dataFile = Join-Path $testDir 'studyplan.sqlite3'
Set-Content -LiteralPath $dataFile -Value 'preserve user data marker' -Encoding UTF8
$dataHash = (Get-FileHash -LiteralPath $dataFile).Hash
$oldHash = (Get-FileHash -LiteralPath $target).Hash
$newHash = (Get-FileHash -LiteralPath (Join-Path $packageDir 'StudyPlan.exe')).Hash
$script = Join-Path $packageDir 'Update-StudyPlan.ps1'
function Invoke-TestUpdate([int]$Expected) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -TargetPath $target -NonInteractive
    if ($LASTEXITCODE -ne $Expected) { throw ('Unexpected updater exit: ' + $LASTEXITCODE) }
}
$lock = [System.IO.File]::Open($target, 'Open', 'Read', 'None')
try { Invoke-TestUpdate 1 } finally { $lock.Dispose() }
if ((Get-FileHash -LiteralPath $target).Hash -ne $oldHash) { throw 'Locked target changed' }
$manifestFile = Join-Path $packageDir 'update.json'
$originalManifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8
$badManifest = $originalManifest | ConvertFrom-Json
$badManifest.sha256 = '0' * 64
$badManifest | ConvertTo-Json | Set-Content -LiteralPath $manifestFile -Encoding UTF8
Invoke-TestUpdate 1
if ((Get-FileHash -LiteralPath $target).Hash -ne $oldHash) { throw 'Corrupt update changed target' }
Set-Content -LiteralPath $manifestFile -Value $originalManifest -Encoding UTF8
Invoke-TestUpdate 0
if ((Get-FileHash -LiteralPath $target).Hash -ne $newHash) { throw 'Update mismatch' }
$backups = @(Get-ChildItem -LiteralPath $testDir -Filter '*.previous-*')
if ($backups.Count -ne 1 -or (Get-FileHash -LiteralPath $backups[0].FullName).Hash -ne $oldHash) { throw 'Backup mismatch' }
Invoke-TestUpdate 0
if (@(Get-ChildItem -LiteralPath $testDir -Filter '*.previous-*').Count -ne 1) { throw 'Duplicate update created another backup' }
if ((Get-FileHash -LiteralPath $dataFile).Hash -ne $dataHash) { throw 'Data changed' }
Write-Output 'Update tests passed: locked target, corrupt payload, atomic replacement, old executable backup, idempotency, data preservation.'
