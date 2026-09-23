# 設定画面・修正後ビルドの独立再評価

## 範囲と条件

2026-09-23、固定デモ `http://127.0.0.1:4175/studyplan/` を新規 Edge browser context で実操作した。JS `index-Cuiw919U.js` SHA-256 `F0F496F1B4A1B4DB52E4C1437A55AAA36039BD8BC6CFD4B01370BF7116768CFB`、CSS `index-BtQyJPWq.css` SHA-256 `5F8A104F04771810A55012B99452DE5E145F902DED9994AAF0B7EB4E9E6F5BE5` を照合。空初期状態は変更前と同一、他は [`after-fixtures.mjs`](../settings-ui-baseline/after-fixtures.mjs) の架空データ。通常ユーザーデータ・製品コードは変更していない。

`/interface-review` は作業ツリーの設定画面変更と、その直接遷移先・状態を対象にした。Gitは`main`、基準`HEAD=f901dd1`=`origin/main`、コミット差分0。製品の対象は `src/app/SettingsHub.tsx`、`src/app/App.tsx`、`src/app/AppShell.tsx`、`src/app/navigation.ts`、`src/components/Warnings.tsx`、`src/components/setup/Availability.tsx`、`src/components/Startup.tsx`、`src/style.css`。テスト・資料・生成物・他の学習フローは除外。React/Viteと既存CSS変数/クラスを使用。`AGENTS.md`、デザインシステム・コーディング規約文書は見つからなかった。

## 画面と操作の比較

| 条件 | 変更前 | 修正後の実操作結果 |
| --- | --- | --- |
| 空、390×844 | 設定本文946文字、最初の設定入口y=1595。[画面](../settings-ui-baseline/settings-390-viewport.png) | 本文257文字。試験追加y=340、教材行y=456、時間枠設定y=572、計画案y=643。いずれも初画面内。[画面](empty-390-settings.png) |
| 空、1280×800 | 最初の設定入口y=1414。[画面](../settings-ui-baseline/settings-1280-viewport.png) | 試験追加y=315、教材行y=381、時間枠設定y=446。[画面](empty-1280-settings.png) |
| 各行から直接入力 | 長い警告・通知を越えて設定リンクを選ぶ | 「試験を追加」「教材を追加」は1操作で名称入力に焦点（390px y=377、PC y=421）。「時間枠を設定」は1操作で学習枠名入力に焦点（390px y=401、PC y=379）。[試験](direct-empty-試験を追加-390.png) / [教材](direct-partial-教材を追加-390.png) / [時間枠](direct-empty-時間枠を設定-390.png) |
| 追加条件 | 展開済み通知4枚を先に読む | 閉じた1行「追加の条件 · 要確認4件」。授業等の「影響」と学習枠の「期間と影響」を必要時だけ開ける。[画面](ready-unconfirmed-390-settings.png) |

## 状態別の検証

| 状態・手順 | 期待と実際 |
| --- | --- |
| 試験だけ登録→設定 | 基本設定1/3。試験1件を保持し、教材・学習枠だけ未登録と表示。 |
| 3種登録・補足未確認→計画案を作成 | 基本設定3/3、追加条件の要確認4件を区別。登録済み条件から20問の案へ進めた。補足の確認を必須入力として扱わない。 |
| 空で計画案を作成 | `role=alert`「未登録の項目を入力してください」、画面に留まる。 |
| `block=0` で計画案を作成 | 必須の件数不足とは別の `role=alert` で値の範囲と「修正する」を表示。1操作で連続時間の画面へ。 |
| 「予定なし」を明示→再読込 | 大学の授業が「未確認」から「予定なし」へ、要確認4→3。再読込しても保存。3種とも明示済みfixtureでは食事の要確認1件のみ。 |
| 通知非表示→通知管理で再表示→再読込 | 食事の通知だけ非表示。設定上の食事未設定・要確認数は残る。再表示後は非表示印が消え、予定なしの回答は保持。 |
| 設定の学習枠を削除 | 「夕方」の削除は詳細付きの確認を表示し、この時点では保存件数1。`やめる` と再読込後も1件。再度`削除する`で0件、設定3/3→2/3、再読込後も同じ。[確認](delete-prompt-390.png) / [削除後](delete-confirmed-390.png) |
| 保存失敗を注入→「予定なし」 | 変更は保存されず元の未確認へ戻る。`role=alert` が保存済みを読直したことと再入力を案内。保存revisionは1のまま。[画面](save-error.png) |
| デモ読込失敗を注入→復旧 | 「学習データを開けませんでした」、原因の `role=alert` と「もう一度読み込む」。故障解除後1操作で保存済み試験1件を復旧。壊れたJSONもブラウザーデータの原因と対処を表示。[失敗](read-error.png) / [再試行後](read-retried.png) / [壊れた保存値](invalid-envelope.png) |
| 設定から学習枠/食事へ→設定→使い方→時間枠へ | 前ビルドは以前の入力焦点が持ち越され、食事経由で390pxのh1がy=-3605へ消えた。修正後は両経路・390/1280pxの4通りすべて `scrollY=0`、h1焦点、h1 y=162/161で可視。[390px](tutorial-availability-meals-390.png) / [1280px](tutorial-availability-meals-1280.png) |

削除確認文はカードの日時・曜日を再掲して390pxで2行になる。対象が明確で、`削除する`/`やめる`が同じ視野に収まるため、操作を妨げる問題とは判断しない。

## 6領域の確認と `/interface-review`

| 領域 | 実際に確認した根拠 | 判定 |
| --- | --- | --- |
| Accessibility | 320/390/1280pxでTabから「追加の条件」「影響」「期間と影響」に到達し、3pxの可視焦点、Enter開閉、summary高44.4pxを確認。axe違反0件。設定行の入力焦点、読込エラーの`role=alert`、焦点退行の解消を確認。 | 差分内の未解決所見なし |
| Layout | 320/390/1280pxで文書幅=viewport幅、主要3行は390px初画面内。固定フッターに隠される操作は見つからず、詳細はスクロールで到達。 | なし |
| Writing | 未設定・設定済み・未確認・予定なし・通知非表示を文字で区別。値エラー/保存エラー/読込エラーは別の原因と復旧先を示す。 | なし |
| Typography | 3幅で行名、ボタン、detailsを表示。詳細summaryは実測16px、切詰めなし。 | なし |
| Colors | 状態は色だけに依存せず文字を併用。axeのコントラスト違反0件。 | なし |
| UI polish | 設定行の44pxボタン、同じ階層の配置、必要時に開く補足、確認と取消が対象カード内に収まることを確認。 | なし |

前ビルドで見つかった焦点退行（`App.tsx`の古い `availabilityTarget`）は通常ナビで対象指定を破棄する修正により解消。即削除は `Availability.tsx` のカード内確認・取消に変更。デモ読込障害の誤案内は `Startup.tsx` のデモ用エラー・再試行表示に変更。修正箇所と直接影響する設定画面に、確定した `Introduced` / `Regression` 所見はない。

## 検証範囲と結論

実操作スクリプトは `node docs/settings-ui-final/{audit,interactions,regressions,tutorial-focus,keyboard,axe,faults,notifications}.mjs`（`tutorial-focus`は`study`/`meals`で別々に実行）。結果は同名JSONと画像に保存。320/390/1280pxのブラウザー操作に基づく。native SQLite、スクリーンリーダー実機、200%ズーム、暗色全状態は未検証。デモの故障注入をnativeの保存障害確認と混同しない。

設定画面の変更範囲に対する `/interface-review` 判定：**Approve**。今回の修正後ビルドで、操作不能・データ消失・回復不能な読込案内・焦点の重大退行は再現しなかった。
