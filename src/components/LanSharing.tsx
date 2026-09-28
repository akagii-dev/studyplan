import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  DesktopLanStatus,
  loadDesktopLanStatus,
  loadDesktopNetworkNames,
  lanAddressLabel,
  startDesktopLan,
  stopDesktopLan,
} from '../desktopLan';

/** Desktop process controls only. Credentials never enter AppState or browser storage. */
export function LanSharing() {
  const [status, setStatus] = useState<DesktopLanStatus | null>(null);
  const [address, setAddress] = useState('');
  const [networkNames, setNetworkNames] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<'check' | 'start' | 'stop' | null>('check');
  const [error, setError] = useState('');
  const [addressError, setAddressError] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [manualCopy, setManualCopy] = useState<'link' | 'key' | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const keyField = useRef<HTMLTextAreaElement>(null);
  const linkField = useRef<HTMLTextAreaElement>(null);
  const addressField = useRef<HTMLSelectElement>(null);

  const applyStatus = useCallback((next: DesktopLanStatus) => {
    setStatus(next);
    setAddress((current) => next.active ? next.address ?? '' :
      next.addresses.includes(current) ? current : next.addresses.length === 1 ? next.addresses[0] : '');
    if (!next.active) {
      setManualCopy(null);
      setCopyMessage('');
    }
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPending('check');
    setError('');
    setAddressError(false);
    void loadDesktopNetworkNames().then((names) => {
      if (mounted.current) setNetworkNames(names);
    }).catch(() => { if (mounted.current) setNetworkNames({}); });
    try {
      const next = await loadDesktopLanStatus();
      if (mounted.current) applyStatus(next);
    } catch (cause) {
      if (mounted.current) {
        setStatus(null);
        setError(`公開状態を確認できませんでした。状態を再確認してください。 ${String(cause)}`);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }, [applyStatus]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    const field = manualCopy === 'link' ? linkField.current : manualCopy === 'key' ? keyField.current : null;
    field?.focus();
    field?.select();
  }, [manualCopy]);

  async function changeSharing(action: 'start' | 'stop') {
    if (busy.current) return;
    if (action === 'start' && !address) {
      setAddressError(true);
      setError('使用するLANアドレスを選んでください。');
      addressField.current?.focus();
      return;
    }
    busy.current = true;
    setPending(action);
    setError('');
    setAddressError(false);
    setCopyMessage('');
    setManualCopy(null);
    try {
      const next = action === 'start' ? await startDesktopLan(address) : await stopDesktopLan();
      if (mounted.current) applyStatus(next);
    } catch (cause) {
      if (mounted.current) setError(`公開を${action === 'start' ? '開始' : '停止'}できませんでした。 ${String(cause)}`);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(null);
    }
  }

  const connectionLink = status?.active && status.url && status.key ? `${status.url}#key=${status.key}` : '';
  async function copy(kind: 'link' | 'key') {
    const value = kind === 'link' ? connectionLink : status?.key;
    if (!value) return;
    setCopyMessage('');
    try {
      await navigator.clipboard.writeText(value);
      setManualCopy(null);
      setCopyMessage(`${kind === 'link' ? '接続リンク' : 'APIキー'}をコピーしました。`);
    } catch {
      setManualCopy(kind);
      setCopyMessage('コピーできませんでした。選択された文字を手動でコピーしてください。');
      const field = kind === 'link' ? linkField.current : keyField.current;
      field?.focus();
      field?.select();
    }
  }

  const statusLabel = pending === 'start' ? '開始中' : pending === 'stop' ? '停止処理中' :
    pending === 'check' ? '確認中' : !status ? '状態未確認' : status.active ? '公開中' : '停止中';

  return (
    <details className="card lan-sharing">
      <summary>LAN公開 <span role="status">{statusLabel}</span></summary>
      <div className="lan-sharing-content" aria-busy={pending !== null}>
        <p id="lan-sharing-warning" className="lan-sharing-warning">
          <strong>注意：</strong>同じWi-Fiの信頼できる端末で使用してください。HTTP通信は暗号化されません。
          {!status?.active && 'キーを知る人は学習データを閲覧・変更できます。'}
        </p>
        {error && <p id="lan-sharing-error" className="error" role="alert">{error}</p>}
        {status?.active ? (
          <>
            <p id="lan-sharing-key-warning" className="lan-sharing-warning">
              キーを知る人は学習データを閲覧・変更できます。接続リンク・QRコードにもキーを含みます。共有しないでください。
            </p>
            {connectionLink && (
              <figure className="lan-sharing-qr">
                <figcaption>スマホで接続（APIキー付き）</figcaption>
                <QRCodeSVG value={connectionLink} size={240} level="M" marginSize={4}
                  bgColor="#ffffff" fgColor="#000000" role="img"
                  aria-label="LAN接続用QRコード" aria-describedby="lan-sharing-key-warning" />
              </figure>
            )}
            <div className="lan-sharing-field">
              <label htmlFor="lan-sharing-url">接続先URL</label>
              <textarea id="lan-sharing-url" value={status.url ?? ''} readOnly rows={2} spellCheck={false} dir="ltr"
                onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copy('link')} disabled={!!pending || !connectionLink}>
                接続リンクをコピー
              </button>
            </div>
            <div className="lan-sharing-field">
              <label htmlFor="lan-sharing-key">APIキー</label>
              <textarea id="lan-sharing-key" ref={keyField} value={status.key ?? ''} readOnly rows={3} spellCheck={false} dir="ltr"
                aria-describedby="lan-sharing-key-warning" onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copy('key')} disabled={!!pending || !status.key}>
                APIキーをコピー
              </button>
            </div>
            {manualCopy === 'link' && (
              <div className="lan-sharing-field">
                <label htmlFor="lan-sharing-manual-link">手動コピー用の接続リンク</label>
                <textarea id="lan-sharing-manual-link" ref={linkField} value={connectionLink} readOnly rows={4} spellCheck={false} dir="ltr"
                  aria-describedby="lan-sharing-key-warning" onFocus={(event) => event.currentTarget.select()} />
              </div>
            )}
          </>
        ) : status && !pending && (
          status.addresses.length > 1 ? (
            <label className="lan-sharing-field">
              使用するLANアドレス
              <select ref={addressField} value={address} aria-invalid={addressError || undefined}
                aria-describedby={addressError ? 'lan-sharing-error' : undefined}
                onChange={(event) => { setAddress(event.target.value); setAddressError(false); setError(''); }}>
                <option value="">選択してください</option>
                {status.addresses.map((candidate) => <option key={candidate} value={candidate}>{lanAddressLabel(candidate, networkNames)}</option>)}
              </select>
            </label>
          ) : status.addresses.length === 1 ? <p>LANアドレス：{lanAddressLabel(status.addresses[0], networkNames)}</p> :
            <p>LANが見つかりません。Wi-Fiまたは有線LANに接続して、状態を再確認してください。</p>
        )}
        <p className="lan-sharing-lifetime">アプリ終了で公開を停止します。開始するたびにキーが変わります。</p>
        <div className="lan-sharing-actions">
          {status?.active ? (
            <button type="button" onClick={() => void changeSharing('stop')} disabled={!!pending}>
              {pending === 'stop' ? '公開を停止中…' : '公開を停止'}
            </button>
          ) : (
            <button type="button" onClick={() => void changeSharing('start')}
              aria-describedby="lan-sharing-warning" disabled={!!pending || !status || !status.addresses.length}>
              {pending === 'start' ? '公開を開始中…' : 'LANに公開'}
            </button>
          )}
          <button type="button" onClick={() => void refresh()} disabled={!!pending}>状態を再確認</button>
        </div>
        <p className="lan-sharing-copy-result" role="status">{copyMessage}</p>
      </div>
    </details>
  );
}
