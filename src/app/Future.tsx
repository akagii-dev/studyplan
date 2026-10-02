import { progressView } from '../domain/progressView';
import { ProgressValue } from '../components/ProgressValue';
import { calendarDisplayQuantity, materialUnit } from '../domain/calendarQuantity';
import { Props, duration } from '../components/common';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shortDayLabel, weekRangeLabel } from '../domain/calendar';
import { Session, addDays } from '../domain/model';
import { ShortfallDetails } from '../components/ShortfallDetails';
import { visibleProgressReceipts } from '../domain/progressReceiptDisplay';
import { ProgressReceiptView, receiptLabel } from '../components/ProgressReceiptView';
import { remainingWork } from '../domain/remainingWork';
import { currentPlanningStatus } from '../domain/progressAdjustment';
import { displayPlanSessions } from '../domain/planDisplay';
import { WorkPlacements } from '../components/WorkPlacements';
import { usePlanningClock } from '../hooks/usePlanningClock';
import { pastRemainingWork } from '../domain/remainingAllocation';

export interface FutureSelection { from: string; selectedOn: string }
const priorityName = (priority: number) => ['', '低い', 'ふつう', '高い'][priority] ?? String(priority);

export function Future({
  state,
  onCalendar,
  onProposal,
  onRestart,
  onAdjustRemaining,
  onBalanceFuture,
  selection,
  initialWeek,
  onWeekChange,
}: Props & {
  onCalendar: (date?: string, revealDay?: boolean) => void;
  onProposal: () => void;
  onRestart?: (from: string) => Promise<void>;
  onAdjustRemaining?: (from: string) => Promise<boolean>;
  onBalanceFuture?: (materialIds: string[], from: string, allowReduction: boolean) => Promise<boolean>;
  selection?: FutureSelection | null;
  initialWeek?: string;
  onWeekChange?: (date: string) => void;
}) {
  const { date: reference, minute } = usePlanningClock();
  const [localSelection, setLocalSelection] = useState<FutureSelection | null>(() => initialWeek ? { from: initialWeek, selectedOn: reference } : null);
  const chosen = selection === undefined ? localSelection : selection;
  const week = chosen?.selectedOn === reference ? chosen.from : reference;
  const [balanceMaterials, setBalanceMaterials] = useState<string[]>([]);
  const [balanceFrom, setBalanceFrom] = useState(addDays(reference, 1));
  const [balanceError, setBalanceError] = useState('');
  const [balancing, setBalancing] = useState(false);
  const balanceSending = useRef(false);
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
  const work = useMemo(() => remainingWork(state, reference, minute), [state, reference, minute]);
  const unavailableIds = new Set(work.flatMap((row) => row.unavailable.filter((item) => !item.clockOnly).map(({ session }) => session.id)));
  const [placementOpen, setPlacementOpen] = useState(false);
  const [placementDate, setPlacementDate] = useState(reference);
  const [placementMessage, setPlacementMessage] = useState('');
  const [placementError, setPlacementError] = useState('');
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const placementTrigger = useRef<HTMLButtonElement>(null);
  const placementField = useRef<HTMLInputElement>(null);
  const wasPlacementOpen = useRef(false);
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (placementOpen) {
      placementField.current?.focus();
      timer = setTimeout(() => { placementField.current?.focus(); placementField.current?.scrollIntoView({ block: 'center' }); }, 50);
    }
    else if (wasPlacementOpen.current) placementTrigger.current?.focus();
    wasPlacementOpen.current = placementOpen;
    return () => clearTimeout(timer);
  }, [placementOpen]);
  const lowerDate = [reference, state.plan?.allocationStart ?? ''].sort().at(-1)!;
  const past = useMemo(() => pastRemainingWork(state, reference), [state, reference]);
  const pastGroups = state.settings.materials.flatMap((material) => material.rounds.flatMap((_, round) => {
    const count = past.sessions.filter((s) => s.materialId === material.id && s.round === round)
      .reduce((sum, session) => sum + session.count, 0);
    return count ? [{ material, round, count }] : [];
  }));
  const openPlacement = () => {
    setPlacementDate(lowerDate); setPlacementError(''); setPlacementMessage('');
    setPlacementOpen(true);
  };
  async function adjustPlacement() {
    if (placingRef.current) return;
    setPlacementError('');
    setPlacementMessage('');
    if (past.issue || !past.sessions.length) return;
    placingRef.current = true;
    setPlacing(true);
    try {
      const created = await onAdjustRemaining!(placementDate);
      if (created) onProposal();
      else setPlacementMessage('配置の変更はありません。現在の配置・未配置理由を確認してください。');
    } catch (error) { setPlacementError(error instanceof Error ? error.message : String(error)); }
    finally { placingRef.current = false; setPlacing(false); }
  }
  const planningStatus = currentPlanningStatus(state);
  const needsReview = !!state.plan && (planningStatus?.status === 'blocked' || work.some((row) => !row.balanced || row.reasons.length > 0 || row.unavailable.some((item) => !item.clockOnly)));
  const reviewReason = planningStatus?.status === 'blocked' ? planningStatus.detail :
    work.flatMap((row) => [...row.reasons, ...row.unavailable.filter((item) => !item.clockOnly).map((item) => item.reason)])[0];
  const moveWeek = (date: string) => {
    setLocalSelection({ from: date, selectedOn: reference });
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
  const receipts = visibleProgressReceipts(state);
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
      {onBalanceFuture && state.plan && !state.proposal && <details className="future-balance">
        <summary>対象の未来配分を均す</summary>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (balanceSending.current) return;
          balanceSending.current = true; setBalancing(true); setBalanceError('');
          void onBalanceFuture(balanceMaterials, balanceFrom, false).then((created) => {
            if (created) onProposal();
            else setBalanceError('変更できる未来の予定がありません。');
          }).catch((error) => setBalanceError(error instanceof Error ? error.message : String(error)))
            .finally(() => { balanceSending.current = false; setBalancing(false); });
        }}>
          <fieldset disabled={balancing}>
            <legend>配分を均す教材</legend>
            {state.settings.materials.map((material) => {
              const exam = state.settings.exams.find((item) => item.id === material.examId);
              return <label className="block" key={material.id}>
                <input type="checkbox" checked={balanceMaterials.includes(material.id)} onChange={(event) =>
                  setBalanceMaterials((current) => event.target.checked ? [...current, material.id] : current.filter((id) => id !== material.id))} />
                {material.name}{exam ? ` · ${exam.name} · 優先度：${priorityName(exam.priority)}` : ''}
              </label>;
            })}
            <label className="field">配分を始める日<input type="date" required min={addDays(reference, 1)} value={balanceFrom} onChange={(event) => setBalanceFrom(event.target.value)} /></label>
            <p>今日の予定・実績と固定予定を残し、選んだ教材を期限まで配分し直します。</p>
            <button type="submit" className="primary" disabled={!balanceMaterials.length}>配分案を確認</button>
          </fieldset>
          {balanceError && <p className="error" role="alert">{balanceError}</p>}
        </form>
      </details>}
      {onAdjustRemaining && state.plan && !state.proposal && <section className="remaining-adjustment" aria-label="経過済みの未消化分をまとめて調整">
        {!placementOpen ? <>
          <button ref={placementTrigger} disabled={!past.sessions.length && !past.issue} onClick={openPlacement}>
            経過済みの未消化分をまとめて調整
          </button>
          {!past.sessions.length && !past.issue && <p>昨日以前の未消化分は調整済み、またはありません。</p>}
        </> : <form onSubmit={(event) => { event.preventDefault(); void adjustPlacement(); }}>
          <h2>経過済みの未消化分をまとめて調整</h2>
          <p>昨日以前の未消化分が対象です。今日と未来の予定・実績は維持します。</p>
          <ul aria-label="調整する対象">{pastGroups.map(({ material, round, count }) => <li key={`${material.id}/${round}`}>
            {material.name} · {round + 1}周目 · {count}{materialUnit(material.unit)}
          </li>)}</ul>
          {past.issue && <p className="error" role="alert">{past.issue}</p>}
          <label htmlFor="remaining-from">配置する開始日</label>
          <input id="remaining-from" ref={placementField} type="date" required min={lowerDate}
            value={placementDate} onChange={(event) => setPlacementDate(event.target.value)} />
          <div className="actions">
            <button type="submit" className="primary" disabled={placing || !!past.issue || !past.sessions.length}>配置案を確認</button>
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
          調整未反映・要確認。現在の計画を保持しています。{reviewReason ? ` ${reviewReason}` : ''}
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
      {state.settings.exams.length > 0 && <ul className="future-priorities" aria-label="試験の優先度">
        {state.settings.exams.map((exam) => <li key={exam.id}>{exam.name} · 優先度：{priorityName(exam.priority)}</li>)}
      </ul>}
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
        {week !== reference && <button onClick={() => moveWeek(reference)}>今日から</button>}
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
