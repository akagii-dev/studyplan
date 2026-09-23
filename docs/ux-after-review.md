# 変更後の独立 UI 評価・interface-review

## Scope

| Field | Value |
| --- | --- |
| Target | 未コミットの変更。`main` は `origin/main` より 0 コミット先行 |
| Base / head | `origin/main` / `HEAD`、ともに `f901dd1` |
| Commits | 0 committed、16 tracked files modified、12 untracked files included |
| Files in scope | 28。製品 UI、計算の接続部、関連テスト・検証文書・スクリプト |
| Excluded | 導入スキル `.agents/`、`skills-lock.json`、画面証拠の PNG と評価スクリプト、`variants/` の生成プレビュー。計 77 untracked paths。レビュー本文はこの件数に含めない |
| Surfaces expanded | `App` から `Dashboard`、`TodayRecorder`、`Future`、`SettingsHub`、`History` まで。`TodayStudyList` は現在の主画面では未使用。共通 CSS の影響は今日・今後・履歴・設定を確認し、他の旧画面全件には拡張していない |

React 19 / TypeScript / Vite と既存 CSS の構成。`AGENTS.md`、`CONTRIBUTING.md`、`CODING_STANDARDS.md`、`CLAUDE.md`、専用デザインシステム文書は見つからなかった。差分の追加・削除両側を確認し、削除されたテーマ設定・詳細機能への導線は `SettingsHub` で残ることを確認した。基準ビルドとの比較は [変更前評価](ux-baseline-review.md) に記録した。

対象は固定デモビルド `index-CeDhP_zh.js` SHA-256 `245688E87193DC3E95B45D07E2E30F3B507C88F791BBE7444C491E8A3E3C18D0`、CSS `index-Cyu6qLFW.css` SHA-256 `EC8FE51F2060965D97848ABC1BF8F9DCDBBED8EE5B49325590B2A9D52F11C3BC`。Edge の独立 browser context で架空の試験・問題集・予定を使用した。通常のデスクトップ保存データは開いていない。操作順は画面から判断した。

## 6 domains

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | 今日の入力、ナビゲーション、予定外 disclosure、320px のキーボード Enter、Axe | 調査範囲で actionable finding なし。Axe violations 0。スクリーンリーダー、200% ズーム、全経路キーボードは未検証 |
| Layout | 1280px の今日→今後→履歴、320px の今日・今後・履歴、空状態・未配置 disclosure | 1 finding。主単位が通常表示にない |
| Writing | 予定・実績ラベル、0問/未入力、記録結果、未配置の文言、訂正・取消 | 同じ 1 finding の二次的な影響。別の重複 finding なし |
| Typography | 1280px / 320px の数量・教材名・ボタン折返し | 調査範囲で actionable finding なし。擬似ローカライズ未検証 |
| Colors | ライト・ミントの通常・保存後・未配置、Axe | 調査範囲で actionable finding なし。ダーク・他テーマ・個別コントラスト実測は未検証 |
| UI | 入力前後、保存後、予定外、履歴訂正・取消、固定ナビゲーション | 調査範囲で actionable finding なし。スローモーションでの検査は未実施 |

## Finding

| Severity | Domain | Status | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- | --- |
| MEDIUM | Layout | Introduced | `src/app/Dashboard.tsx:51`, `src/app/Future.tsx:65` | 学習可能時間が足りず5問を配置できない場合、閉じた表示は「未配置 1件・10分」。5問という主単位は開いた後に初めて見える | 通常表示に教材別の `民法過去問 · 1周目 5問` を出し、時間・理由の内訳だけ開けるようにする。教材が複数なら数量を異教材間で合算しない | ユーザーは残りの必要学習量を問数で扱う。1件・10分では何問を自分で判断・調整すべきか分からない。短い配分不足の表示は必要だが、主単位を折りたたむと確認操作が増える。異教材の混合合計も誤解を生む |

未配置の理由は disclosure 内にあり、開いて確認できたため、操作不能や内容消失には当たらない。結果文「明日以降を調整しました」は配置済みの10問について正しく、未配置の表示も同画面にあるため独立した誤表示としては報告しない。旧カレンダーの月カードが教材名を出さない点も主導線を妨げない既知の残存課題で、今回の差分による finding には含めない。

## Actual UI operation

| Scenario and steps | Expected / actual | Actions / transitions |
| --- | --- | --- |
| 今日を開く | `民法過去問 1周目 / 予定10問 / 実績 未入力`、別教材の予定も見える | 0 / 0 |
| 民法の実績欄に5、行の記録 | 同じ画面で実績5問、調整済みメッセージ。今後の予定で翌日15問、英語読解4問を確認 | 記録2 / 0、今後の予定へ追加1 / 1 |
| 独立した context で 0 / 10 / 15 問を記録 | 0は明示した実績0問、初期未入力と別。翌日の民法は順に20 / 10 / 5問 | 各記録2 / 0、今後の予定へ1 / 1 |
| 予定外を開き、英語読解4問を記録 | `予定なし / 実績4問` が今日に追加。翌日は民法20問 | 開く・選ぶ・入力・記録の4操作 / 0 |
| 5問を記録した後、履歴で3問に訂正 | 履歴に訂正3問、翌日の民法17問 | 履歴・訂正・入力・保存・今後の予定の5操作 / 2 |
| 同じ記録を取消・確定、再読込 | 履歴に取消済み、今日の実績は未入力、翌日の民法20問が再読込後も残る | 取消操作は履歴・取消・確定、再読込後の確認あり |
| 翌日の学習枠を20分に制限し5問を記録 | 翌日10問、未配置5問10分。通常表示は1件10分、開くと5問と理由を確認 | 未配置量の確認には開く1操作を追加 |

上記は画面上の表示と操作経路の実測であり、配分アルゴリズムの独立算術検証を代替しない。変更前は予定を見る0操作、5問記録3クリック・1遷移、翌日教材別15問確認まで計7クリック・3遷移・スクロール1回だった。変更後は計3操作・1遷移で確認できた。記録で教材と日付を再入力せず、予定の手作業配置と案承認も通常フローでは不要になった。

## Verification

- `node docs/ux-after-eval/flow.mjs`：固定デモ、独立 Edge context で一部・予定外・訂正・取消・保存再読込・容量不足を実操作。ログと [今日](ux-after-eval/partial.png)、[翌日](ux-after-eval/partial-future.png)、[未配置の通常表示](ux-after-eval/capacity-future.png)、[未配置の詳細](ux-after-eval/capacity-detail.png) を保存。
- 320px：今日・今後・履歴の `document.documentElement.scrollWidth=320`、`innerWidth=320`。最初の Tab は実績欄に入り、5 を入力して Enter で記録できた。[320px 今日](ux-after-eval/home-320.png)、[Enter 後](ux-after-eval/keyboard-enter-320.png)。`@axe-core/playwright` の audit は violations 0。
- 0問、予定どおり、超過の別 context も実操作し、[超過後の今日](ux-after-eval/over-today.png) と [翌日](ux-after-eval/over-future.png) を保存。
- **Not verified**：デスクトップネイティブ実機と SQLite の保存、スクリーンリーダー、200% ズーム、RTL、ダーク・他テーマ、全設定画面と旧カレンダー全状態。親担当が別途行う算術・ビルド・ネイティブ E2E は本評価の合格範囲に含めない。

**Approve**（interface-review の HIGH 基準に該当する finding なし）。MEDIUM 1件は製品目標に直接関わるため、改善ループで修正し、同一ビルドで再評価する。

## Loop 2: 未配置量の修正後再評価（2026-09-23）

固定ビルドは JS `index-BYrXmD-u.js` SHA-256 `30F7B724D7652F921C3105996BEA4A9D049701B06316FE8DAD5AB7EB989ACD49`、CSS `index-BF1TFsss.css` SHA-256 `E367AC159ECCFFA1F94C629C4E2FE89EA8B83D3726A4D55E623ECD6A04F6A673`。プレビューは同じ隔離デモを新しい browser context で使用。前回レビューの未コミット全体が引き続き対象で、今回変更した `src/components/ShortfallDetails.tsx` と、直接の利用元 `Dashboard.tsx` / `Future.tsx`、`src/style.css`、`tests/dashboardShortfall.test.ts` を重点確認した。共通コンポーネントへの集約で今日・今後の表示が一致し、理由は教材・周回ごとに開く方式に変わった。`origin/main..HEAD` は引き続き 0 コミット。前回から変更のない画面の判定は上記の実操作結果を引き継ぐ。

| Scenario | UI 手順 | Expected / actual | Evidence |
| --- | --- | --- | --- |
| 単一教材の容量不足 | 明日20分の隔離予定で今日5問を記録 | 今日と今後の予定に、未配置の民法過去問1周目 **5問** が開かず表示。翌日には10問を配置。理由だけ開閉 | [今日](ux-after-eval/loop2-single-today.png)、[今後](ux-after-eval/loop2-single-future.png) |
| 異なる教材の不足 | 同条件に英語読解4問を追加し、今日の民法5問を記録 | 未配置は民法5問と英語4問を別行に表示。単位の違う問数を合計しない。合計時間30分と2件は補助情報 | [今日](ux-after-eval/loop2-multi-today.png)、[今後](ux-after-eval/loop2-multi-future.png) |
| 配分可能 | 明日60分、英語ありで今日の民法5問を記録 | 今日の未配置はなし。翌日民法15問・英語4問 | [今後](ux-after-eval/loop2-normal-future.png) |
| 320px | 複数教材の不足例で最初の入力へTab、5を入力しEnter。理由を開き、「予定を確認」、今後の予定へ移動 | 入力・調整・詳細への導線が動作。今日・今後とも `scrollWidth=innerWidth=320`、Axe violations 0 | [今日](ux-after-eval/loop2-mobile-today.png)、[今後](ux-after-eval/loop2-mobile-future.png) |

実行コマンドは `node docs/ux-after-eval/loop2.mjs`。同じビルドで上記の実操作を3回行い、期待表示とスクリーンショットを確認した。通常の記録は引き続き入力と記録の2操作、翌日確認まで追加1操作・1画面遷移。未配置の主単位を確認する追加クリックは不要になった。320px の「予定を確認」はスクロール後に押せ、計画案へ到達した。

`interface-review` の今回変更分には新たな `Introduced` / `Regression` finding がない。6分野の再確認では、Accessibility はキーボード・Axe・狭幅、Layout は今日/今後の複数教材表示、Writing は問数と理由の開閉、Typography は320px の折返し、Colors はライト・ミント表示、UI は記録・理由・確認操作を確認した。暗色テーマ、スクリーンリーダー、200%ズーム、RTL、全旧画面は未検証。未配置量を隠した前回の MEDIUM finding は解消した。

**Pre-existing / MEDIUM（Writing）:** `src/domain/planner/generate.ts:507` の理由は「期限までの学習枠・週の割当上限・集中ブロック・教材順序の条件に収まりません。」という候補制約の列挙で、画面から実際にどの制約が不足の直接原因だったか特定できない。`origin/main` に同じ文言があり、この UI 修正で発生した問題ではない。数量は見え、理由も開けるため今回の表示修正を妨げないが、ユーザーが条件を見直す際に判断を要する。

**Approve**（この変更による HIGH / MEDIUM finding なし）。上記の既存理由文言は変更差分の verdict に含めず、製品目標に対する残存課題として親担当へ通知した。

## Loop 3: 理由・設定導線・通知の修正後再評価（2026-09-23）

固定ビルド JS `index-BA7XJ6hT.js` SHA-256 `E12EB1E5B337FB2907DA5CF5C15273698044A37042C63A19910496AB71C23DA1`、CSS `index-BF1TFsss.css` SHA-256 `E367AC159ECCFFA1F94C629C4E2FE89EA8B83D3726A4D55E623ECD6A04F6A673`。`main` と `origin/main` は `f901dd1` で同一、未コミットが対象。今回の時点で18 tracked files modified と、生成物・導入スキル・評価証拠を除く14 untracked files（計32）を範囲とした。ループ2までの全体レビューを踏まえ、今回の重点は `planner/generate.ts` の理由、`SettingsHub` / `Tutorial` の導線、`planner/proposal.ts` の承認境界とその直接利用画面である。追加・削除両側を確認した。`git diff --check` は exit 0（README の CRLF 警告のみ）。

| 対象 | 画面上の手順 | 期待 / 実際 | 証拠 |
| --- | --- | --- | --- |
| 容量不足の理由 | 明日20分の隔離予定で今日5問を記録。未配置の「理由」を開く | 今日・今後の予定とも、翌日10問配置、民法5問10分が未配置。理由は「2026-09-24までの空き枠は0分、未配置の必要時間は10分です。」 | [今日](ux-after-eval/loop3-capacity-reason.png)、[今後](ux-after-eval/loop3-capacity-future.png) |
| 期限不足の理由 | 学習期限を今日より前にした隔離予定で今日5問を記録し「理由」を開く | 民法15問30分が未配置。理由は「2026-09-22までが学習期限ですが、再配分の対象日に学習できる日がありません。」 | [期限不足](ux-after-eval/loop3-deadline-reason.png) |
| 通常記録 | 明日60分、英語読解ありで今日の民法5問を記録 | 実績5問、翌日民法15問・英語4問。未配置・確認待ちは発生しない | `node docs/ux-after-eval/loop3.mjs` の `NORMAL_FUTURE` |
| 時間内訳への導線 | 設定 → 今日の時間内訳 | 「今日の詳細」に移り、学習可能1時間、休憩、授業・予定・移動等の内訳が見える | [設定](ux-after-eval/loop3-settings.png)、[時間内訳](ux-after-eval/loop3-time-breakdown.png) |
| 使い方の更新 | 設定 → 使い方 → 進捗を記録 | 「今日の予定からそのまま記録」、今日へ・記録履歴へ等の操作が表示される | [記録の説明](ux-after-eval/loop3-tutorial-record.png) |
| 古い確認待ち通知 | 未承認の設定案を隔離データへ用意。今日5問を記録 → 計画案を確認 → 現在の残数から案を作り直す → この内容で更新 → 今日 → 再読込 | 記録後は確認待ち通知。古い案は承認不可で、更新後に承認できる。今日に戻ると確認待ち通知が消え、実績5問は残る。再読込後も通知は復活しない | [記録後](ux-after-eval/loop3-proposal-record.png)、[更新した案](ux-after-eval/loop3-proposal-refreshed.png)、[承認後の今日](ux-after-eval/loop3-proposal-resolved-today.png) |

UI 操作ログは `node docs/ux-after-eval/loop3.mjs` と `node docs/ux-after-eval/loop3-proposal.mjs`。通常データと共有しない Edge browser context をシナリオごとに使用した。表示される理由の数値を独立した計算結果と同一視せず、ここでは文言と導線を確認した。親担当が別途、計算の期待値とネイティブ保存を検証する。

| Domain | 今回の根拠と結果 |
| --- | --- |
| Accessibility | 理由は native `details/summary`、設定導線と計画案操作は button。今回の操作では到達可能。スクリーンリーダー、200%ズームは未検証 |
| Layout | 未配置の教材別量を残したまま、理由のみ開閉。設定へ時間内訳を置き、今日の日常画面の情報量は増えない。新たな所見なし |
| Writing | 汎用的な制約候補の列挙を、確認できる期限・空き枠と必要分数に変更。チュートリアルの今日→記録→自動配分の説明と画面が一致。新たな所見なし |
| Typography | 1280px の理由文・内訳・計画案の可読性をスクリーンショットで確認。320px はこのループで再測定していない |
| Colors | ライト・ミントで新規の状態誤認は見られない。暗色・他テーマの個別コントラストは未検証 |
| UI | 記録後の確認待ち→案更新→承認後の通知解消まで実操作。通常記録も同ビルドで完遂。新たな所見なし |

`src/domain/planner/generate.ts:491-514` は確認できる条件から理由を作り、旧 `:507` の列挙文言を置き換えた。`src/domain/planner/proposal.ts:149` は成功した承認時に古い進捗調整通知を消す。これらの変更について `Introduced` / `Regression` の interface finding は見つからなかった。ループ2の Pre-existing/MEDIUM（汎用理由）は、確認した容量不足・期限不足の2条件では解消した。残る学習枠なし、短い連続枠、週上限、先行教材の理由は実ブラウザー未検証で、テストと別途の計算検証に委ねる。暗色テーマ、スクリーンリーダー、RTL、200%ズーム、デスクトップネイティブの実操作も本評価では未検証。

**Approve**（今回変更による HIGH / MEDIUM の interface finding なし）。
