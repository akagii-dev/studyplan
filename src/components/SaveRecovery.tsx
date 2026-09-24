import { useState } from 'react';
import { demoMode } from '../demo';
import { pwaMode } from '../pwa';

export function SaveRecovery({
  checking,
  detail,
  retry,
  closeWithoutSaving,
}: {
  checking: boolean;
  detail: string;
  retry: () => void;
  closeWithoutSaving: () => Promise<void>;
}) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const exit = demoMode || pwaMode ? '再読み込み' : '終了';
  async function close() {
    if (closing) return;
    setClosing(true);
    try {
      await closeWithoutSaving();
    } catch (error) {
      setError(String(error));
      setClosing(false);
    }
  }
  return (
    <div className="save-overlay" role="dialog" aria-modal="true" aria-label="保存状態の確認">
      <section className="card save-recovery">
        {confirmClose ? (
          <>
            <h2>保存を確認せずに{exit}しますか？</h2>
            <p>保存できていない変更は失われます。すでに保存された内容は残ります。</p>
            <div className="actions">
              <button autoFocus disabled={closing} onClick={() => setConfirmClose(false)}>
                戻る
              </button>
              <button disabled={closing} onClick={() => void close()}>
                {closing ? `${exit}しています…` : `${exit}する`}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>{checking ? '保存内容を確認しています…' : '保存状態を確認できません'}</h2>
            <p>最後の変更を保存できたか不明です。確認できるまで編集を止めています。</p>
            <p>保存済みの内容を読み直した後、反映されていない変更は入力し直してください。</p>
            {detail && (
              <details>
                <summary>エラーの詳細</summary>
                <p>{detail}</p>
              </details>
            )}
            <div className="actions">
              <button autoFocus className="primary" disabled={checking} onClick={retry}>
                保存済みの内容を読み直す
              </button>
              <button disabled={checking} onClick={() => setConfirmClose(true)}>
                保存を確認せずに{exit}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
