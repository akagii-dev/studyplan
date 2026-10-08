> **現行仕様**：v0.6.14の変更はREADME・CHANGELOG・SPEC・ARCHITECTURE・VALIDATIONを参照。以下は2026-09-30の履歴資料であり、古い復元・統合手順を現在の手順として実行しない。

# StudyPlan：別PCへの現状報告・統合引き継ぎ

2026-09-30作成。移行先もv0.6.4まで進めているため、共通履歴を使って双方の変更を統合する。移行先の作業ツリー・独自コミット・実データは未確認であり、本書作成時点で移行先へのマージやデータ復元は実施していない。

## 1. このPCの確認済み状態

| 項目 | 状態 |
| --- | --- |
| リポジトリ | https://github.com/akagii-dev/studyplan |
| ブランチ | `main` |
| 製品ソースの基準 | `f88b30d29c0e811d90ba6157b8533db9fbe36e34`（本書追加前のHEAD） |
| リモート | fetch後の`origin/main`も同じコミット |
| v0.6.4の共通基準 | `b45dc8c747cad6ee6ae8d8e0617d9e04accbccfc`（タグをcommitへ解決した値） |
| 最新製品版 | v0.6.9、計算バージョン`PLAN_CALCULATION_VERSION = 12` |
| 公開 | [v0.6.9 Release](https://github.com/akagii-dev/studyplan/releases/tag/v0.6.9)、EXEと更新ZIPの2点を確認 |
| デモ | [配信実行36697004257](https://github.com/akagii-dev/studyplan/actions/runs/36697004257)が上記製品コミットで成功 |
| 作成前の未コミット変更 | tracked差分なし。未追跡`build-temp-lan.ps1`のみ。既存のローカル作業として保持 |
| 現在のエージェント | 実ツールの一覧で親`/root`のみ稼働、サブ0体 |

本書と検証記録の追加は製品版番号を変更しない。v0.6.9のタグや配布物は再公開・上書きしない。`build-temp-lan.ps1`は製品ソース・公開物へ含めていないため、必要なら内容を確認して個別に移す。

## 2. 最新のユーザー指示（統合時の優先事項）

履歴にある古い画面仕様を復活させない。最新版の意図は次のとおり。

- LAN名はSSIDではなくWindowsの`InterfaceAlias`。表示は`Wi-Fi 2 — 133.26.237.171`の形式。
- 配置先の確認欄と個別の「残りの配置を調整」は不要。
- 今後の予定の通常の入口は「計画を仕切り直す」「経過済みの未消化分をまとめて調整」「詳細カレンダーを見る」の3つ。既存の案がある場合の確認導線は維持。
- 一括調整の移動元は**昨日以前だけ**。今日の予定は開始時刻を過ぎても対象外。
- 未報告は未報告のまま保持し、再配置のための架空の0問実績を作らない。実績登録と配置変更の意思を混同しない。
- カレンダーの過去の不足・未報告には、確定計画へ反映済みなら「調整済み」を表示。未配置が残れば「調整済み・未配置あり」と区別。
- 配分は可処分時間・週上限・期限・順序・固定制約に従って分散する。同じ容量の条件では均等を目指すが、授業や容量が違う日まで同じ問数に強制しない。
- Markdownとテストは既存ファイルへ統合し、細分化して増やさない。本書は移行用に明示依頼された1ファイル。

変更しない境界：LAN認証/API、選択IPv4へのbind、Firewall・portproxy、SQLite保存方式、通常の自動調整の発火条件。`0.0.0.0`へbindしない。制約を自動で緩和しない。

## 3. v0.6.4以降の共有済み変更

| 版 / コミット | 変更と統合上の注意 |
| --- | --- |
| v0.6.5 / `3457e29` | private IPv4限定を撤去。接続中のglobal IPv4も候補とし、loopback・169.254/16・unspecified・broadcast・multicastを除外。gatewayを持つ実Wi-Fi/Ethernetを優先し、Hyper-V/WSL/VPN/Tailscale/Fortinetは下位候補に残す。候補を`address`と`interface_alias`の構造へ変更。v0.6.4のSSID表示はこの版で置換。文書26→8、単体テスト40→34ファイルへ統合。 |
| v0.6.6 / `e2853b4` | 未消化量の算定・部分配置・承認検証・比較履歴の保護を共通処理へ統合。端数による日次過配分を修正。この版の個別操作UIは最新版では撤去済み。 |
| v0.6.7 / `6ac48cd` | 経過済み残量の集約と一括調整、前提が変わった案の再生成を追加。この版の当日対象・配置明細UIは最新版の要件ではない。 |
| v0.6.8 / `6d201e7` | 通常3入口へ整理。一括調整を昨日以前に限定。今日・未来・実績・比較履歴・既存未配置を保持し、自動繰越済みの再配分を防止。旧部分案の読込互換を維持。 |
| v0.6.9 / `f88b30d` | 確定計画に基づく調整済み表示、週内の日次配分、少量追加の分散、同じ予定IDに統合した追加量の保持を修正。 |

**実機の不均等な計画について：** 通常SQLiteをreadOnly/query_onlyで調査した。保存履歴から、偏りは計画作成時に生じ、後続調整が既存配置を維持していたと確認。週上限を前半で消費する配分と、日次目標をブロック長へ持ち上げる処理等を修正した。実データをメモリ内で再計算し、極端な集中・欠落の解消を確認したが、通常SQLiteへ書き戻していない。

**既に保存された不均等な計画は、更新だけでは均等化されない。** 必要な場合は新しい版で「計画を仕切り直す」→開始条件→案の確認→承認を行う。過去分の一括調整は対象外の有効配置を保持するため、全体の均等化操作の代わりにはならない。

## 4. エージェント・Skillsの引き継ぎ

以下は今回の会話で使用した担当名と責務。現在はサブの稼働がなく、移行先へライブセッションが引き継がれるとは扱わない。成果物は製品コミットと既存テスト・検証記録に統合済み。

| 担当 | 主な責務 / 再開時の担当範囲 |
| --- | --- |
| `/root` | 要件解釈、UI全体、実データの読取り調査、実装統合、検証、文書、公開 |
| `/root/lan_ui` | LAN候補表示、後続の共通カレンダー進捗表示と既存表示テスト |
| `/root/partial_planning` | 計画配分、通常調整の数量保存、同IDへの追加と訂正・取消、既存単体テスト |
| `/root/elapsed_domain` | 経過分・過去限定の抽出、部分案生成、承認時の数量・前提・枠検証 |
| `/root/elapsed_e2e` | 既存Web/Desktop/LAN E2Eと架空fixtureの更新 |
| `/root/allocation_audit` | 読取り専用レビュー。数量・比較履歴・追加量保持・回帰を点検 |

新PCでサブを使う場合はユーザー依頼と実ツールを確認し、上記を参考に担当ファイルを分離する。親が承認・統合・公開を担当し、レビュー担当は既定で読取りのみ。以前の実行環境は親を含め同時4枠だったが、新PCで利用可能な枠・ツールを改めて確認する。

今回の製品修正に専用Skillの適用は不要だった。Skills・プラグインのカタログやローカルファイルはPC依存で、Gitのソースだけでは移らない。新PCの一覧と実在する`SKILL.md`を確認して必要なものだけ使う。同名Skillを無断で上書きしない。製品ビルドにエージェント固有Skillは不要。Claude Code用のUI系Skillはローカルの`.claude/skills/`に置き、取得元は`skills-lock.json`に記録する。

## 5. 最初に読む仕様・関連コード

正本は[CLAUDE.md](../CLAUDE.md)、[SPEC](SPEC.md)、[ARCHITECTUREの画面契約](ARCHITECTURE.md#進捗と画面の契約)。版別変更は[CHANGELOG](../CHANGELOG.md)、詳細な検証根拠は[VALIDATION](VALIDATION.md)、公開手順は[RELEASING](RELEASING.md)。本書のスナップショットより、その後のユーザー指示と正本を優先する。

| 領域 | 主なコード |
| --- | --- |
| NICの候補・順位・bind | `src-tauri/src/lan_host.rs`、`src-tauri/src/lan_interfaces.rs` |
| 3入口・過去分操作・記録 | `src/app/Future.tsx`、`src/components/Replan.tsx`、`src/components/TodayRecorder.tsx` |
| 残量分類・対象抽出・検証 | `src/domain/remainingWork.ts`、`remainingAllocation.ts`の`pastRemainingWork` / `validatePastRemainingAllocation` |
| 案作成・再生成・承認 | `src/domain/planning.ts`、`src/domain/planner/proposal.ts` |
| 計画配分・計算版 | `src/domain/planner/generate.ts`、`src/domain/sessionPolicy.ts` |
| 通常調整・反映基準 | `src/domain/progressAdjustment.ts`、`src/domain/progressAllocation.ts` |
| 共通の調整済み表示 | `src/domain/calendarQuantity.ts`、`src/domain/progressView.ts` |
| 案の互換 | `src/domain/model.ts`、`src/domain/backupSchema.ts`と生成スキーマ |

`activePlanWork`で有効量を参照し、比較専用枠を作業量・空き時間へ戻さない。`progressBaseline`、`adjustmentBasis`、比較専用ID、日別比較基準を一体で扱う。移動元と移動先の二重計上、訂正・取消による無効配置の復活を防ぐ。

保存済み案の`purpose: 'past-only'`は任意項目で、従来案も読める。案作成・破棄では確定計画を変更せず、承認時に前提fingerprint・数量保存・新しい枠の実行可能性を再検証する。DesktopとLANは同じdomainと既存SQLiteのrevision/requestId/競合処理を使う。

## 6. 別PCのv0.6.4側と統合する手順

### A. 上書きせず、両側の状態を確認する

移行先リポジトリで実行する。作業場所はそのPCの実際のcheckoutに合わせる。

```powershell
git status --short
git branch --show-current
git log -8 --oneline
git diff
git diff --cached
git fetch origin --tags
git log --oneline --left-right HEAD...origin/main
git diff --stat HEAD..origin/main
```

未コミット変更があれば、必要なソースを個別に退避、または`claude/`ブランチでローカルWIPコミットへ保存する。未追跡も内容を確認する。SQLite・バックアップ・キー・ログ・配布物を一括で`git add`しない。`reset --hard`、`clean`、強制push、競合の一括上書きは行わない。

### B. 履歴を使って統合する

- **独自コミットがなく、作業ツリーがcleanで、現在HEADがorigin/mainの祖先**なら、`git merge --ff-only origin/main`で共有済み変更を取得する。前提が違えばこの操作は失敗するので、強制しない。
- **移行先独自のコミットがある**なら、その変更を保持した現在ブランチから統合ブランチを作り、通常mergeする。以下のブランチ名が既存なら別の未使用名を選ぶ。

```powershell
git switch -c claude/pc-migration-integration
git merge origin/main
```

競合は両側の意図を読んで解消する。特にLANのSSID/InterfaceAlias、当日/昨日以前の対象範囲、画面の入口、配分と反映基準、スキーマ、版番号・lockfile、CLAUDE.md/仕様を確認する。`ours`/`theirs`で一括採用しない。共有済みのv0.6.4～v0.6.9を再cherry-pickせず、共通履歴を使う。

統合後は差分と既存テストを確認し、必要な追加検証だけ既存ファイルへ統合する。製品版0.6.9と計算版12を下げない。移行先に独自修正があれば、それも検証してから統合結果を共有する。v0.6.9は既公開のため、追加の製品変更を公開する場合は別版でRELEASINGに従う。

### C. 依存物とビルドを新PCで作り直す

`node_modules`、`target`、`dist*`、`.test-data`、配布物、接続キーをGit移行に混ぜない。Node.js 22.19以降・pnpm・Rust・WindowsのTauri/WebView2開発環境を確認し、順番に実行する。ビルド出力を共有する検証を同時実行しない。

```powershell
pnpm install --frozen-lockfile
pnpm verify
# Chromeがインストールされている場合。未導入ならPlaywrightの環境を整える。
$env:PLAYWRIGHT_CHANNEL = 'chrome'
pnpm verify:ui
pnpm lan:assets
cargo build --manifest-path src-tauri/Cargo.toml --features lan-cli --bins --locked
pnpm test:ui
pnpm test:lan
```

Rustに統合差分があれば関連Cargoテストも行う。UIは広幅・320px狭幅・Tab/Enter・フォーカス・横溢れを実画面で確認する。E2Eは`.test-data/`の架空データ専用SQLiteで実行する。**release版はテスト保存先指定を無視するため、通常アカウントで配布EXEを試験起動しない。** 古いEXE・LAN資材を使った結果を新ソースの検証と扱わない。

## 7. 学習データの移行はコード統合と別に行う

通常保存先は`%APPDATA%\jp.local.studyplan\studyplan.sqlite3`。このPCの通常SQLiteには本作業で書込み・試験流用をしていない。Gitへ実データを含めていないため、ソースmergeでは学習データは移らない。

移行する場合は既存のアプリ内バックアップ・復元経路を使い、両PCのデータを先にそれぞれ退避する。別PCにも記録がある場合、どちらを採用するか確認する。両SQLiteの行を直接mergeしたり、稼働中のファイルを単独コピーして上書きしたりしない。復元の案内・検証・既存の競合処理を維持する。本書の作成は実データのコピーや復元の実行を含まない。

LANは新PCのIPv4と公開開始時の新キーで接続し直す。古いリンク・キーを引き継ぎ文書やGitへ載せない。Firewall・portproxy・認証設定を自動変更しない。

## 8. 検証済みと未検証の境界

製品v0.6.9の結果。詳細と途中の失敗理由はVALIDATIONに記録済み。

| 検証 | 結果 |
| --- | --- |
| `pnpm verify` | lint・型検査・単体510件/34ファイル・通常ビルド成功 |
| `pnpm verify:ui` | Chrome、1280px/320pxの28件成功。旧配分の期待2件を更新して全件再実行 |
| `pnpm test:lan` | 25件成功、幅非依存の重複11件skip。専用SQLiteで再送・競合・承認・再読込を検証 |
| `pnpm test:ui` | 全60件実行の初回58件成功。旧fixture前提の2件を修正して該当2件再実行成功。最終全60件の一括再実行は未実施 |
| Rust | v0.6.8でライブラリ39件成功。v0.6.9ではRustソース変更なし、同テストは再実行していない |
| 配布 | v0.6.9ビルド、ZIP規定4ファイル、manifest/EXEのハッシュ一致。v0.6.8隔離コピーで更新拒否・正常更新・退避・再実行・データ保持を検証 |
| 実データ調査 | 読取りとメモリ内比較のみ。通常保存先の確定計画・実績は変更していない |

未検証：移行先の独自変更とのmerge、新PCでのビルド/起動、別端末からのLAN到達性、iPhone実機、スクリーンリーダー実聴、隔離Windowsアカウントでの配布EXE起動。既存の依存注釈・バンドル容量警告は残る。

新PCの次の担当は、まず移行先のGit状態を報告し、保護→統合→検証へ進む。以前のサブエージェントへ同じ作業を再依頼したり、実データを試験fixtureへ使ったりしない。
