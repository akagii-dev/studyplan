import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  DesktopLanStatus,
  loadDesktopLanStatus,
  lanAddressLabel,
  startDesktopLan,
  stopDesktopLan,
} from '../desktopLan';

/** Desktop process controls only. Credentials never enter AppState or browser storage. */
export function LanSharing() {
  const [status, setStatus] = useState<DesktopLanStatus | null>(null);
  const [address, setAddress] = useState('');
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
      next.addresses.some((candidate) => candidate.address === current) ? current :
        next.addresses.length === 1 ? next.addresses[0].address : '');
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
  const activeCandidate = status?.addresses.find((candidate) => candidate.address === status.address);
  const selectedCandidate = status?.addresses.find((candidate) => candidate.address === address);
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
    <details className="card lan-sharing [&_button]:min-h-11 [&_select]:min-h-11">
      <summary className="cursor-pointer text-[16px] font-[650]">LAN公開 <span className="ms-2 text-[14px] font-normal" role="status">{statusLabel}</span></summary>
      <div className="mt-4 grid gap-4 [&_p]:m-0 [&_p]:[overflow-wrap:anywhere]" aria-busy={pending !== null}>
        <p id="lan-sharing-warning" className="text-warning">
          <strong>注意：</strong>同じWi-Fiの信頼できる端末で使用してください。HTTP通信は暗号化されません。
          {!status?.active && 'キーを知る人は学習データを閲覧・変更できます。'}
        </p>
        {error && <p id="lan-sharing-error" className="error" role="alert">{error}</p>}
        {status?.active ? (
          <>
            <p>LAN公開先：{activeCandidate ? lanAddressLabel(activeCandidate) : status.address}</p>
            <p id="lan-sharing-key-warning" className="text-warning">
              キーを知る人は学習データを閲覧・変更できます。接続リンク・QRコードにもキーを含みます。共有しないでください。
            </p>
            {connectionLink && (
              <figure className="m-0 grid gap-2 [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full">
                <figcaption className="font-[650]">スマホで接続（APIキー付き）</figcaption>
                <QRCodeSVG value={connectionLink} size={240} level="M" marginSize={4}
                  bgColor="#ffffff" fgColor="#000000" role="img"
                  aria-label="LAN接続用QRコード" aria-describedby="lan-sharing-key-warning" />
              </figure>
            )}
            <div className="grid min-w-0 gap-2 [&>label]:font-[650] [&_button]:[justify-self:start]">
              <label htmlFor="lan-sharing-url">接続先URL</label>
              <textarea className="w-full resize-y rounded-[8px] border border-control bg-surface px-2.5 py-2 text-ink [font:16px/1.5_Consolas,monospace] [overflow-wrap:anywhere]" id="lan-sharing-url" value={status.url ?? ''} readOnly rows={2} spellCheck={false} dir="ltr"
                onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copy('link')} disabled={!!pending || !connectionLink}>
                接続リンクをコピー
              </button>
            </div>
            <div className="grid min-w-0 gap-2 [&>label]:font-[650] [&_button]:[justify-self:start]">
              <label htmlFor="lan-sharing-key">APIキー</label>
              <textarea className="w-full resize-y rounded-[8px] border border-control bg-surface px-2.5 py-2 text-ink [font:16px/1.5_Consolas,monospace] [overflow-wrap:anywhere]" id="lan-sharing-key" ref={keyField} value={status.key ?? ''} readOnly rows={3} spellCheck={false} dir="ltr"
                aria-describedby="lan-sharing-key-warning" onFocus={(event) => event.currentTarget.select()} />
              <button type="button" onClick={() => void copy('key')} disabled={!!pending || !status.key}>
                APIキーをコピー
              </button>
            </div>
            {manualCopy === 'link' && (
              <div className="grid min-w-0 gap-2 [&>label]:font-[650] [&_button]:[justify-self:start]">
                <label htmlFor="lan-sharing-manual-link">手動コピー用の接続リンク</label>
                <textarea className="w-full resize-y rounded-[8px] border border-control bg-surface px-2.5 py-2 text-ink [font:16px/1.5_Consolas,monospace] [overflow-wrap:anywhere]" id="lan-sharing-manual-link" ref={linkField} value={connectionLink} readOnly rows={4} spellCheck={false} dir="ltr"
                  aria-describedby="lan-sharing-key-warning" onFocus={(event) => event.currentTarget.select()} />
              </div>
            )}
          </>
        ) : status && !pending && (
          status.addresses.length > 1 ? (
            <div className="grid min-w-0 gap-2 [&>label]:font-[650] [&_button]:[justify-self:start]">
              <label htmlFor="lan-sharing-address">使用するLANアドレス</label>
              <select id="lan-sharing-address" ref={addressField} value={address} aria-invalid={addressError || undefined}
                aria-describedby={addressError ? 'lan-sharing-error' : undefined}
                onChange={(event) => { setAddress(event.target.value); setAddressError(false); setError(''); }}>
                <option value="">選択してください</option>
                {status.addresses.map((candidate) => <option key={candidate.address} value={candidate.address}>{lanAddressLabel(candidate)}</option>)}
              </select>
              {selectedCandidate && <output className="lan-sharing-selection hidden [overflow-wrap:anywhere] @max-[700px]:block" htmlFor="lan-sharing-address" aria-label="選択中のLAN公開先">
                {lanAddressLabel(selectedCandidate)}
              </output>}
            </div>
          ) : status.addresses.length === 1 ? <p>LANアドレス：{lanAddressLabel(status.addresses[0])}</p> :
            <p>LANが見つかりません。Wi-Fiまたは有線LANに接続して、状態を再確認してください。</p>
        )}
        <p className="text-muted">アプリ終了で公開を停止します。開始するたびにキーが変わります。</p>
        <div className="flex flex-wrap gap-2">
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
