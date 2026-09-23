import { Warning } from './Warnings';
import { useEffect, useMemo, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { AppState, addDays, today } from '../domain/model';
import { startOfWeek } from '../domain/calendar';
import { createWeeklyReport, dailyReportDetails, reportRate } from '../domain/weeklyReport';
import { exportMarkdown } from '../store';
import { Field, duration } from './common';
import { demoMode } from '../demo';

export function WeeklyReport({
  state,
  saving,
  readSaved,
  onDetailChange,
}: {
  state: AppState;
  saving: boolean;
  readSaved: () => Promise<AppState>;
  onDetailChange?: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState(today());
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const reportScroll = useRef(0);
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
    setDetailDate(null);
    onDetailChange?.(false);
    setError('');
    setMessage('');
  };
  const showDay = (date: string) => {
    reportScroll.current = window.scrollY;
    setDetailDate(date);
    onDetailChange?.(true);
    requestAnimationFrame(() => {
      detailHeading.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: 'start' });
    });
  };
  const closeDay = () => {
    setDetailDate(null);
    onDetailChange?.(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-report-date="${detailDate}"]`)?.focus({ preventScroll: true });
      window.scrollTo({ top: reportScroll.current, behavior: 'instant' });
    });
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
            disabled={demoMode || busy || saving || !report}
            title={demoMode ? '公開デモでは書き出しを利用できません' : undefined}
            onClick={() => void write()}
          >
            <Download size={16} />
            {demoMode ? 'デモでは書き出し不可' : busy ? '書き出し中…' : 'Markdownを保存'}
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
          {detailDate && (
            <section ref={detailRef} className="card report-day-detail" aria-label={`${detailDate}の学習詳細`}>
              <button onClick={closeDay}>← 週間レポートへ戻る</button>
              <h2 ref={detailHeading} tabIndex={-1}>{detailDate}</h2>
              {dailyReportDetails(state, detailDate).length ? (
                <ul>
                  {dailyReportDetails(state, detailDate).map((row) => (
                    <li key={`${row.materialId}/${row.round}`}>
                      {state.settings.materials.find((material) => material.id === row.materialId)?.name ?? row.materialId} · {row.round + 1}周目
                      {' '}予定 {row.planned}問 · 実績 {row.done === null ? '未入力' : `${row.done}問`}
                    </li>
                  ))}
                </ul>
              ) : !state.plan?.sessions.some((session) => session.date === detailDate && session.kind === 'review') && <p>この日の予定・実績はありません。</p>}
              {state.plan?.sessions.filter((session) => session.date === detailDate && session.kind === 'review').map((session) => (
                <p key={session.id}>
                  {state.settings.exams.find((exam) => exam.id === session.examId)?.name ?? '試験'} · 復習 {duration(session.end - session.start)}
                </p>
              ))}
            </section>
          )}
          <div hidden={!!detailDate}>
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
            <Warning
              id="weeklyreport-0"
              title="週間予定に最新の設定が未反映です"
              version={[state.plan?.id, state.settings]}
            >
              週間予定には、現在の設定がまだ反映されていません。
            </Warning>
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
                      <td><button data-report-date={d.date} onClick={() => showDay(d.date)}>{d.date}</button></td>
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
          </div>
        </section>
      )}
    </>
  );
}
