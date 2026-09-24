# 予定・詳細カレンダー改善の記録

2026-09-24。対象差分は`895afe8`から今回の作業ツリー。React/TypeScript/Tauri 2、既存CSSトークンを使用。新しいUIライブラリは追加していない。

## 共有変更の確認

- 開始時は`main`、`f901dd1`、未コミット変更なし。リポジトリと上位の作業範囲にAGENTS.mdなし。
- originをfetchし、`8ec0413`（v0.4.15の日々の記録・設定導線）と`895afe8`（戻る導線・予定調整差分・日付表示）を確認。コード、既存テスト、実画面で確認し、fast-forwardで取り込んだ。reset、clean、強制上書きは行っていない。
- 既存の戻る履歴・スクロール復元、記録後の予定調整、取消の除外、密度切替を再実装せず利用した。週の範囲選択と数量モード、日別比較基準は未実装だったため今回追加した。
- 別端末からリモートへ共有されていない変更は確認不能。コミットの端末そのものも特定していない。

## UI Skillsと独立レビュー

[配布元](https://jakub.kr/skills)とリンク先の`jakubkrehel/skills`を確認。コミット`267330e1adfc66a718fb65fa6918c1f06d0a689e`の内容を読み、以下をプロジェクトの`.agents/skills/`へ導入した。

`better-interface`、`interface-review`、`better-accessibility`、`better-layout`、`better-writing`、`better-typography`、`better-colors`、`better-ui`。

導入前に同名フォルダーがないことを確認し、既存Skillは上書きしていない。公式skill-installerの`install-skill-from-github.py`で、`--repo jakubkrehel/skills --ref 267330e1adfc66a718fb65fa6918c1f06d0a689e --path skills/better-interface skills/interface-review skills/better-accessibility skills/better-layout skills/better-writing skills/better-typography skills/better-colors skills/better-ui --dest <repo>/.agents/skills`を指定した。配布ファイルは既存の`.gitignore`に従いローカル導入とし、共有済み`skills-lock.json`を書き換えていない。

[Codex公式Skills手順](https://learn.chatgpt.com/docs/build-skills)でプロジェクト配置を確認。現在のセッションで親とレビュー担当が導入済みSKILL.mdを直接読み、画面・差分レビューへ適用した。次のセッションでは`$better-interface` / `$interface-review`を指定して利用する。アプリを再起動してスキル選択候補に載るかは未検証。

[Codex公式サブエージェント手順](https://learn.chatgpt.com/docs/agent-configuration/subagents)と実際に提供された`collaboration.spawn_agent`を確認。`calendar_review`を1担当だけ起動し、コード・テスト・スクリーンショットの読み取り専用レビューを受けた。設定ファイル、承認、サンドボックスの制限は緩めていない。

## レビュー範囲と結果

今後の予定、詳細カレンダー、教材別内訳、そこから遷移する記録画面を対象とした。計画生成アルゴリズムは変更対象外。生成JSON・Skillの配布ファイルはUI差分レビュー対象外。

| 観点 | 証拠・確認内容 | 結果 |
| --- | --- | --- |
| Accessibility | button、aria-pressed、dl、日付の可視ラベルと名前、キーボード、axe | 指摘修正済み |
| Layout | 1280/390/320px、週とスクロールの復元、200%文字拡大 | 指摘修正済み |
| Writing | 残り／その日の不足／未実施、未記録／0、基準なし | 明確 |
| Typography | 数字の強調、ラベル・値の隣接、rem基準の折返し | 指摘修正済み |
| Colors | 既存トークン、色に依存しない状態、3テーマ×明暗のaxe | 対象画面で違反なし |
| UI polish | 既存カレンダーの共有、重複実績の削除、空の内訳操作を省略 | 問題なし |

独立レビューで見つかった「一覧で保存済み基準だけある日が欠落」「月日・曜日の識別不足」「日付の可視ラベルとaccessible nameの不一致」「記録画面の単位表記」「文字拡大で固定px列が狭い」は修正した。最終差分に未解決のHIGH/MEDIUM指摘なし。親の実画面確認では内訳ボタンの10px継承も修正し、既存カード内の重複実績を省いた。

独立担当はコード・テスト定義・提供画像を確認した。ブラウザー実操作、コントラスト測定、Tauri実機試験は親担当が実施しており、独立した再実行とは区別する。

## 検証

詳細は[VALIDATION.md](VALIDATION.md)の2026-09-24節。通常利用の保存先を使わず、新しいブラウザーcontextと`.test-data/native-*`のSQLiteで実施した。

- 単体テスト303件、型検査、lint、通常ビルド・デモビルド、Rust debugビルド。
- 新規ブラウザー試験：週送りと戻る位置、内容／学習量、過去基準、明示0、取消除外、旧データの基準なし、異なる単位、記録対象への遷移。
- 既存13件の日々の記録フローと、戻る導線・訂正・取消・保存失敗の表示を回帰確認。
- Tauri実機：記録・訂正・取消・超過・予定外記録、SQLite再起動、日別基準と表示の保持。
- 画像：`test-results/calendar-quantity/viewport-1280.png`、`viewport-390.png`、`quantity-320.png`、`expanded-320.png`。

未検証：全ネイティブE2Eの一括再実行、スクリーンリーダーの実聴、配布インストーラーでの動作、Skill選択UIの再起動後の検出。axeだけでアプリ全体のWCAG準拠とは判定しない。旧データから復元できない過去基準は仕様どおり欠損として表示する。任意単位の入力設定と、繰越課題の解消追跡は追加していない。

## 判定

Approve：確認した差分・画面・操作範囲に未解決の重大な指摘なし。
