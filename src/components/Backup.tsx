import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Undo2 } from 'lucide-react';
import { AppState, today } from '../domain/model';
import { BackupFile, MAX_BACKUP_BYTES, parseBackup, backupSummary } from '../domain/backup';
import { loadRestorePoint, validateBackup } from '../store';
import { dateTime } from '../domain/planAudit';
import { selectSaveDestination } from '../fileSave';
import { pwaMode } from '../pwa';

function Summary({ state }: { state: AppState }) {
  const n = backupSummary(state);
  return (
    <p>
      試験 {n.exams}件 ／ 教材 {n.materials}件 ／ 有効な記録 {n.records}件 ／ 学習予定 {n.sessions}
      件
    </p>
  );
}
export function Backup({
  state,
  saving,
  saved,
  onExport,
  onRestore,
}: {
  state: AppState;
  saving: boolean;
  saved: boolean;
  onExport: (path: string) => Promise<void>;
  onRestore: (text?: string) => Promise<void>;
}) {
  const [file, setFile] = useState<{ name: string; text: string; backup: BackupFile } | null>(null);
  const [previous, setPrevious] = useState<Awaited<ReturnType<typeof loadRestorePoint>>>(null);
  const [mode, setMode] = useState<'file' | 'undo' | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const selected = useRef(0);
  useEffect(() => {
    void loadRestorePoint()
      .then(setPrevious)
      .catch((e) => setError(String(e)));
  }, [state]);
  const unavailable = busy || saving;
  async function exportFile() {
    if (locked.current || unavailable) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const path = await selectSaveDestination({
        title: 'バックアップを保存',
        defaultPath: `StudyPlan-${today()}.studyplan.json`,
        filters: [{ name: 'StudyPlanバックアップ', extensions: ['studyplan.json'] }],
      });
      if (!path) return;
      await onExport(path);
      setMessage(`${pwaMode ? 'ダウンロードを開始しました' : '保存しました'}：${path}`);
    } catch (e) {
      setError(String(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function readFile(input: File | undefined) {
    const ticket = ++selected.current;
    setFile(null);
    setMode(null);
    setChecked(false);
    setError('');
    setMessage('');
    if (!input) return;
    setBusy(true);
    try {
      if (input.size > MAX_BACKUP_BYTES)
        throw new Error('50MB以下のバックアップを選んでください。');
      const text = await input.text();
      const backup = parseBackup(text);
      await validateBackup(text);
      if (ticket === selected.current) {
        setFile({ name: input.name, text, backup });
        setMode('file');
      }
    } catch (e) {
      if (ticket === selected.current) setError(String(e));
    } finally {
      if (ticket === selected.current) setBusy(false);
    }
  }
  async function restore() {
    if (!checked || !mode || locked.current || unavailable || (mode === 'file' && !file)) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await onRestore(mode === 'file' ? file!.text : undefined);
      setFile(null);
      setMode(null);
      setChecked(false);
      setMessage('復元しました。');
      setPrevious(await loadRestorePoint());
    } catch (e) {
      setError(String(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const candidate = mode === 'file' ? file?.backup.data : previous?.data;
  return (
    <div className="backup-page">
      <section className="card">
        <h2>バックアップを保存</h2>
        <p>設定・計画・実績を、ひとつのファイルに保存します。</p>
        <Summary state={state} />
        <button
          className="primary"
          disabled={unavailable || !saved}
          onClick={() => void exportFile()}
        >
          <Download size={18} />
          バックアップを保存する
        </button>
        {!saved && <p className="hint">設定を入力すると保存できます。</p>}
      </section>
      <section className="card">
        <h2>バックアップから復元</h2>
        <label className="file-picker">
          <Upload size={18} />
          ファイルを選択
          <input
            aria-label="復元するバックアップ"
            type="file"
            accept=".json,.studyplan.json"
            disabled={unavailable}
            onChange={(e) => {
              void readFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {previous && (
          <button
            disabled={unavailable}
            onClick={() => {
              setMode('undo');
              setChecked(false);
              setError('');
              setMessage('');
            }}
          >
            <Undo2 size={16} />
            前回の復元前に戻す
          </button>
        )}
        {mode && candidate && (
          <section className="confirmation-panel" aria-label="バックアップ復元の確認">
            <h3>{mode === 'file' ? file!.name : '前回の復元前のデータ'}</h3>
            <p>{dateTime(mode === 'file' ? file!.backup.createdAt : previous!.savedAt)}</p>
            <Summary state={candidate} />
            <p>
              <b>現在の設定・計画・実績を、上の内容で置き換えます。</b>
              直前のデータは1回分残し、復元を取り消せます。
            </p>
            <label className="reset-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                disabled={unavailable}
              />
              置き換える内容を確認しました
            </label>
            <div className="actions">
              <button
                className="primary"
                disabled={!checked || unavailable}
                onClick={() => void restore()}
              >
                この内容で復元する
              </button>
              <button
                disabled={unavailable}
                onClick={() => {
                  setMode(null);
                  setFile(null);
                }}
              >
                やめる
              </button>
            </div>
          </section>
        )}
      </section>
      {busy && <p role="status">処理しています…</p>}
      {message && (
        <p className="note" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
