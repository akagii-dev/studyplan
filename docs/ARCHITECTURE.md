# 責任分離とプロダクト契約

## LAN公開の接続情報

`lan_host::addresses()` → `lan_interfaces.rs` が接続中のIPv4を列挙し、`address`と`interface_alias`を持つ候補を返す。private/globalで制限せず、loopback・link-local（169.254/16）・unspecified・broadcast・multicastを除外する。サブネットのbroadcastも除外するが、/31・/32のpoint-to-pointホストは残す。

Windowsの`GetIfEntry2`からInterfaceAlias・NIC種別・HardwareInterfaceを取得し、`GetIpForwardTable2`のIPv4デフォルトルートをInterfaceIndexで対応付ける。実Wi-Fi/Ethernetかつデフォルトゲートウェイありを先頭とし、仮想・VPN系NICは候補に残して後方へ並べる。仮想判定にはhardware情報、point-to-point、alias/descriptionの既知名を用いる。補助情報を取得できない場合も接続中の有効IPv4とOSのアダプター名は残す。同順位はalias・IPv4順、重複IPv4は優先候補にまとめる。複数候補は明示選択し、再確認で選択済みIPが残っていれば保持する。

Windows APIの参照：[MIB_IF_ROW2](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/ns-netioapi-mib_if_row2)、[GetIpForwardTable2](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/nf-netioapi-getipforwardtable2)。ルート情報は読み取りだけに用い、確保された表は`FreeMibTable`で解放する。

表示は`InterfaceAlias — IPv4`。SSID取得は行わない。開始直前にも候補を再取得して選択IPを照合し、そのIPv4だけへbindする。認証・HTTP・保存境界は従来どおり。候補・公開状態・接続キー・QRはAppState・SQLite・バックアップへ保存しない。Firewall・portproxy・ネットワーク設定は変更しない。

## 進捗と画面の契約

UI変更時の入口。画面の文言ではなく、以下の意味を維持する。

| 状態 | 比較・表示の意味 |
| --- | --- |
| 予定あり・未報告 | 数値集計の実績は0でも、有効な記録なし。不足を0実績として確定しない |
| 明示0・一部実施・完了・超過 | 有効な実績。予定10に対し0/6/10/12なら、過去の不足は10/4/0/0。比率は100%超を許容 |
| 今日・未来 | 今日の未完了は進行中。未来は予定のみ。いずれも過去の不足警告を出さない。未来を未報告扱いしない |
| 比較元なし | 実績のみ、または未報告。不足と比率を推測しない。通常表示へ内部用語を出さない |
| 訂正・取消 | 訂正後の値を全画面に反映し、取消は通常集計から除外。履歴操作以外で別解釈しない |
| 合計 | 教材・周回・日付を照合し、同単位のみ集約。ある教材の超過で他教材の不足を相殺しない |
| 過去の不足 | その日の予定との差であり、現在の残量ではない。再配分しても履歴を消さず、現在の残量へ再加算しない |

共通経路は `calendarQuantity.ts → progressState()/progressView()`。
今日の教材行と週間予定の今日の行は `studyProgressView()` を共有し、あとN単位／✅完了／✅追加N単位へ変換する。日別比較・レポートは従来のprogressViewを維持。仕切り直し後は有効残量と現在の配分基準以降の記録で判定し、予定の移動・基準不明・予定0を完了としない。新しい保存項目は持たない。`TodayStudyProgress`はtodayStudyRowsの同じ表示用目標・記録量を既存AnimatedProgressへ渡す。円型と比較切替は廃止し、今日の教材別直線だけにする。割合は未完了99%まで／完了100%とし、表示の丸めが完了判定を変えない。折畳みは表示だけで、復習・予定外だけの行は対象外。完了行の背景とdetails入力は共通のcompleteを使う。入力は未完了なら常時表示し、完了なら明示的な追加入力の展開状態だけで開く。保存開始時の自動展開と下書きによる自動展開は行わず、記録成功で展開を解除する。閉じる入力内のフォーカスは開閉見出しへ移す。記録後の成功通知は記録量のみ。未配置・要確認・失敗は維持し、実変更の詳細は展開して確認できる。
日別予定量は保存済み `studyDayBaselines`、当日を対象とした確定計画・履歴、再計画が保持した過去セッションから取得する。
今日を対象にしていない計画を「予定0」の根拠にしない。前倒し前の数量を使い、表示切替では保存も再計算も行わない。
`calendarQuantity` が教材・周回・単位別の予定、有効実績、報告有無を照合し、`progressState` が planned / actual / hasReport / deficit / progressRatio / comparisonAvailable / period / reportStatus を決める。
`progressView` はこの状態を短い文言へ変換する。UIは密度だけを選び、独自の未報告・不足判定を持たない。
過去分の「調整済み」は確定計画の反映境界・実績一致・残量保存から `calendarQuantity` が導出する。未報告・不足の比較値は保持し、未配置が残る場合は区別する。案の作成や画面表示だけで反映済みにはせず、未反映の訂正・取消や調整失敗を隠さない。
週間レポートの日別・週別数量もこの経路を使う。生涯の完了量は `completed()`（初期完了数込み）であり、日別実績と混同しない。

| 画面 | 責務と主要操作 |
| --- | --- |
| 今日（Dashboard / TodayRecorder） | 今日の予定がある教材・周回を主入力行にする。予定外記録の入口を保持し、実績だけの行は履歴・進捗へ残す |
| 今後の予定（Future） | 直近の予定、今日・過去の実績との関係。共通切替からカレンダーへ移動。日付見出しは操作を持たない |
| カレンダー | 月・週の俯瞰、未報告・過去の不足の発見、日別詳細。歯車内のField/selectで試験・期間・密度を選ぶ。表示設定は既存compactカードと日付詳細の見出し/閉じるスタイルを再利用。ICS入口は本体下部に1つ。入力UIを複製しない |
| 日付詳細 | 内訳の確認。今日の記録は今日の対象入力へ、過去日は既存の過去日記録へ誘導 |
| 記録履歴（History） | 有効な実績の履歴・訂正・取消。過去日の新規記録への入口 |
| 予定外・過去日の記録（Progress） | 日付を選ぶ必要のある記録の既存補助画面。カレンダー内に再実装しない |
| 週間レポート | 日別と単位別の週集計、出力時点の全体進捗との比較。入力を持たない |

`todayStudyRows()`は共通数量から予定枠・当初予定量・有効残量のある教材/周回だけを主入力行へ選ぶ。予定外実績は`calendarQuantity()`から除外せず、履歴・進捗・週間実績へ維持する。これは表示の選択であり、記録処理・保存・将来の調整は変更しない。今日の日付詳細が実績だけの教材・周回を指定したときは、主入力行を生成せず既存の予定外記録フォームを開いて対象とフォーカスを引き継ぐ。

記録への誘導だけで確定しない。追加数入力への初期値は予定達成までの残量を上限とし、既存実績を再加算しない。
新しい画面もこの境界を再利用する。情報不足を説明や大きなカードの追加だけで補わず、必要な数値と操作を短く示す。

### 変更時の検証

- `pnpm verify`：既存のlint・型検査・単体テスト・通常ビルド。表示画面からの旧実績集計関数の利用、カレンダーへの記録処理の持込みもlintで検出する。
- `pnpm verify:ui`：デモをビルドし、隔離ブラウザーの画面横断テストと`test:calendar-ui`を実行。後者は実カレンダー部品と架空データを使い、ネイティブ保存を模擬してICS内容・下部入口・Tab順・旧一覧指定の月への復帰を確認する。SQLite・保存ダイアログの実機試験の代用ではない。初回は `pnpm exec playwright install chromium`。Windowsで既存Edgeを使う場合のみ `$env:PLAYWRIGHT_CHANNEL='msedge'`。
- `pnpm test:ui`：既存のWindows/Tauri実機テスト。保存・読込・ネイティブ導線を変更した場合に追加実行する。専用SQLite以外を使用しない。

`tests/fixtures/progressContract.ts` を単体テストと `tests/web/progress.spec.ts` が共有する。期待値はselectorの出力から作らず、未報告・0・一部・完了・超過・取消を固定する。
横断テストは今日→今後の予定→カレンダー内容→日付詳細→週間レポート→履歴を同じデータで巡回し、訂正・取消・再読込、安全な記録導線、狭幅、文字間隔、axeを確認する。
CIはPRで同じ検証を実行し、mainのデモ公開も検証成功後に限る。モデル・Skill・Codex固有設定は不要。

レビューは「入力操作の複製」「未報告/0・過去/今日/未来の混同」「取消の混入」「内部用語の露出」を共通経路と実画面で確認する。スクリーンショットも確認し、未実行の実機・支援技術テストを明記する。axeだけでWCAG適合とはしない。

## アプリと保存

### LAN版の保存境界

配布Desktopは`lan_host`のHTTP配信を内蔵する。React設定の`LanSharing`→`desktopLan`→Tauriの開始・状態・停止コマンドで管理し、学習データの状態遷移には参加しない。HTTPの保存操作はCLI helperと同じ`lan_bridge::dispatch`→`Database`→`db/backup`。同じSQLite・CAS・requestId・復元前退避を使用する。LANクライアントのReact/domainはDesktopと同じソースから別modeでビルドし、検証済み静的ファイルだけをEXEへ埋め込む。

公開は明示開始のみ。選択したLAN IPv4の4178番へbindし、停止・アプリ終了で閉じる。ランダムな接続キーは公開開始ごとに発行し、メモリ外へ保存しない。Desktop設定だけで警告とともに表示する。キー・完全一致Host/Origin・要求サイズ等をHTTP境界で検証し、学習データの検証は共通保存境界へ委譲する。CLIホストと相互にプロセスを停止せず、ポート占有時は開始を拒否する。

最新mainのReact UI・AppState・domain・計画処理・保存キューを共用する。Tauriは`store.ts → invoke → db/backup`、LANは`store.ts → lanStore.ts → HTTP → scripts/lan-host.mjs → studyplan_lan_bridge → 同じdb/backup`。WindowsのSQLiteだけが学習データの正本であり、LANブラウザーへ別のAppStateや未送信操作キューを永続化しない。設定・実績・固定・承認済み計画・proposal・履歴・下書きも既存AppStateの意味で保存し、Planのマージや別計算を行わない。

Rust helperは明示した既存SQLiteだけを開き、Tauriと同じ`Database`・スキーマ・`BEGIN IMMEDIATE`・revision・requestId・復元前退避を使う。Node側にはSQLやdomainを複製しない。重複requestIdの応答は`operations.revision`と`audit.data`から元のEnvelopeを返す。他端末の新しいrevisionだけを古い画面へ採用してはならない。

両画面の保存キューは、フォーカス復帰／15秒ごとにrevisionだけを照会する。外部更新時は入力を保持して読み直す入口を表示し、自動置換しない。古いrevisionからの保存は拒否。LAN通信失敗・競合では楽観表示を保存済みにせず、明示的な読み直しまで入力を保持する。再送は同じJSONとrequestIdで1回だけ行う。ブラウザーを閉じる前に保存中・保存未確認を知らせるが、オフライン保存を保証しない。

公開デモのlocalStorage、旧PWAのIndexedDBとは保存領域を共有しない。旧PWAから採用するのは静的配信allowlist・ハッシュ検証・manifest/icon・静的shellキャッシュ・ブラウザー出力の限定コード。旧domain、旧UI、pwaStore、IndexedDB保存・オフライン編集キューは採用しない。HTTPでのUUIDは暗号乱数`getRandomValues`を使用する。

LAN APIと起動手順は[配信手順](RELEASING.md#lan版のローカル配信)。通常のLAN HTTPではService Workerを利用せず、読み書きにはWindowsへの接続が必要。secure contextで使えるshellキャッシュもAPI・学習データを格納せず、公開デモ／旧PWAとはscope・cache名を分離する。

### 実績による通常調整

部分調整は `planning.proposeRemainingAdjustment()` → `remainingAllocation.calculateRemainingAdjustment()` → 既存の `approve()` を通す。対象の有効量は `activePlanWork()`、全体残量は `remaining()` を使用し、保持モードの `generatePlan()` へ対象と順序依存分だけを渡す。`allowReportedDay` はこの明示操作でも有効にし、実績登録を配置放棄と解釈しない。`Proposal.basis` の任意の識別子・対象・影響範囲を拡張し、保存・競合・requestIdの経路は共用する。比較専用枠は `nonComparisonSessions()` で通常表示・案の数量比較・容量表示から外し、後続の全体再計画でもエンジンが占有や作業量へ戻さない。

`remainingWork()` は数量の整合性に加え、共通の `remainingSessionIssue()` による実行可能な配置先・無効枠・未配置理由を返す。時刻以外の条件は `remainingSourceIssue()` で同じ重複・週上限・順序検証を使い、経過だけが理由の非固定残量を `pendingPlacements` / `pending` へ分離する。これは保存項目ではなく、実行可能量・未配置量と重複しない計算上の分類。固定当日枠の純粋な時刻経過は `clockOnly` で識別し、配置調整を促す警告にしない。`usePlanningClock()` は分境界・復帰で表示だけを更新する。今後の予定は残量の内訳セクションを表示せず、`remainingWork()`の数量・配置検証を要確認判定に使う。未配置は共通の`ShortfallDetails`、無効枠は週間行と要確認表示で案内する。対象量の案は `remainingAdjustmentPreview()` で無関係な保持量と分離する。基準不明・破損・計算失敗・数量不整合を未配置へ変換しない。承認でも同じ枠検証と数量保存則を確認し、移動元や完了済み比較枠を新しい実績反映基準に混ぜない。容量の参照は `remainingOccupiedSessions()` で共有し、将来の完了済み比較枠を空き時間・週容量へ二重計上せず、過去・開始済み枠の既存の週占有は維持する。

UIからの調整は `pastRemainingWork()` → `proposePastRemainingAdjustment()` を使い、反映基準に残る昨日以前の未消化分だけを選ぶ。通常繰越後は過去比較枠を選び直さない。今日・未来・未配置分の個別選択と配置先確認欄は撤去し、警告表示には共通の残量・配置判定を使う。保存済み部分案には任意の `purpose: 'past-only'` を付け、従来案の互換を維持する。`validatePastRemainingAllocation()` は今日以降の保持量・日時の不変を検査し、時刻経過だけの保持枠には共通の時刻以外の検証を適用する。新しい配置先には通常の現在時刻検証を適用する。`reproposeRemainingAdjustment()` は元計画・設定・実績のfingerprintを照合し、明示された昨日以前の追加対象と既存対象から案を更新する。別の残量台帳は追加しない。

未消化分の反映も `usePersistentAppState` の読込・復帰・日付更新境界から `planning.reconcilePlanning()` → `progressAdjustment.reconcilePlanning()` → `prepareAdjustment()` / `allocateProgress()` を通す。表示やselectorには副作用を置かない。実績を生成せず、意味のある配置変更だけ履歴へ残し、同じ条件の再実行では同じstateを返す。計算保留の理由とSQLiteの保存未確認は別責務とし、保存キュー・競合復旧を共用する。`Dashboard`は日付越えの`currentPlanReconciliation()`も参照し、実績登録を伴わない保留を「実績保存成功」と表示しない。`Future`と同じ保存済みの保留理由を使い、確定計画保持と確認先を知らせる。`allocateProgress()` は `activePlanWork()` で求めた当日の未消化枠を共通 `fixedOrderIssue()` で照合し、当日保持と順序を両立できなければ原計画を保つ既存の未反映経路へ戻す。`generatePlan()` の日次目安は同一試験・同一終了境界で共有し、開始境界は `taskInterval` / `canStart` の実配置制約として適用する。

全体の仕切り直しは `planning.proposeRestart()` → `planner/proposal.proposeRestart()` → `planRestart.calculateRestart()` → 既存の `approve()`。開始境界と元計画・実績・設定の前提を保持し、承認時に再検証する。`remainingWork()` は教材・周回・単位別のT/C/R/A/Uと整合性を返す。UIに計算式を複製しない。`comparePlans()` の比較開始を操作日へ指定することで、新開始日より前から取り除く予定も差分に含める。計算は `PlanningContext` だけを日時の入力とし、保存・Reactへ依存しない。

`TodayRecorder.save()` / `Progress.save()` → `planning.recordAndAdjust()` → `progress.recordProgress()` → `progressAdjustment.adjustAfterProgress()` → `progressAllocation.allocateProgress()` → `usePersistentAppState.update()` の保存キュー → `store.saveState()`。訂正・取消は `correctAndAdjust()` を通る。保存された操作結果を `progressReceipt.planChanges()` / `summarizePlanChanges()` → `ProgressReceiptView` が表示する。

`remaining()`は総数・初期完了・有効実績から課題の残量を決定する。`activePlanWork()`は当日以降の未消化の有効予定を決定し、比較用の過去予定と区別する。部分入力は当日を閉じない。通常調整は`adjustmentBasis`から同じ教材・周回だけを消化し、今日の残りを予約してから、既存未来枠を`generatePlan()`の保持モードへ渡す。保持予定を容量・順序制約として扱い、未配分だけを既存の均等配分へ渡す。設定変更用の全面再生成とは入口を分ける。

保存形式はPlanの任意属性`adjustmentBasis`と`allocationStart`、Proposalの任意属性`basis`を使用する。SQLiteの表は追加しない。バックアップスキーマも共通化し、旧データは既存の実績基準を再利用する。自動調整失敗・固定競合・未承認案では実績保存を取り消さず、調整未完了として案内する。配分成功時の数量保存、再試行、日付越え、同量の時刻移動は`progressAdjustmentStable.test.ts`、実操作は共通fixtureを使う`tests/web/adjustment.spec.ts`と実機テストで守る。

当日の予約量は調整基準にある当日の未消化予定から、基準以降に増えた当日実績だけを引き、現在残量を上限として求める。`activePlanWork()` と配分予算がこの意味を共有する。通常は日別の予定−実績と一致するが、仕切り直し後の新しい有効配置と `calendarQuantity()` の比較用の当初予定は分離する。累計実績を古い枠から消化する処理は未来の既存配置を維持するためだけに使い、当日の未実施量には使わない。教材・周回ごとに「総数＝初期完了＋有効実績＋今日以降の未消化有効予定＋未配置」を検証する。過去予定は比較用に維持し、この式には重複加算しない。

仕切り直し後の当日表示は `calendarQuantity()` が比較値と別に `activePlanWork()` 由来の `currentRemaining` を返す。通常予定画面は `calendarDisplayQuantity()` を通し、有効残量0かつ未報告の旧教材行を除外して同じ単位で表示合計を作る。今日・今後の予定・カレンダー内容・日付詳細で判定を共有し、`progressView()` と `todayStudyRows()` が表示・記録への引継ぎを共通化する。週間レポートの比較集計は元の `calendarQuantity()` を使い、日別基準を保持する。各画面に別の残量式を置かず、保存項目も増やさない。 `planDisplay.ts` は通常表示のセッションを共通選択し、承認済み `allocationStart` より前の過去予定と開始日の `notBefore` より前の旧予定を除く。後日の通常調整で `from` が進んだ場合、同じ開始日を持つ直近履歴の開始時刻を参照する。開始日が過去になった表示では `restartPlanned` を新配置から導出し、有効実績とは別量として単位別集計する。比較値はnullとし旧分母・不足・入力初期値を流用しない。これらは表示だけのprojectionであり、保存した予定・日別基準・実績は変更しない。

設定確定時は `materialConstraints.validateMaterialChanges()` が最新stateに対して検証する。教材一覧と対話式変更は同じ `minimumRetainedRounds()` を使用し、初期完了・記録・開始済み・固定のある周回を保持する。取消履歴が参照する周回も既存契約どおり保持する。Rustのトランザクションでも保存済みstateとの比較で同じ保護を実行する。1問あたりの分数上限は共通定数1440とバックアップの共有JSONスキーマで一致させる。

Desktopの通常保存・復元はバックアップと同じスキーマ・参照検証・サイズ上限を通す。既存の不正値は読込時に切り詰めず、修正対象のパスをエラーへ含める。不正な既存状態の修正を開始できるよう、確定データを変えない下書き・表示設定の保存だけは許可する。修正後の確定状態は通常の全体検証を通す。

| ファイル                             | 責任                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `src/app/App.tsx`                    | 画面・プロバイダーの組み立て、画面間の操作の接続                                       |
| `src/app/AppShell.tsx`               | サイドバー、見出し、保存状態表示、配色、入力方法に応じた画面移動時のフォーカス                         |
| `src/app/navigation.ts`              | ページ型とナビゲーション定義                                                           |
| `src/app/Dashboard.tsx`              | ホームの表示                                                                           |
| `src/hooks/usePersistentAppState.ts` | SQLite読込、保存キュー、リビジョン競合、保存失敗後の再読込、復元、保存完了を待つ書出し |
| `src/hooks/useCloseAfterSave.ts`     | サイズを含む未完了の保存を待ってウィンドウを閉じる処理                                 |
| `src-tauri/src/window_state.rs`      | ネイティブのサイズ・最大化状態の監視、終了前保存、表示前の復元と作業領域への補正       |
| `src/store.ts`                       | Tauriコマンドの呼出し境界                                                              |
| `src/demoStore.ts`                   | 公開デモだけで使うlocalStorageのリビジョン付き保存                                     |

画面は `state` と `update` を受け取る。SQLiteのリビジョンや保存キューを画面ごとに持たない。更新は直ちに画面へ反映し、保存は順序を保つ。失敗時は以降の保存世代を無効にし、SQLiteの正本を読み直す。復旧未確認中や復元中の編集を防ぐ。これらの処理は分割前と同じ契約を保つ。

ウィンドウサイズと最大化状態はRustで監視し、通常終了要求時に最新値を同じSQLiteのdesktop_windowテーブルへ保存する。画面表示前に復元するためReactの読込・再描画には依存しない。学習データのAppState・revision・auditは更新しない。旧windowSizeは初回の引継ぎだけに使用し、新しい表示設定は教材・進捗のバックアップ復元や全初期化に影響されない。終了用フックはネイティブのサイズ保存を確認してから、従来の学習データ保存待機を続ける。追加プラグインは使用しない。

SQLiteの監査履歴は完全な保存状態を残し、自動削除しない。長期運用の容量増加は未測定であり、UI簡素化のために履歴を削らない。

公開デモはViteの`demo`モードのビルドだけで有効にする。`store.ts`の境界でlocalStorageへ切り替え、画面や計画計算へ保存方式の分岐を持ち込まない。GitHub Pagesの静的ファイル以外にサーバーを持たず、書き出し機能はデモUIから除外または無効化する。通常ビルドとTauriビルドはこの分岐を通らない。

## 対話式の設定

| ファイル                                      | 責任                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/components/guided-setup/GuidedSetup.tsx` | 下書き、エラー、各質問の組み立て、保存要求と画面操作の統括                                    |
| `ExamSteps.tsx`                               | 試験・目標の質問表示                                                                          |
| `AvailabilitySteps.tsx`                       | 学習枠・授業・定期予定・単発予定の質問表示                                                    |
| `MaterialSteps.tsx`                           | 教材・周回の質問表示                                                                          |
| `FocusSteps.tsx` / `FinishSteps.tsx`          | 食事・連続時間と休憩、余裕率・確認画面                                                        |
| `model.ts` / `types.ts`                       | 質問・下書き・画面入力型、初期値、追加モードの開始                                            |
| `transitions.ts`                              | 次・戻る・周回質問の反復、授業期間変更、回答の登録と遷移。保存やDOM操作を行わず次の状態を返す |

一覧からの編集は `src/components/setup/{Exams,Materials,Availability,Focus,Buffer}.tsx` に分割する。

再計画の質問は GuidedRevision.tsx に置く。既存の値を引き継ぎ、Enterで次の一問へ進む。一括スキップは設けない。CommuteEditor は適用条件、往路の出発時刻・所要時間、復路の出発時刻・所要時間、確認の順に質問する。食事との重複を確定前に検証し、出発時刻の修正へ戻れる。

新規の試験・教材は必要な情報と登録確認を省略しない。再計画の下書きは案作成・承認まで元の設定と計画を書き換えない。

## 計画計算

| ファイル                           | 責任                                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| `src/domain/planner/intervals.ts`  | 区間の結合・差引き、期間の日付列挙                               |
| `capacity.ts`                      | 空き枠、連続学習と休憩、週の割当可能量                           |
| `validation.ts`                    | 設定の制約検査                                                   |
| `generate.ts`                      | 共有枠への配置、順序、固定予定、端数統合、不足                   |
| `proposal.ts`                      | 提案・承認・計画取消の状態遷移                                   |
| `src/domain/progressReflection.ts` | 記録時基準と現在の累計実績から同一教材・周回の前倒し反映を再計算 |
| `context.ts`                       | 計算に渡す日時・ID接頭辞の型                                     |
| `src/domain/planning.ts`           | 端末の現在日時とランダムIDを取得して純粋関数へ渡すアプリ向け入口 |
| `src/domain/mealEvents.ts`         | 登録された食事の固定時刻と日またぎ区間の計算                     |

`planner/*` はReact・DOM・SQLite・Tauri・外部サービスを参照しない。現在日時やランダムIDも直接取得しない。同じ状態・計算コンテキストから同じ結果を返し、入力状態を変更しない。ID接頭辞は操作ごとに入口で新しく生成する。

ESLintでも計算層からのUI・保存・日時生成への依存を禁止する。依存先を経由した現在日・IDの取得も単体テストで検査する。

現在の計算方式は `sessionPolicy.ts` の `PLAN_CALCULATION_VERSION = 13`。通学の出発時刻は明示的に指定し、食事を自動で移動しない。commuteScheduleErrors が適用日の通学と食事の重複を検証する。質問の確定、計画生成、候補設定の承認で同じ制約を使う。

承認済みPlanは生成時の有効な実績合計、将来セッションの問題数・終了時刻、未配置量をprogressBaselineへ保持する。旧来の`progressReflection`は互換処理として維持する。日常の記録は前述の`progressAllocation`を使い、同じ教材・周回の実績を二重控除せず、消化と不足の再配置を分離する。新しい計画を明示的に生成・承認した時点で現在実績を新しい基準へ取り込む。

条件変更案と実績反映は別の状態遷移である。進捗記録は承認待ち案を承認・破棄せず、案の実績基準が古くなったことだけを検出する。候補設定を保持して現在残数から再生成した後に、従来の承認処理で設定と計画を同時に反映する。

SQLiteのテーブル・保存キーは維持する。任意項目 departureTimesConfirmed を共有スキーマへ追加し、旧データの読込を許容する。旧授業日方式は再確認まで以前の自動時刻を表示するが、新しい計画生成・承認は止める。通学下書きの flowVersion: 2 で質問順の変更を識別し、旧下書きは値を保持して最初から確認する。承認済み計画・実績は自動変更しない。

## 生活時間の表示

`dailyTimeDisplay.ts` は既存 `dailyTime` の未設定区間だけを睡眠・風呂へ分ける純粋な表示変換。設定は `AppState.outsideTime` に保存し、計算用 `Settings` へ含めない。`OutsideTimeSetup.tsx` は任意設定・開始・終了の質問と下書き保存を担当し、`FocusSteps.tsx` が初期設定の流れへ組み込む。`DailyTime.tsx` は通学・食事を円グラフと凡例だけでまとめ、詳細は元の分類を維持する。

`DailyTimeChart.tsx` は円弧と中心の学習可能量を表示する。実寸に基づく文字拡大時の配置切替も表示層で完結し、計算層へ依存を追加しない。

`OutsideLabelEditor.tsx` は未設定区間の名前の編集・取消を担当し、`dailyTimeDisplay.ts` が日付別の表示名の更新と未設定区間への適用を担う。`calendarSummary.ts` は承認済み計画の日合計を純粋に集計し、`CalendarDaySummary.tsx` が密度に応じて表示する。個別予定の操作は `Calendar.tsx` に残す。初期設定の項目編集の開始と終了判定は `transitions.ts` に置き、`GuidedSetup.tsx` は項目選択と画面の組み立てを担当する。

`setupIssues.ts` の `PlanningInputError` は計画作成を止めた必須入力条件と基準日を保持する。`usePersistentAppState.ts` は設定が保存されるたびにその条件を純粋な `planningInputIssues()` で再評価し、残っている内容だけを上部のエラー表示へ渡す。一般の操作・保存エラーとは追跡状態を分ける。

## 検証

`calendarQuantity.ts` は日別の数量比較と確定基準の保持を担当する。参照日を引数に渡せる純粋処理として計画生成から分離する。記録・承認・復元の既存更新境界から基準保持を呼び、表示コンポーネントからは呼ばない。`CalendarQuantity.tsx` は同じ集計結果の概要と教材別内訳を描画し、`Calendar.tsx` が既存の日付・表示範囲・フィルターを共有する。`Future.tsx` の選択週はAppの画面状態へ保持し、既存の戻る位置復元を利用する。

計算の再現性・非破壊性と質問遷移、指定出発時刻、食事との重複、日またぎ、旧設定の再確認、承認時の再検証を単体テストで確認する。SQLiteを使った実機テストで保存・再起動・質問操作・既存機能を確認する。結果は [VALIDATION.md](VALIDATION.md) に記録する。


### 再開実装の共通境界（2026-10-03）

`dailyWaterfill`と`generatePlan`は実枠・保持境界・週予算・周回順序を共有し、現在計算版は13。`calculateFutureBalance`は明示対象を案へまとめ、空き容量→数量保持の組替え→必要最小削減の順で探索する。`validateBalancedRemainingAllocation`は未配置だけの教材も順序依存の保持/影響試験へ含める。`approve`で再算定した対象と数量を照合し、画面stale判定に探索を入れない。

記録フォームは`StudyRecordForm`・`useStudyRecord`を共用する。`StudyRecordMemory`はAppのreloadEpochより上で、入力・記録ID・送信ロックと入力世代を共有する。`useSyncExternalStore`で再mount後もbusyと入力変更を通知し、旧フォーム完了が新対象を上書きしない。Appの対象変更・明示復元も共通通知APIを使う。保存キューとrevisionは`usePersistentAppState`が所有し、対応する記録の保存確認だけで旧保存失敗通知を解除する。

`classCancellations`は日付両端・授業対象・重複を共通検証し、容量・時間割・通学・ICSで有効授業を選ぶ。Rustは確定設定と計画snapshotを全体検証し、未完成のrevision/proposal下書きには休講項目検証だけを追加して旧入力途中の関係を保持する。SQLite表や正本は変更しない。
