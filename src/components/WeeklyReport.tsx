import { useEffect, useMemo, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { AppState, addDays, today } from '../domain/model';
import { startOfWeek } from '../domain/calendar';
import { createWeeklyReport, reportRate } from '../domain/weeklyReport';
import { exportMarkdown } from '../store';
import { Field } from './common';

export function WeeklyReport({
  state,
  saving,
  readSaved,
}: {
  state: AppState;
  saving: boolean;
  readSaved: () => Promise<AppState>;
}) {
  const [selected, setSelected] = useState(today());
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const preview = useMemo(() => {
    try {
      return { report: createWeeklyReport(state, selected, now), error: '' };
    } catch (e) {
      return { report: null, error: (e as Error).message };
    }
  }, [state, selected, now]);
  const report = preview.report;
  const change = (date: string) => {
    setSelected(date);
    setError('');
    setMessage('');
  };
  async function write() {
    if (locked.current || saving) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      // Read the committed SQLite state once so the exported sections share one snapshot.
      const file = createWeeklyReport(await readSaved(), selected);
      const path = await save({
        title: '週間レポートを保存',
        defaultPath: file.filename,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!path) return;
      await exportMarkdown(path, file.markdown);
      setMessage(`${file.from}〜${file.to}のレポートを保存しました。`);
    } catch (e) {
      setError(String(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <section className="card report-controls" aria-label="週間レポートの書き出し">
        <Field label="レポートの対象日（その日を含む週）">
          <input
            type="date"
            value={selected}
            max={today()}
            disabled={busy}
            onChange={(e) => change(e.target.value)}
          />
        </Field>
        <div className="actions">
          <button
            disabled={busy || !report}
            onClick={() => report && change(addDays(report.from, -7))}
          >
            <ChevronLeft size={16} />
            前の週
          </button>
          <button disabled={busy} onClick={() => change(today())}>
            今週
          </button>
          <button
            disabled={busy || !report || report.from >= startOfWeek(today())}
            onClick={() => report && change(addDays(report.from, 7))}
          >
            次の週
            <ChevronRight size={16} />
          </button>
          <button
            className="primary"
            disabled={busy || saving || !report}
            onClick={() => void write()}
          >
            <Download size={16} />
            {busy ? '書き出し中…' : 'Markdownを保存'}
          </button>
        </div>
        {(error || preview.error) && (
          <p className="error" role="alert">
            {error || preview.error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      {report && (
        <section aria-label="週間レポートのプレビュー">
          <h2>
            {report.from}〜{report.to}
          </h2>
          <p>月曜〜日曜 ／ 全体の進捗は出力時点</p>
          <div className="metrics report-metrics">
            <div className="metric-card">
              <span>この週に記録した問題</span>
              <strong>
                {report.recordCount ? report.totals.weekDone : '—'}
                <small>{report.recordCount ? '問' : '記録なし'}</small>
              </strong>
              <p>週間予定 {report.hasPlan ? `${report.totals.weekPlanned}問` : 'なし'}</p>
            </div>
            <div className="metric-card">
              <span>全体の進捗率</span>
              <strong>{reportRate(report.totals.done, report.totals.total)}</strong>
              <p>
                完了 {report.totals.done} / {report.totals.total}問
              </p>
            </div>
            <div className="metric-card">
              <span>この週の記録 / 全体の総問題数</span>
              <strong>
                {report.recordCount ? reportRate(report.totals.weekDone, report.totals.total) : '—'}
              </strong>
              <p>全体の残り {report.totals.remaining}問</p>
            </div>
          </div>
          {report.settingsChanged && (
            <p className="warning">週間予定には、現在の設定がまだ反映されていません。</p>
          )}
          <section className="card">
            <h3>試験ごとの比較</h3>
            <div
              className="report-table"
              role="region"
              aria-label="試験ごとの週間・全体比較"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>試験</th>
                    <th>週の予定</th>
                    <th>週の記録</th>
                    <th>全体の完了 / 総数</th>
                    <th>全体の進捗</th>
                  </tr>
                </thead>
                <tbody>
                  {report.exams.map((e, i) => (
                    <tr key={i}>
                      <td>{e.name}</td>
                      <td>{e.weekPlanned}問</td>
                      <td>{e.recordCount ? `${e.weekDone}問` : '記録なし'}</td>
                      <td>
                        {e.done} / {e.total}問
                      </td>
                      <td>{reportRate(e.done, e.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.exams.length && <p>試験はまだ登録されていません。</p>}
          </section>
          <section className="card">
            <h3>日別の予定・実績</h3>
            <div className="report-table" role="region" aria-label="週間の日別実績" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>予定</th>
                    <th>追加完了</th>
                    <th>報告状態</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{d.planned}問</td>
                      <td>{d.done === null ? '記録なし' : `${d.done}問`}</td>
                      <td>{d.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <details className="card report-markdown">
            <summary>Markdownの内容を確認</summary>
            <pre tabIndex={0} aria-label="書き出すMarkdown">
              {report.markdown}
            </pre>
          </details>
        </section>
      )}
    </>
  );
}
