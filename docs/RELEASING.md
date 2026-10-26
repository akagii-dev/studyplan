# リリース手順

版番号は、不具合・不便の修正ではpatch、UI変更ではminorを上げる。

公開を依頼された場合に実施する。公開済みリリースの内容とタグは書き換えない。古いリリースはユーザーの指示があれば削除してよい（タグは残す）。配布物はWindows用インストーラー`StudyPlan-X.Y.Z-setup.exe`の1点だけとする。

1. `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`のアプリ版を揃え、`CHANGELOG.md`の「## vX.Y.Z の変更」とREADMEの最新版リンクを更新する。検証の要点は`docs/VALIDATION.md`へ記録する。
2. `pnpm verify`と変更に応じた検証を行い、mainへコミットする。
3. `pnpm release`でインストーラーを作成する。版番号の一致・CHANGELOGの対象版・未コミット変更なしを確認し、`release/StudyPlan-X.Y.Z-setup.exe`と公開文`.test-data/release-notes.md`を作る。
4. `pnpm release -Publish`でタグ付け・main/タグのpush・GitHub Releasesへの公開・添付の確認まで行う。mainのpushでデモ配信が走るため、その結果も確認する。

インストーラー（NSIS）はユーザー単位でインストールし、管理者権限を要求しない。更新は新しい版のインストーラーを実行する。旧版への上書き（ダウングレード）は拒否する。学習データは`%APPDATA%\jp.local.studyplan\`にあり、インストール・更新では変更しない。アンインストール時の「アプリデータを削除する」は既定で無効のまま変更しない。

配布インストーラーの起動・インストール試験は通常アカウントの保存先を使うため、隔離Windowsアカウントでのみ行う。未実施は検証記録に明記する。CMDランチャー・独立した`SHA256SUMS.txt`・更新ZIPは生成・添付しない。

## LAN版のローカル配信

### 配布版から公開する

v0.6.3以降は公開中の設定欄にAPIキー付き接続QRを表示する。ポップアップではなく、設定へ戻って再確認できる。QRはアプリ内で生成し外部送信しない。停止で表示を消し、再開時は新キーへ切り替える。QR画像も接続権限を含むため公開しない。

v0.6.0以降は「設定」→「LAN公開」から開始・停止できる。Node.js・pnpm・Rustは利用者に不要。複数のLAN IPv4がある場合はWi-Fi側を選ぶ。配信先は `http://<選択したIPv4>:4178/studyplan-lan/`。アプリに表示した接続リンクを同じLANのiPhoneで開く。APIキーを知る人は学習データの閲覧・変更・復元ができるため、リンクとキーを公開しない。HTTPは暗号化されず、信頼できる個人LANに限って使う。

公開は明示操作で開始し、選択した接続中のIPv4にのみbindする。private/globalで候補を制限せず、`InterfaceAlias — IPv4`で表示する。デフォルトゲートウェイのある実Wi-Fi/Ethernetを優先し、仮想NICも下位の候補として選択できる。アプリの終了で停止し、次の公開開始時には新しいキーを発行する。キーはメモリ内だけに保持し、AppState・SQLite・バックアップ・ログへ保存しない。Windowsファイアウォール、ルーター、Tailscaleの設定をアプリが変更することはない。接続できない場合はPCとiPhoneのWi-Fi、既存の4178番許可を確認する。

LANファイルはビルド時にallowlistとハッシュを検証してEXEへ内蔵し、実行時にリポジトリやディスク上の任意ファイルを公開しない。`pnpm desktop:build` はLAN資材とDesktop資材を順にビルドする。開発用の直接Cargoビルド前は `pnpm lan:assets` を実行する。テストは専用保存先を指定したdebug版だけで行う。

旧ホストの`node.exe`だけを許可していた場合、その許可は配布版へ引き継がれない。別端末で開けない場合は、Windowsの受信規則をStudyPlanのTCP 4178・利用する同一LANの範囲に限定して確認する。全ポート・インターネット全体への許可は不要。

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

アプリ内のLAN公開は実機試験（`tests/desktop-lan.e2e.ts`）で検証し、通常SQLiteを使用しない。iOS Safari／ホーム画面の確認結果は[動作確認記録](VALIDATION.md)を参照。
