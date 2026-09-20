import { useState } from 'react';
import { resetSetup, restoreReset } from '../domain/reset';
import { Props } from './common';
export function ResetSetup({ state, update }: Props) {
  const [mode, setMode] = useState<'questions' | 'all' | 'restore' | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = (value: typeof mode) => {
    setMode(value);
    setChecked(false);
    setError('');
  };
  const apply = async () => {
    if (!mode || !checked || busy) return;
    setBusy(true);
    try {
      await update((s) => (mode === 'restore' ? restoreReset(s) : resetSetup(s, mode === 'all')));
      choose(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="reset-settings">
      <summary>初期設定を初期化する</summary>
      <p>やり直す範囲を選んでください。確認するまでは変更されません。</p>
      <div className="actions">
        <button onClick={() => choose('questions')}>質問の進行だけ最初に戻す</button>
        <button className="text-danger" onClick={() => choose('all')}>
          設定・計画・記録を初期化する
        </button>
        {state.resetBackup && (
          <button onClick={() => choose('restore')}>初期化前のデータを復元する</button>
        )}
      </div>
      {mode && (
        <section className="confirmation-panel" role="region" aria-label="初期化の確認">
          <h3>
            {mode === 'all'
              ? '登録データ全体を初期化します'
              : mode === 'restore'
                ? '初期化前のデータに戻します'
                : '初期設定の質問を最初に戻します'}
          </h3>
          <p>
            {mode === 'all'
              ? `試験${state.settings.exams.length}件・教材${state.settings.materials.length}件・時間枠${state.settings.windows.length}件・食事・連続時間・余裕率・計画・固定予定・記録${state.records.length}件・下書きを現在の一覧から消去します。直前のデータは端末内に1世代保存し、復元できます。`
              : mode === 'restore'
                ? '初期化後に入力した内容を、初期化直前の設定・計画・記録で置き換えます。'
                : '質問の位置と入力途中の回答を戻します。登録済みの設定・教材・計画・固定予定・実績は残ります。'}
          </p>
          <label className="reset-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            変更される範囲を確認しました
          </label>
          <div className="actions">
            <button disabled={!checked || busy} onClick={() => void apply()}>
              {mode === 'restore' ? '復元を確定する' : '初期化を確定する'}
            </button>
            <button disabled={busy} onClick={() => choose(null)}>
              やめる
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </details>
  );
}
