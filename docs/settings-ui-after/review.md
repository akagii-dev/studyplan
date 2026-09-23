# 設定画面・固定ビルドの独立 UI 評価

## 範囲とビルド

2026-09-23、固定デモ `http://127.0.0.1:4175/studyplan/` を Edge の毎回新しい browser context で操作した。JS `index-BwhESMQA.js` SHA-256 `18B5810585DEA51DC6CD0F45AEC8BFD0E9E963A14430BACFA2F8B8133F5A25F3`、CSS `index-4laFmfqh.css` SHA-256 `FB34289736F1DBE6E3FBC9490E0B791490193FE453649B25C8E25AC5812879D1` を照合。データは空のデモ領域か [`after-fixtures.mjs`](../settings-ui-baseline/after-fixtures.mjs) の架空データのみ。製品コードと通常ユーザーデータは変更していない。

`/interface-review` の対象はこの設定画面変更。Git は `main` の `HEAD=f901dd1`、`origin/main` との差分0コミット、作業ツリーに未コミット49項目。製品の対象は新規 `src/app/SettingsHub.tsx` と直接接続する `src/app/App.tsx`、`src/app/AppShell.tsx`、`src/app/navigation.ts`、`src/components/Warnings.tsx`、`src/components/setup/Availability.tsx`、`src/style.css`。テスト、資料、ビルド、skills、他の学習フローはこの評価から除外した。直接遷移先は試験追加、教材追加、時間枠、計画案、通知管理、連続時間設定まで確認。React/Vite、既存CSS変数とCSSクラスの実装。`AGENTS.md`、デザインシステム・コーディング規約文書は見つからなかった。

## 変更前後と主要操作

| ケース | 操作・期待 | 実際 |
| --- | --- | --- |
| 空、390×844 | 今日→設定で必要な登録先が読まずに分かる | 設定は1タップ。変更前は本文946文字・22ボタン、最初の設定入口はy=1595。変更後は本文257文字・20ボタンで、試験追加y=340、教材行y=456、学習枠設定y=572、計画作成y=643。いずれも初画面内。各行1タップで該当入力へ到達。教材未登録時の「先に試験を追加」は試験入力へ。 [変更前](../settings-ui-baseline/settings-390-viewport.png) / [変更後](empty-390-settings.png) |
| 空、1280×800 | 同じ状態の設定入口を確認 | 変更前の最初の設定入口y=1414から、変更後は試験追加y=315、教材行y=381、学習枠設定y=446。各行1クリック。 [変更前](../settings-ui-baseline/settings-1280-viewport.png) / [変更後](empty-1280-settings.png) |
| 必須の一部だけ | 試験1件を保持し、残る不足を識別 | 基本設定1/3。試験1件設定済み、教材と時間枠は未登録。 [画面](partial-390-settings.png) |
| 必須完了・補足未確認 | 試験/教材/時間枠を保持し、補足未確認でも計画作成可能 | 3/3、追加条件は閉じた1行に「要確認4件」。計画案作成から20問の案へ進めた。 [設定](ready-unconfirmed-390-settings.png) / [案](ready-unconfirmed-plan-action.png) |
| 予定なしの明示回答 | 未確認と「予定なし」を区別し、再読込後も保持 | 「大学の授業」の予定なしを1タップで設定。要確認4→3、保存revision1→2、再読込も予定なし。3種とも明示済みfixtureは要確認1件（食事のみ）。 [画面](schedule-none-after-reload.png) |
| 必須未入力の計画ガード | 案を作らず不足先を知らせる | 設定画面に留まり、`role=alert`「未登録の項目を入力してください。」。3行は未登録を保持。 [画面](empty-plan-guard.png) |
| 必須3種あり・不正値 | `block=0` を必須未登録や保存障害と混同しない | 計画作成で `role=alert`「設定値を確認してください」、1〜1440分等の条件と「修正する」。1クリックで連続時間の設定画面へ。 [画面](invalid-block-plan-action.png) |
| 補足の非表示と再表示 | 通知状態を設定データと区別する | 計画案画面で食事の「通知を非表示」→設定には「通知非表示」と残る。通知管理で再表示→再読込後は非表示印なし。要確認4件は未設定条件の数として維持。 [設定](notification-settings-hidden.png) / [管理](notification-management.png) |
| 必須の学習枠を削除 | 設定が未登録に戻り、再読込しても一致 | 時間枠画面で「夕方」の削除を押すと即時に保存revision1→2、設定3/3→2/3、再読込後も未登録。確認・Undoはない。 [削除後](delete-window-settings.png) |
| 保存失敗 | 未保存の予定なしを保存済みと見せない | 対象キーの `Storage.setItem` 失敗を隔離注入。保存済みデータを読直し、明示回答は未確認へ戻る。`role=alert`「最後の変更を確認し、反映されていない場合は入力し直してください」。 [画面](save-error.png) |
| 読込失敗 | 空初期状態と混同せず、復旧手段を知らせる | `Storage.getItem` 例外と不正envelopeはどちらも「デスクトップ版で開いてください」。詳細を開くと実際のエラーは見えるが再試行操作なし。 [例外](fault-read.png) / [不正データ](fault-invalid-envelope.png) |

## 6領域の確認

| 領域 | 根拠・確認結果 |
| --- | --- |
| Accessibility | 320/390/1280pxでキーボードTabから外側summary、「影響」4件、「期間と影響」へ到達。いずれも `:focus-visible` の3px outline。Enterで期間詳細が開く。各summaryは44.4px高、文字16px。該当設定ボタンも44px高。axe実行は3幅とも違反0件。読み上げ実機は未検証。 |
| Layout | 320/390/1280pxで文書幅=viewport幅。基本設定の主要操作は390×844初画面内。下部ナビで詳細が隠れずスクロールで到達。折りたたみの矢印を確認。 |
| Writing | 未入力事実と操作先を3行へ集約。通知の「無視する」は「通知を非表示」に変更され、管理画面も同語。保存エラー・計画値エラーは別の文面。読込エラーは下記所見。 |
| Typography | 設定見出し、行名、状態、ボタン、detailsを320/390/1280pxで確認。詳細summaryは実測16px。画面内の切詰めは確認されなかった。200%ズームと翻訳による文字増加は未検証。 |
| Colors | 状態は文字（未登録/設定済み/要確認/予定なし）でも示す。axeのコントラスト違反0件。暗色テーマでの全状態は未検証。 |
| UI polish | 主要行は同じ構成と操作サイズ。補足は1つのdetailsにまとまり、内容ごとの影響をさらに開ける。通知非表示後も未設定状態が表示に残る。 |

## Findings

| 重要度 | 領域 | 状態 | 場所 | 現状 | 修正方向 | 影響 |
| --- | --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility / Layout | Regression | `src/app/App.tsx:31`、`src/components/setup/Availability.tsx:26` | 設定の「食事時間→設定・確認」を一度使い、設定→使い方→勉強できる時間→「時間枠・時間割へ」で再入場すると、前回の `availabilityTarget=meals` により朝食入力へ焦点とスクロールが飛ぶ。390pxは `scrollY=3767`、h1のy=-3605。1280pxは `scrollY=2988`、h1のy=-2827。 | 通常ナビで移動する時は以前の設定リンク用焦点指定を破棄し、直接リンク時だけ対象入力へ移す。 | 新しい画面の見出しと最初の入力が完全に画面外になり、利用者が途中から始まった画面を見て迷う。[390px](tutorial-availability-meals-390.png) / [1280px](tutorial-availability-meals-1280.png) |

### Pre-existing（変更差分外だが、設定導線から到達する重大問題）

| 重要度 | 領域 | 場所 | 対象・手順、期待と実際、影響 |
| --- | --- | --- | --- |
| HIGH | Accessibility / UI | `src/components/setup/Availability.tsx:219` | 設定→時間枠を設定→登録した「夕方」の「削除」。確認やUndoを期待したが、1押下で即削除し永続化。唯一の学習枠なら計画入力が2/3に戻る。`HEAD` 版にも同じ削除処理があり今回の変更による退行ではないが、設定導線で必要なデータを失う危険がある。確認かUndo、または同等の明確な保護が必要。 |
| HIGH | Writing / error recovery | `src/components/Startup.tsx:23` | 隔離デモの読み込みを故障注入、または不正データで起動。ブラウザーの保存データが読めないのに「デスクトップ版で開いてください」と案内し、再試行ボタンがない。詳細を開くと原因は見えるが、通常表示から回復できない。`HEAD` と同じ分岐であり設定Hub差分外だが、今回の保存/読込状態を誤認させる。デモの読込失敗を専用のエラー・復旧導線で示す必要がある。 |

前者の削除は画面で確認ダイアログが一切出なかった。`src/components/setup/Availability.tsx:219-230` と `git show HEAD:src/components/setup/Availability.tsx` でも直接 `windows.filter` による削除を確認した。後者も `HEAD` から存在する `isTauri()` のみの分岐。試験と教材には画面上の削除操作自体がなく、削除→未設定へのテストは学習枠で行った。

## Verification と判定

- 固定JS/CSS hashを照合した。実操作は `node docs/settings-ui-after/audit.mjs`、`node docs/settings-ui-after/interactions.mjs`、`node docs/settings-ui-after/state-cases.mjs`、`node docs/settings-ui-after/keyboard.mjs`、`node docs/settings-ui-after/axe.mjs`。各ログは同名JSON。
- 焦点退行は `node docs/settings-ui-after/tutorial-focus.mjs meals` で再現。通常ナビで初めてAvailabilityへ移る場合はh1焦点・scrollY=0。食事設定リンクを一度使った後に通常ナビで再入場すると前の焦点が残る。`tutorial-focus-meals.json` に座標を保存。
- 通常データは触らず、架空データを新規contextのブラウザー保存領域にだけ投入した。デモのStorage故障注入はnative SQLiteの障害試験とは別。native実機、スクリーンリーダー、200%ズームは未検証。
- `/interface-review` の変更差分として **Block**（導入した焦点・スクロール退行のHIGH）。製品の設定フローにも既存の削除・読込エラーHIGHがある。
