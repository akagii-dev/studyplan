import { ChevronLeft, ChevronRight } from 'lucide-react';
import { progressView } from '../domain/progressView';
import { ProgressValue } from '../components/ProgressValue';
import { calendarDisplayQuantity, materialUnit } from '../domain/calendarQuantity';
import { Props, duration } from '../components/common';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shortDate, shortDayLabel, startOfWeek, weekRangeLabel } from '../domain/calendar';
import { Session, addDays } from '../domain/model';
import { ScheduleViewSwitch } from '../components/ScheduleViewSwitch';
import { ShortfallDetails } from '../components/ShortfallDetails';
import { visibleProgressReceipts } from '../domain/progressReceiptDisplay';
import { ProgressReceiptView, receiptLabel } from '../components/ProgressReceiptView';
import { remainingWork } from '../domain/remainingWork';
import { currentPlanningStatus } from '../domain/progressAdjustment';
import { displayPlanSessions } from '../domain/planDisplay';
import { usePlanningClock } from '../hooks/usePlanningClock';
import { pastRemainingWork } from '../domain/remainingAllocation';

export interface FutureSelection { from: string; selectedOn: string }
const priorityName = (priority: number) => ['', '低い', 'ふつう', '高い'][priority] ?? String(priority);

function FutureRestart({ onRestart }: {
  onRestart: (from: string) => Promise<void>;
}) {
  const { date: reference } = usePlanningClock();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(reference);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const trigger = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => {
    if (sending) return;
    setOpen(false); setError('');
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  return <details className="future-disclosure future-restart-panel" open={open} onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && open) { event.preventDefault(); close(); }
  }}>
    <summary ref={trigger} aria-disabled={sending || undefined}
      onClick={(event) => { event.preventDefault(); if (!sending) { if (open) close(); else { setDate(reference); setOpen(true); } } }}>計画を仕切り直す</summary>
    {open && <section aria-label="計画の仕切り直し">
      <form className="future-restart" onSubmit={(event) => {
        event.preventDefault();
        if (sending) return;
        setSending(true); setError('');
        void onRestart(date).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
          .finally(() => setSending(false));
      }}>
        <p>実績・履歴と固定予定を残し、未配置も含めて組み直します。</p>
        <label htmlFor="restart-date">開始日</label>
        <input ref={input} id="restart-date" type="date" required min={reference} value={date}
          onChange={(event) => setDate(event.target.value)} />
        <div className="future-restart-controls">
          <button className="primary" type="submit" disabled={sending}>この日から案を作成</button>
          <button type="button" disabled={sending} onClick={close}>やめる</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </section>}
  </details>;
}

export function Future({
  state,
  onCalendar,
  onProposal,
  onAdjustRemaining,
  onBalanceFuture,
  onRestart,
  selection,
  initialWeek,
  onWeekChange,
  adjustmentNotice = false,
}: Props & {
  onCalendar: (date?: string, revealDay?: boolean) => void;
  onProposal: () => void;
  onAdjustRemaining?: (from: string) => Promise<boolean>;
  onBalanceFuture?: (materialIds: string[], from: string, allowReduction: boolean) => Promise<boolean>;
  onRestart?: (from: string) => Promise<void>;
  adjustmentNotice?: boolean;
  selection?: FutureSelection | null;
  initialWeek?: string;
  onWeekChange?: (date: string) => void;
}) {
  const { date: reference, minute } = usePlanningClock();
  const [localSelection, setLocalSelection] = useState<FutureSelection | null>(() => initialWeek ? { from: initialWeek, selectedOn: reference } : null);
  const chosen = selection === undefined ? localSelection : selection;
  const currentWeek = startOfWeek(reference);
  const week = startOfWeek(chosen?.selectedOn === reference ? chosen.from : reference);
  const weekEnd = addDays(week, 6);
  const [balanceMaterials, setBalanceMaterials] = useState<string[]>([]);
  const [balanceFrom, setBalanceFrom] = useState(addDays(reference, 1));
  const [balanceError, setBalanceError] = useState('');
  const [balancing, setBalancing] = useState(false);
  const balanceSending = useRef(false);
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
      timer = setTimeout(() => { if (document.activeElement === placementField.current) placementField.current?.scrollIntoView({ block: 'center' }); }, 50);
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
      <div className="future-week" role="group" aria-label="週間予定の表示範囲">
        <div className="future-week-navigation">
        <div className="future-week-range">
          <button className="navigation-arrow" aria-label="前の週" onClick={() => moveWeek(addDays(week, -7))}><ChevronLeft size={20} strokeWidth={2.5} aria-hidden="true" /></button>
          <time dateTime={week} aria-live="polite" aria-label={weekRangeLabel(week)}>
            <span className="future-week-year">{week.slice(0, 4)}</span>{' '}
            <strong>{shortDate(week)}–{week.slice(0, 4) !== weekEnd.slice(0, 4) && <><span className="future-week-year">{weekEnd.slice(0, 4)}</span>{' '}</>}{shortDate(weekEnd)}</strong>
          </time>
          <button className="navigation-arrow" aria-label="次の週" onClick={() => moveWeek(addDays(week, 7))}><ChevronRight size={20} strokeWidth={2.5} aria-hidden="true" /></button>
        </div>
        <button onClick={() => moveWeek(currentWeek)}>今日</button>
        </div>
        <ScheduleViewSwitch calendar={false} onSwitch={() => onCalendar(week, false)} />
      </div>
      {state.proposal && <button className="primary" onClick={onProposal}>計画案を確認</button>}
        {onAdjustRemaining && state.plan && !state.proposal && (past.sessions.length > 0 || placementOpen) && <section className="remaining-adjustment" aria-label="経過済みの未消化分をまとめて調整">
          {!placementOpen ? <>
            <button ref={placementTrigger} onClick={openPlacement}>未消化{past.sessions.length}件・調整する</button>
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
      <div role="status" aria-live="polite" aria-atomic="true" className="future-notice">{adjustmentNotice && !needsReview ? '未消化分を調整しました' : ''}</div>
      {needsReview && <p className="future-reconciliation" role="status">
        調整未反映・要確認。現在の計画を保持しています。{reviewReason ? ` ${reviewReason}` : ''}
      </p>}
      {past.issue && past.issue !== reviewReason && !placementOpen && <p className="error" role="alert">{past.issue}</p>}
      <ShortfallDetails state={state} />
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
                        <span className="future-quantity"><strong>
                          {session.kind === 'review' ? duration(minutes) : progressView({
                            planned: count, actual: 0, reported: false,
                            unit: quantity.rows.find(row => row.materialId === session.materialId && row.round === session.round)?.unit ??
                              materialUnit(state.settings.materials.find((material) => material.id === session.materialId)?.unit),
                          }, date, reference).text}
                        </strong>
                        {session.fixed && <span className="future-fixed">固定</span>}
                        {rowNeedsReview && <span>配置要確認</span>}
                        </span>
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
      {onBalanceFuture && state.plan && !state.proposal && <details className="future-disclosure future-balance">
        <summary>対象の未来配分を均す</summary>
      {state.settings.exams.length > 0 && <ul className="future-priorities" aria-label="試験の優先度">
        {state.settings.exams.map((exam) => <li key={exam.id}>{exam.name} · 優先度：{priorityName(exam.priority)}</li>)}
      </ul>}
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
                {material.name}{exam ? ` · ${exam.name}` : ''}
              </label>;
            })}
            <label className="field">配分を始める日<input type="date" required min={addDays(reference, 1)} value={balanceFrom} onChange={(event) => setBalanceFrom(event.target.value)} /></label>
            <p>今日の予定・実績と固定予定を残し、選んだ教材を期限まで配分し直します。</p>
            <button type="submit" className="primary" disabled={!balanceMaterials.length}>配分案を確認</button>
          </fieldset>
          {balanceError && <p className="error" role="alert">{balanceError}</p>}
        </form>
      </details>}

      {onRestart && !state.proposal && <FutureRestart onRestart={onRestart} />}

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
