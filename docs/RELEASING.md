# リリース手順

公開を依頼された場合に実施する。既公開リリースやタグは書き換えない。

1. Gitの作業状態とリモートを確認し、未コミット変更を保護する。
2. `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`と対応する`Cargo.lock`のアプリ版を揃える。
3. READMEの最新版リンクを更新する。変更履歴はルートの`CHANGELOG.md`へ追記し、公開文は`docs/release-vX.Y.Z.md`に短く記載する。検証詳細は`docs/VALIDATION.md`へ分ける。
4. 関連テスト・型検査・lint・通常ビルドを確認し、`pnpm desktop:build`でWindows版を作成する。配布EXEの起動試験は隔離Windowsアカウントでのみ行う。未実施は検証記録に明記する。
5. `src-tauri/target/release/studyplan.exe`を`release/StudyPlan-X.Y.Z.exe`へコピーし、`./scripts/package-update.ps1`で更新ZIPを作る。
6. `scripts/test-update.ps1`へ新パッケージのディレクトリと旧版EXEを渡し、隔離した複製で更新を確認する。利用者のEXEやSQLiteへ直接適用しない。
7. ソース・文書だけをコミットし、`vX.Y.Z`をタグ付けしてpushする。
8. GitHub ReleasesにEXEとZIPだけを添付し、公開文は`--notes-file`で渡す。公開状態・添付ファイルを確認する。mainのpushでデモ配信が走るため、その結果も確認する。

公開コマンド例（版番号は実際のものへ置換）：

```powershell
gh release create vX.Y.Z release/StudyPlan-X.Y.Z.exe release/StudyPlan-update-X.Y.Z.zip --verify-tag --title 'StudyPlan vX.Y.Z' --notes-file docs/release-vX.Y.Z.md
```

CMDランチャーおよび独立した`SHA256SUMS.txt`は今後生成・添付しない。ZIPの内容は`StudyPlan.exe`、`Update-StudyPlan.ps1`、`update.json`、`README.txt`の4ファイルだけにする。`update.json`内のSHA-256は破損検知に必要なので維持する。古い作業ディレクトリに残ったファイルはZIPへ混入させない。

パッケージ生成だけを試験する場合は`-OutputDirectory .test-data/任意の検証フォルダー`を指定できる。既公開のローカル配布物を上書きせず検証する。
