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
@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-StudyPlan.ps1"
pause
'@ | Set-Content -LiteralPath (Join-Path $packageDir 'Update.cmd') -Encoding ASCII
@"
StudyPlan v$version 更新パッケージ

1. StudyPlan を閉じます。
2. ZIP 全体を展開します。
3. Update.cmd を開き、これまで使っていた StudyPlan の実行ファイルを選びます。
4. 完了後、いつもの実行ファイルから起動します。

登録済みの設定・計画・実績は端末の SQLite に残ります。データ形式の移行は不要です。
更新前の実行ファイルは同じ場所に .previous-日時 の名前で残します。
元の版へ戻す場合はアプリを閉じ、更新済みの exe を別名にしてから控えを元の exe 名に戻します。
実行ファイルを戻しても、記録データは巻き戻りません。

これは実行ファイル全体を差し替える更新パッケージです。自動更新・通信・差分ダウンロードは行いません。
組織のポリシーでスクリプトが使えない場合は、StudyPlan.exe を現在の実行ファイルの場所へコピーして差し替えてください。
"@ | Set-Content -LiteralPath (Join-Path $packageDir '更新手順.txt') -Encoding UTF8
Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $archive -Force
Write-Output $archive
