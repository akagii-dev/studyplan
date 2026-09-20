param([string]$TargetPath, [switch]$NonInteractive)
$ErrorActionPreference = 'Stop'
try {
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $payload = Join-Path $PSScriptRoot 'StudyPlan.exe'
    if ($manifest.product -ne 'StudyPlan' -or $manifest.sha256 -notmatch '^[0-9A-Fa-f]{64}$') { throw '更新パッケージが正しくありません。' }
    if ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash -ne $manifest.sha256) { throw '更新ファイルが破損しています。もう一度展開してください。' }
    if ([version](Get-Item -LiteralPath $payload).VersionInfo.FileVersion -ne [version]$manifest.version) { throw '更新パッケージのバージョンが一致しません。' }
    if (!$TargetPath) {
        if ($NonInteractive) { throw '更新する実行ファイルを指定してください。' }
        Add-Type -AssemblyName System.Windows.Forms
        $picker = New-Object System.Windows.Forms.OpenFileDialog
        $picker.Title = '現在使っている StudyPlan の実行ファイルを選択'
        $picker.Filter = 'StudyPlan 実行ファイル (*.exe)|*.exe'
        if ($picker.ShowDialog() -ne 'OK') { Write-Output '更新を中止しました。'; exit 0 }
        $TargetPath = $picker.FileName
    }
    $target = (Get-Item -LiteralPath $TargetPath).FullName
    if ($target -eq (Get-Item -LiteralPath $payload).FullName) { throw '更新パッケージの中ではなく、これまで使っていた実行ファイルを選んでください。' }
    $targetInfo = (Get-Item -LiteralPath $target).VersionInfo
    if (!$targetInfo.ProductName) { throw '実行ファイルを読み取れません。StudyPlan を閉じてから、もう一度選択してください。' }
    if ($targetInfo.ProductName -ne 'StudyPlan') { throw 'StudyPlan の実行ファイルではありません。' }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $manifest.sha256) { Write-Output 'このバージョンに更新済みです。'; exit 0 }
    if ([version]$targetInfo.FileVersion -gt [version]$manifest.version) { throw '現在のアプリより古い更新パッケージです。' }
    if (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target }) { throw 'StudyPlan を閉じてから、もう一度更新してください。' }
    $folder = Split-Path -Parent $target
    $token = [guid]::NewGuid().ToString('N')
    $staging = Join-Path $folder ('.studyplan-update-' + $token + '.exe')
    $backup = $target + '.previous-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $token.Substring(0, 8)
    try {
        Copy-Item -LiteralPath $payload -Destination $staging
        if ((Get-FileHash -LiteralPath $staging -Algorithm SHA256).Hash -ne $manifest.sha256) { throw '更新ファイルの書き込みを確認できませんでした。' }
        # Replace only the selected executable, atomically. SQLite and settings are untouched.
        [System.IO.File]::Replace($staging, $target, $backup)
    } finally {
        if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging }
    }
    Write-Output ('StudyPlan v' + $manifest.version + ' に更新しました。設定・計画・実績はそのまま使えます。')
    Write-Output ('旧実行ファイルの控え: ' + $backup)
    Write-Output 'いつもの実行ファイルから起動してください。'
} catch {
    Write-Error ('更新できませんでした: ' + $_.Exception.Message) -ErrorAction Continue
    exit 1
}
