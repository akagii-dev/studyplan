param([switch]$Publish)
# インストーラーを作成し、-Publish でタグ付け・push・GitHub Releases への公開まで行う。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Fail([string]$Message) { Write-Error $Message; exit 1 }
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { Fail ("失敗しました: $Command " + ($Arguments -join ' ')) }
}

# 1. 4か所の版番号が揃っていることを確認する。
$version = (Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version
$versions = [ordered]@{
    'package.json'              = $version
    'src-tauri/tauri.conf.json' = (Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version
    'src-tauri/Cargo.toml'      = [regex]::Match((Get-Content -LiteralPath 'src-tauri/Cargo.toml' -Raw), '(?m)^version = "([^"]+)"').Groups[1].Value
    'src-tauri/Cargo.lock'      = [regex]::Match((Get-Content -LiteralPath 'src-tauri/Cargo.lock' -Raw), '(?m)^name = "studyplan"\r?\nversion = "([^"]+)"').Groups[1].Value
}
$mismatch = $versions.GetEnumerator() | Where-Object { $_.Value -ne $version }
if ($mismatch) { Fail ('版番号が揃っていません: ' + (($versions.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')) }
$tag = "v$version"

# 2. CHANGELOG の対象版から公開文を作る。
$changelog = Get-Content -LiteralPath 'CHANGELOG.md' -Raw -Encoding UTF8
$section = [regex]::Match($changelog, "(?ms)^## $([regex]::Escape($tag)) の変更\r?\n(.*?)(?=^## |\z)")
if (-not $section.Success) { Fail "CHANGELOG.md に「## $tag の変更」がありません。" }
New-Item -ItemType Directory -Path '.test-data' -Force | Out-Null
$notes = Join-Path $root '.test-data/release-notes.md'
[System.IO.File]::WriteAllText($notes, $section.Groups[1].Value.Trim() + "`n", (New-Object System.Text.UTF8Encoding($false)))

# 3. 追跡ファイルに未コミット変更がないことを確認する。
if (git status --porcelain --untracked-files=no) { Fail '未コミットの変更があります。コミットしてから実行してください。' }

# 4. インストーラーを作成し release/ へ置く。
Invoke-Checked 'pnpm' @('desktop:build')
$built = "src-tauri/target/release/bundle/nsis/StudyPlan_${version}_x64-setup.exe"
if (-not (Test-Path -LiteralPath $built)) { Fail "インストーラーが見つかりません: $built" }
New-Item -ItemType Directory -Path 'release' -Force | Out-Null
$installer = "release/StudyPlan-$version-setup.exe"
Copy-Item -LiteralPath $built -Destination $installer -Force
Write-Output ("作成しました: $installer  SHA256 " + (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash)
if (-not $Publish) { Write-Output '公開する場合は pnpm release -Publish を実行してください。'; exit 0 }

# 5. main の最新状態からだけ公開し、既存のタグ・リリースは書き換えない。
if ((git branch --show-current) -ne 'main') { Fail 'main ブランチで実行してください。' }
Invoke-Checked 'git' @('fetch', 'origin', '--tags')
if (git tag --list $tag) { Fail "$tag は既に存在します。" }
Invoke-Checked 'git' @('merge-base', '--is-ancestor', 'origin/main', 'HEAD')
Invoke-Checked 'git' @('tag', $tag)
Invoke-Checked 'git' @('push', 'origin', 'main', $tag)
Invoke-Checked 'gh' @('release', 'create', $tag, $installer, '--verify-tag', '--title', "StudyPlan $tag", '--notes-file', $notes)
Invoke-Checked 'gh' @('release', 'view', $tag, '--json', 'tagName,isDraft,isPrerelease,assets', '--jq', '{tag: .tagName, draft: .isDraft, prerelease: .isPrerelease, assets: [.assets[].name]}')
