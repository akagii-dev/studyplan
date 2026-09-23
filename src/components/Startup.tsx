import { isTauri } from '@tauri-apps/api/core';
import { Leaf, RefreshCw } from 'lucide-react';
import { demoMode } from '../demo';

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
  const canRetry = desktop || demoMode;
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
                : demoMode
                  ? 'このブラウザーの保存データを確認してください。'
                  : 'StudyPlan.exeを起動すると、設定と記録を保存できます。'}
            </p>
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
