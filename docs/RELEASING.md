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

## LAN内のPWA配信

この配信はデスクトップ版リリースとは別に、同じPCのLAN内へPWAビルドを置く。通常利用のSQLiteやバックアップは使用しない。配信前に`pnpm pwa:build`を実行し、`dist-pwa/release-files.json`に列挙されたファイルだけをハッシュ照合して`.test-data/pwa-host/releases/`へ複製する。接続確認用の`release-files.json`も公開するが、内容はビルドIDと配信ファイル名・ハッシュだけに正規化する。配信元の余分なファイル、データベース、秘密ファイル、シンボリックリンクは公開しない。

```powershell
pnpm pwa:build
pnpm pwa:start
pnpm pwa:status
pnpm pwa:stop
```

`pwa:start`はこのPCのLANアドレスを使い、`http://<LANアドレス>:4178/studyplan-pwa/`で配信する。LANアドレスが複数ある場合は、使用するアドレスを`PWA_LAN_IP`環境変数に指定する。初回のアドレスを保存し、変更後は同じブラウザー保存領域と見なせないため自動で別URLへ切り替えない。更新時は同じURLで配信先だけを切り替える。停止操作は端末内の管理口と秘密トークン、プロセス識別を照合し、この配信以外を停止しない。ファイアウォールは自動変更しない。

LAN内の別端末からのHTTP接続ではService Workerは利用できず、PWAのオフライン動作も利用できない。データはアクセスした端末のブラウザーに保存され、PC上のSQLiteとは共有されない。別のIPやHTTPSへURLを変えると、ブラウザー上では別の保存領域になる。正式なPWA利用にはHTTPS配信へ切り替えてから記録を始める。

Tailscale ServeのHTTPS配信を使う場合は`pnpm pwa:https:start`、`pnpm pwa:https:status`、`pnpm pwa:https:stop`を使用する。端末のDNSNameを固定して保存し、`https://<DNSName>:8443/studyplan-pwa/`へ配信する。8443番はこのPWA専用とし、同番ポートのFunnelや他アプリ設定、DNSName変更があれば拒否する。443番など他ポートのServe設定は変更しない。Tailscale未導入の環境では実配信を確認できないため、導入先でURL・更新・停止を別途検証する。

HTTPSへ移す際は、[Windows版](https://tailscale.com/docs/install/windows)と[iPhone版](https://tailscale.com/docs/install/ios)のTailscaleを導入して同じtailnetへログインし、[管理画面のDNS設定](https://tailscale.com/docs/how-to/set-up-https-certificates)でMagicDNSとHTTPS証明書を有効にする。証明書の公開台帳に端末名とtailnet名が載ることへの承認が必要。次にこのPCで`pnpm pwa:https:start`を実行し、表示されたHTTPS URLをiPhoneで開く。Serveの権限や操作は[公式手順](https://tailscale.com/docs/reference/tailscale-cli/serve)を確認する。HTTPとHTTPSは異なる保存領域なので、HTTP側の記録が自動移行されるとは考えない。
