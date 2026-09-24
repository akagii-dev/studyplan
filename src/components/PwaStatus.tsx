import { useState } from 'react';
import { checkPwaStatus, usePwaStatus } from '../pwaRuntime';

export function PwaStatus() {
  const status = usePwaStatus();
  const [checking, setChecking] = useState(false);
  const [persistence, setPersistence] = useState('');
  return (
    <details className="card settings-extra">
      <summary>端末とオフライン</summary>
      <p role="status">
        {status.offline === 'ready' ? 'オフライン利用の準備ができました' :
          status.offline === 'unsupported' ? 'この接続ではオフライン起動を使えません。対応ブラウザーとHTTPS接続が必要です。' :
          status.offline === 'checking' ? 'アプリの保存状況を確認中…' : 'オフライン準備未完了。配信PCへ接続して再確認してください。'}
      </p>
      <p>配信PC：{status.host === 'reachable' ? '接続できます' : status.host === 'checking' ? '確認中…' : '接続できません'}</p>
      <p>学習データはこの端末内に保存されます。PC版との受け渡しはバックアップを使います。</p>
      {status.update && <p role="status">更新があります。保存済みを確認し、StudyPlanの全タブを閉じて開き直してください。</p>}
      <div className="actions">
        <button disabled={checking} onClick={() => {
          setChecking(true);
          void checkPwaStatus().finally(() => setChecking(false));
        }}>{checking ? '確認中…' : '接続・オフラインを再確認'}</button>
        <button onClick={() => {
          void (navigator.storage?.persist?.() ?? Promise.resolve(false))
            .then((granted) => setPersistence(granted ? '自動削除からの保護が許可されました。' : '保護は許可されていません。バックアップを残してください。'))
            .catch(() => setPersistence('保護の状態を確認できません。バックアップを残してください。'));
        }}>端末内データの保護を要求</button>
      </div>
      {persistence && <p role="status">{persistence}</p>}
      <details>
        <summary>iPhoneへの追加と保存先</summary>
        <p>Safariの共有から「ホーム画面に追加」。追加後のアイコンから開き、オフライン準備を確認してから使ってください。</p>
        <p>Safariとホーム画面アプリ、別のURLは保存領域が異なる場合があります。必要なデータはバックアップで移してください。ブラウザーのデータ削除に備え、定期的に書き出してください。</p>
      </details>
    </details>
  );
}
