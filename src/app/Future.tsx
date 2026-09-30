import { progressView } from '../domain/progressView';
import { ProgressValue } from '../components/ProgressValue';
import { calendarDisplayQuantity, materialUnit } from '../domain/calendarQuantity';
import { Props, duration } from '../components/common';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { upcomingSunday, shortDayLabel, weekRangeLabel } from '../domain/calendar';
import { Session, today, addDays, clock, type RemainingAdjustmentTarget } from '../domain/model';
import { ShortfallDetails } from '../components/ShortfallDetails';
import { progressReceipts } from '../domain/progressReceipt';
import { ProgressReceiptView, receiptLabel } from '../components/ProgressReceiptView';
import { remainingWork } from '../domain/remainingWork';
import { currentPlanningStatus } from '../domain/progressAdjustment';
import { displayPlanSessions } from '../domain/planDisplay';
import { WorkPlacements } from '../components/WorkPlacements';

export function Future({
  state,
  onCalendar,
  onProposal,
  onRestart,
  onAdjustRemaining,
  initialWeek = upcomingSunday(today()),
  onWeekChange,
}: Props & {
  onCalendar: (date?: string, revealDay?: boolean) => void;
  onProposal: () => void;
  onRestart?: (from: string) => Promise<void>;
  onAdjustRemaining?: (targets: RemainingAdjustmentTarget[], from: string) => Promise<boolean>;
  initialWeek?: string;
  onWeekChange?: (date: string) => void;
}) {
  const [week, setWeek] = useState(initialWeek);
  const reference = today();
  const [restartOpen, setRestartOpen] = useState(false);
  const [restartDate, setRestartDate] = useState(reference);
  const [restartError, setRestartError] = useState('');
  const [restarting, setRestarting] = useState(false);
  const restartTrigger = useRef<HTMLButtonElement>(null);
  const restartDateInput = useRef<HTMLInputElement>(null);
  const wasRestartOpen = useRef(false);
  useLayoutEffect(() => {
    if (restartOpen) restartDateInput.current?.focus();
    else if (wasRestartOpen.current) restartTrigger.current?.focus();
    wasRestartOpen.current = restartOpen;
  }, [restartOpen]);
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const work = useMemo(() => remainingWork(state, reference, minute), [state, reference, minute]);
  const unavailableIds = new Set(work.flatMap((row) => row.unavailable.map(({ session }) => session.id)));
  const [placementOpen, setPlacementOpen] = useState(false);
  const [placementDate, setPlacementDate] = useState(reference);
  const [placementGroup, setPlacementGroup] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [placementMessage, setPlacementMessage] = useState('');
  const [placementError, setPlacementError] = useState('');
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const placementTrigger = useRef<HTMLButtonElement>(null);
  const placementField = useRef<HTMLInputElement>(null);
  const wasPlacementOpen = useRef(false);
  useLayoutEffect(() => {
    if (placementOpen) placementField.current?.focus();
    else if (wasPlacementOpen.current) placementTrigger.current?.focus();
    wasPlacementOpen.current = placementOpen;
  }, [placementOpen]);
  const lowerDate = [reference, state.plan?.allocationStart ?? ''].sort().at(-1)!;
  const selectableWork = work.filter((row) => row.remaining > 0);
  const suggestedWork = selectableWork.find((row) => row.unavailable.length || row.unplaced) ?? selectableWork[0];
  const group = placementGroup || (suggestedWork ? `${suggestedWork.materialId}/${suggestedWork.round}` : '');
  const choices = work.flatMap((row) => [
    ...[...row.placements, ...row.unavailable.map((item) => item.session)].map((session) => ({
      id: `session:${session.id}`,
      group: `${row.materialId}/${row.round}`,
      target: { kind: 'session', sessionId: session.id } as RemainingAdjustmentTarget,
      label: `${row.name} · ${row.round + 1}周目 · ${session.date} ${clock(session.start)}〜${clock(session.end)} · この予定の残り ${session.count}${row.unit}${session.fixed ? '（固定）' : ''}`,
    })),
    ...(row.unplaced ? [{
      id: `shortfall:${row.materialId}/${row.round}`,
      group: `${row.materialId}/${row.round}`,
      target: { kind: 'shortfall', materialId: row.materialId, round: row.round } as RemainingAdjustmentTarget,
      label: `${row.name} · ${row.round + 1}周目 · 未配置 ${row.unplaced}${row.unit}`,
    }] : []),
  ]);
  async function adjustPlacement() {
    if (placingRef.current) return;
    setPlacementError('');
    setPlacementMessage('');
    const targets = choices.filter((choice) => selected.includes(choice.id)).map((choice) => choice.target);
    if (!targets.length) { setPlacementError('配置を調整する対象を選んでください。'); return; }
    placingRef.current = true;
    setPlacing(true);
    try {
      const created = await onAdjustRemaining!(targets, placementDate);
      if (created) onProposal();
      else setPlacementMessage('配置の変更はありません。現在の配置・未配置理由を確認してください。');
    } catch (error) { setPlacementError(error instanceof Error ? error.message : String(error)); }
    finally { placingRef.current = false; setPlacing(false); }
  }
  const planningStatus = currentPlanningStatus(state);
  const needsReview = !!state.plan && (planningStatus?.status === 'blocked' || work.some((row) => !row.balanced || row.needsReview));
  const reviewReason = planningStatus?.status === 'blocked' ? planningStatus.detail :
    work.flatMap((row) => [...row.reasons, ...row.unavailable.map((item) => item.reason)])[0];
  const moveWeek = (date: string) => {
    setWeek(date);
    onWeekChange?.(date);
  };
  const groups = new Map<string, Session[]>();
  for (const session of displayPlanSessions(state, reference)) {
    if (
      session.date < week ||
      session.date > addDays(week, 6) ||
      (session.kind === 'study' && session.count <= 0)
    )
      continue;
    groups.set(session.date, [...(groups.get(session.date) ?? []), session]);
  }
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(week, offset);
    if (
      date <= reference &&
      calendarDisplayQuantity(state, date, reference).rows.length &&
      !groups.has(date)
    )
      groups.set(date, []);
  }
  const shortfalls = state.plan?.shortfalls ?? [];
  const receipts = progressReceipts(state);
  return (
    <div className="future-page">
      <section className="future-restart" aria-label="計画を仕切り直す">
        {state.proposal ? (
          <button className="primary" onClick={onProposal}>計画案を確認</button>
        ) : !onRestart ? null : !restartOpen ? (
          <button ref={restartTrigger} onClick={() => { setRestartDate(reference); setRestartError(''); setRestartOpen(true); }}>
            計画を仕切り直す
          </button>
        ) : (
          <form onSubmit={(event) => {
            event.preventDefault();
            if (restarting) return;
            setRestarting(true);
            setRestartError('');
            void onRestart(restartDate).catch((error) => {
              setRestartError(error instanceof Error ? error.message : String(error));
            }).finally(() => setRestarting(false));
          }}>
            <p>実績・履歴と固定予定を残し、未配置も含めて組み直します。</p>
            <label htmlFor="restart-date">開始日</label>
            <div className="future-restart-controls">
              <input ref={restartDateInput} id="restart-date" type="date" required min={reference} value={restartDate}
                onChange={(event) => setRestartDate(event.target.value)} />
              <button className="primary" type="submit" disabled={restarting}>この日から案を作成</button>
              <button type="button" disabled={restarting} onClick={() => { setRestartOpen(false); setRestartError(''); }}>やめる</button>
            </div>
            {restartError && <p className="error" role="alert">{restartError}</p>}
          </form>
        )}
      </section>
      {onAdjustRemaining && state.plan && !state.proposal && choices.length > 0 && <section className="remaining-adjustment" aria-label="残りの配置を調整">
        {!placementOpen ? <button ref={placementTrigger} onClick={() => {
          setPlacementDate(lowerDate); setPlacementError(''); setPlacementMessage(''); setPlacementOpen(true);
        }}>残りの配置を調整</button> : <form onSubmit={(event) => { event.preventDefault(); void adjustPlacement(); }}>
          <h2>残りの配置を調整</h2>
          <p>実績はそのまま、選んだ残量の配置案を確認します。使える配置は維持します。</p>
          <label htmlFor="remaining-from">配置する開始日</label>
          <input id="remaining-from" ref={placementField} type="date" required min={lowerDate}
            value={placementDate} onChange={(event) => setPlacementDate(event.target.value)} />
          <label htmlFor="remaining-material">対象の教材・周回</label>
          <select id="remaining-material" value={group} onChange={(event) => setPlacementGroup(event.target.value)}>
            {selectableWork.map((row) => <option key={`${row.materialId}/${row.round}`} value={`${row.materialId}/${row.round}`}>
              {row.name} · {row.round + 1}周目 · 全体の残り {row.remaining}{row.unit}
            </option>)}
          </select>
          <fieldset disabled={placing}>
            <legend>調整する対象</legend>
            {choices.filter((choice) => choice.group === group).map((choice) => <label className="check" key={choice.id}>
              <input type="checkbox" checked={selected.includes(choice.id)} onChange={(event) => setSelected((current) =>
                event.target.checked ? [...current, choice.id] : current.filter((id) => id !== choice.id))} />
              {choice.label}
            </label>)}
          </fieldset>
          {selected.length > 0 && <details className="remaining-selected">
            <summary>選択中 {selected.length}件</summary>
            <ul>{choices.filter((choice) => selected.includes(choice.id)).map((choice) => <li key={choice.id}>{choice.label}</li>)}</ul>
          </details>}
          <div className="actions">
            <button type="submit" className="primary" disabled={placing}>配置案を確認</button>
            <button type="button" disabled={placing} onClick={() => setPlacementOpen(false)}>やめる</button>
          </div>
          {placementError && <p className="error" role="alert">{placementError}</p>}
          {placementMessage && <p role="status">{placementMessage}</p>}
        </form>}
      </section>}
      <button data-return-focus="future:calendar" onClick={() => onCalendar(week, false)}>
        詳細カレンダーを見る
      </button>
      {needsReview ? (
        <p className="future-reconciliation" role="status">
          調整未反映・要確認{reviewReason ? `：${reviewReason}` : ''}
        </p>
      ) : planningStatus?.status === 'applied' ? (
        <p className="future-reconciliation" role="status">未消化分を調整しました</p>
      ) : null}
      {work.length > 0 && (
        <details className="future-work">
          <summary>残量の内訳</summary>
          <ul>
            {work.map((row) => (
              <li key={`${row.materialId}/${row.round}`} className="future-work-item">
                <span>{row.name} · {row.round + 1}周目</span>
                <WorkPlacements row={row} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="future-week row" role="group" aria-label="週間予定の表示範囲">
        <button aria-label="前の週" onClick={() => moveWeek(addDays(week, -7))}>
          ‹
        </button>
        <strong aria-live="polite">
          <time dateTime={week}>{weekRangeLabel(week)}</time>
        </strong>
        <button aria-label="次の週" onClick={() => moveWeek(addDays(week, 7))}>
          ›
        </button>
      </div>
      {groups.size ? (
        [...groups]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, sessions]) => {
            const quantity = calendarDisplayQuantity(state, date, reference);
            const rows = new Map<string, { session: Session; count: number; minutes: number; needsReview: boolean }>();
            for (const session of sessions) {
              const key = JSON.stringify([
                session.kind,
                session.materialId,
                session.round,
                session.examId,
                session.fixed,
              ]);
              const existing = rows.get(key);
              rows.set(key, {
                session,
                count: (existing?.count ?? 0) + session.count,
                minutes: (existing?.minutes ?? 0) + session.end - session.start,
                needsReview: !!existing?.needsReview || unavailableIds.has(session.id),
              });
            }
            return (
              <section className="future-day" key={date}>
                <h2>
                  <button
                    className="future-day-date"
                    aria-label={`${date} ${shortDayLabel(date)}`}
                    data-return-focus={`future:${date}`}
                    onClick={() => onCalendar(date)}
                  >
                    {shortDayLabel(date)}
                  </button>
                  {date === reference && <span className="future-today">今日</span>}
                </h2>
                <ul>
                  {date <= reference && quantity.rows.map((row) => {
                      const progress = progressView(row, date, reference);
                      const matching = sessions.filter(
                        (s) =>
                          s.kind === 'study' &&
                          s.materialId === row.materialId &&
                          s.round === row.round,
                      );
                      return (
                        <li key={JSON.stringify([row.materialId, row.round, row.unit])}>
                          <span>
                            {row.name} · {row.round + 1}周目
                          </span>
                          <span className="future-quantity">
                            <ProgressValue value={progress} />
                            {matching.some((s) => unavailableIds.has(s.id)) && <span>配置要確認</span>}
                            {matching.some((s) => s.fixed) && (
                              <span className="future-fixed">
                                {matching.every((s) => s.fixed) ? '固定' : '一部固定'}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  {[...rows.values()]
                    .filter(({ session }) => date > reference || session.kind === 'review')
                    .map(({ session, count, minutes, needsReview: rowNeedsReview }) => (
                      <li
                        key={`${session.kind}/${session.materialId}/${session.round}/${session.examId}/${session.fixed}`}
                      >
                        <span>
                          {session.kind === 'review'
                            ? `${state.settings.exams.find((exam) => exam.id === session.examId)?.name ?? '試験'} · 復習`
                            : `${state.settings.materials.find((material) => material.id === session.materialId)?.name ?? session.materialId} · ${session.round + 1}周目`}
                        </span>
                        <strong>
                          {session.kind === 'review' ? duration(minutes) : progressView({
                            planned: count, actual: 0, reported: false,
                            unit: quantity.rows.find(row => row.materialId === session.materialId && row.round === session.round)?.unit ??
                              materialUnit(state.settings.materials.find((material) => material.id === session.materialId)?.unit),
                          }, date, reference).text}
                        </strong>
                        {session.fixed && <span className="future-fixed">固定</span>}
                        {rowNeedsReview && <span>配置要確認</span>}
                      </li>
                    ))}
                </ul>
              </section>
            );
          })
      ) : (
        <p>
          {shortfalls.length ? 'この週に配置済み予定はありません。' : 'この週の予定はありません。'}
        </p>
      )}
      <ShortfallDetails state={state} />
      {receipts.length > 0 && (
        <details className="plan-change-history">
          <summary>実績による予定調整の履歴</summary>
          {[...receipts].reverse().map((receipt) => (
            <details key={receipt.id}>
              <summary>
                {receipt.date} ·{' '}
                {state.settings.materials.find((material) => material.id === receipt.materialId)
                  ?.name ?? receipt.materialId}{' '}
                · {receiptLabel(receipt)}
              </summary>
              <ProgressReceiptView state={state} receipt={receipt} />
            </details>
          ))}
        </details>
      )}
    </div>
  );
}
