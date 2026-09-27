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

## LAN版のローカル配信

同じcheckoutの更新済みDesktopと併用する。旧配布版はLANからの外部更新通知を持たない。Node.js（22.19以降）、pnpm、Rustの既存開発環境が必要。Desktopで一度起動して作られたSQLiteを利用し、存在しない保存先へ空データを作らない。既存SQLiteの未入力状態はLANでも初期設定から利用できる。

```powershell
pnpm lan:build
pnpm lan:start
pnpm lan:status
pnpm lan:stop
```

`lan:build`は`dist-lan`とreleaseの保存ブリッジを作成する。`lan:start`が表示する接続リンクを、同じLANのiPhoneで開く。リンクの`#key=...`は接続権限を持つので共有範囲を限定する。キーは画面読込後にURLから消し、ブラウザーへ接続用として保存する。静的JSには埋め込まない。ブラウザー保存が拒否される場合も開いている間はメモリで接続できる。ホーム画面等でキーを引き継がない場合は、最初の接続画面から入力できる。

HTTPの配信先は`http://<WindowsのLAN IPv4>:4178/studyplan-lan/`。複数NICでは`$env:STUDYPLAN_LAN_IP='192.168.x.x'`を明示する。前回と異なるIP・DB・ポートを自動採用しない。固定運用はルーター側で既存PCのDHCP予約等を設定する。オリジン変更時は接続キーの再入力が必要だが、学習データは引き続き同じWindows SQLiteにある。

通常保存先は`%APPDATA%\jp.local.studyplan\studyplan.sqlite3`。NodeはTauri configのidentifierから解決し、ブラウザーに保存パスを指定させない。Desktopが閉じていても、配信ホストとWindowsが動いていれば利用できる。Desktopも同じ版の保存・計算契約を使うこと。旧PWAのAppStateを無断で取り込まない。

管理状態と接続キーはGit対象外の`.test-data/lan-host/`。静的配信は同フォルダーの検証済みreleaseファイルだけに限定し、元リポジトリ・SQLite・バックアップ・管理状態を公開しない。APIはキー・完全一致のHost/Origin・JSON・サイズ制限を確認し、CORSを許可しない。管理口4180はloopbackのみ。停止は管理tokenと起動IDを照合した自己プロセスだけを対象にする。Tailscale/Funnel、ルーター、ファイアウォールは変更しない。

HTTPは信頼できる個人LANで使う。暗号化は提供しない。iPhoneの通常LAN HTTPではService Workerやオフライン起動を利用できない。保存にはWindowsへの接続が必要で、通信断中に端末へ記録を保存したようには表示しない。接続できない場合は配信状態、Wi-Fi、Windowsの既存LAN向け4178許可を確認する。

フロント更新だけなら再build後の`lan:start`で検証済みファイルへ切り替わる。保存ブリッジ更新時は`lan:stop`→`lan:start`。同時利用中の旧タブは閉じて新しい版を開く。学習データは削除しない。

### LAN API

すべて`POST /studyplan-lan/api/<操作>`、`Authorization: Bearer <接続キー>`、JSON body。成功は`{ok:true,value}`、失敗は`{ok:false,error,code?}`。保存競合409、キー不正401、接続元不正403、不正データ422、サイズ超過413。API応答は常に`no-store`。

| 操作 | 入力 | 結果 |
| --- | --- | --- |
| load_state / revision | `{}` | Envelopeまたはnull／revision数値 |
| commit_state | data, expected, requestId | 保存済みEnvelope |
| export_backup | `{}` | 既存StudyPlanBackup packet |
| validate_backup | text | 検証成功、状態変更なし |
| load_restore_point | `{}` | 復元前のdata・savedAtまたはnull |
| restore_backup / undo_restore | expected, requestId（restoreはtextも） | 退避を伴う保存済みEnvelope |

`pnpm verify:lan`は専用DBとデバッグブリッジで検証し、通常SQLiteを使用しない。iOS Safari／ホーム画面の確認結果は[動作確認記録](VALIDATION.md)を参照。
