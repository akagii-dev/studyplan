import { isTauri } from '@tauri-apps/api/core';
import { Leaf, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { demoMode } from '../demo';
import { lanMode } from '../lan';
import { getLanKey, setLanKey } from '../lanStore';

export function Startup({
  error,
  loading,
  retry,
}: {
  error: string;
  loading: boolean;
  retry: () => void;
}) {
  const desktop = isTauri();
  const canRetry = desktop || demoMode || lanMode;
  const [key, setKey] = useState(() => lanMode ? getLanKey() : '');
  const [keyError, setKeyError] = useState('');
  const keyRequired = !key || /接続キー|認証|401/.test(error);
  const connect = () => {
    try {
      setLanKey(key);
      setKeyError('');
      retry();
    } catch (cause) {
      setKeyError(String(cause));
    }
  };
  return (
    <main className="startup-screen">
      <section className="card startup-card" aria-busy={loading}>
        <Leaf size={36} aria-hidden="true" />
        <h1>StudyPlan</h1>
        {!error ? (
          <p role="status">学習データを読み込んでいます…</p>
        ) : (
          <>
            <h2>{canRetry ? '学習データを開けませんでした' : 'デスクトップ版で開いてください'}</h2>
            <p>
              {desktop
                ? '保存済みのデータはそのままです。'
                : lanMode
                  ? 'Windowsの学習データに接続できません。配信PCと接続キーを確認してください。'
                  : demoMode
                    ? 'このブラウザーの保存データを確認してください。'
                    : 'StudyPlan.exeを起動すると、設定と記録を保存できます。'}
            </p>
            {lanMode && (
              <details className="startup-details" open={keyRequired}>
                <summary>接続キーを入力・変更</summary>
                <form onSubmit={(event) => { event.preventDefault(); connect(); }}>
                  <label htmlFor="lan-access-key">接続キー</label>
                  <input id="lan-access-key" type="password" autoComplete="off" spellCheck={false}
                    value={key} onChange={(event) => setKey(event.target.value)} maxLength={64} />
                  <button type="submit" disabled={loading}>接続する</button>
                </form>
                {keyError && <p className="error" role="alert">{keyError}</p>}
              </details>
            )}
            {demoMode && <p className="error" role="alert">{error}</p>}
            {canRetry && (
              <button className="primary" onClick={retry} disabled={loading}>
                <RefreshCw size={16} />
                {loading ? '読み込み中…' : 'もう一度読み込む'}
              </button>
            )}
            {!demoMode && (
              <details className="startup-details">
                <summary>エラーの詳細</summary>
                <pre>{error}</pre>
              </details>
            )}
          </>
        )}
      </section>
    </main>
  );
}
