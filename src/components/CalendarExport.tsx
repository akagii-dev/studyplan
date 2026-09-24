import { Warning } from './Warnings';
import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { AppState } from '../domain/model';
import { createCalendarFile, CalendarExportOptions } from '../domain/icalendar';
import { stalePlan } from '../domain/planAudit';
import { exportCalendar } from '../store';
import { Field } from './common';
import { demoMode } from '../demo';
import { selectSaveDestination } from '../fileSave';
import { pwaMode } from '../pwa';

type CalendarExportProps = {
  state: AppState;
  from: string;
  to: string;
  examId?: string;
};

export function CalendarExport(props: CalendarExportProps) {
  if (demoMode) return null;
  return <DesktopCalendarExport {...props} />;
}

function DesktopCalendarExport({ state, from, to, examId = 'all' }: CalendarExportProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CalendarExportOptions>({
    from,
    to,
    examId,
    study: !!state.plan,
    classes: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  async function write() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const file = createCalendarFile(state, options);
      const path = await selectSaveDestination({
        title: 'カレンダーを書き出す',
        defaultPath: `StudyPlan-${options.from}.ics`,
        filters: [{ name: 'カレンダー', extensions: ['ics'] }],
      });
      if (!path) return;
      await exportCalendar(path, file.text);
      setMessage(`${pwaMode ? 'ダウンロードを開始しました' : '書き出しました'}：学習 ${file.study}件・授業 ${file.classes}件`);
    } catch (e) {
      setError(String(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="calendar-export">
      <button
        disabled={busy}
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setOptions({ from, to, examId, study: !!state.plan, classes: true });
            setError('');
            setMessage('');
          }
          setOpen(!open);
        }}
      >
        <Download size={16} />
        ICSを書き出す
      </button>
      {open && (
        <section className="card" aria-label="ICS書き出し">
          <h3>カレンダーファイルを保存</h3>
          <fieldset disabled={busy}>
            <div className="two">
              <Field label="書き出す開始日">
                <input
                  type="date"
                  value={options.from}
                  onChange={(e) => setOptions({ ...options, from: e.target.value })}
                />
              </Field>
              <Field label="書き出す終了日">
                <input
                  type="date"
                  value={options.to}
                  onChange={(e) => setOptions({ ...options, to: e.target.value })}
                />
              </Field>
            </div>
            <div className="actions">
              <label className="export-check">
                <input
                  type="checkbox"
                  checked={options.study}
                  onChange={(e) => setOptions({ ...options, study: e.target.checked })}
                />
                学習予定
              </label>
              <label className="export-check">
                <input
                  type="checkbox"
                  checked={options.classes}
                  onChange={(e) => setOptions({ ...options, classes: e.target.checked })}
                />
                大学の授業（授業名付き）
              </label>
            </div>
            {options.study && (
              <Field label="書き出す試験">
                <select
                  value={options.examId}
                  onChange={(e) => setOptions({ ...options, examId: e.target.value })}
                >
                  <option value="all">すべての試験</option>
                  {state.settings.exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </fieldset>
          {options.study && stalePlan(state.plan, state.settings) && (
            <Warning
              id="calendarexport-0"
              title="書き出す計画に最新の設定が未反映です"
              version={[state.plan?.id, state.settings]}
            >
              学習予定に、最新の設定がまだ反映されていません。必要に応じて再計画してください。
            </Warning>
          )}
          <p className="hint">
            承認済みの学習予定・現在の時間割 ／ 時刻：
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
          <p className="hint">書き出したファイルは、再計画しても自動更新されません。</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void write()}>
              {busy ? '書き出し中…' : 'ICSを保存する'}
            </button>
            <button disabled={busy} onClick={() => setOpen(false)}>
              閉じる
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
