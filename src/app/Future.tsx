import { useGameUi } from './uiStyle';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { progressView } from '../domain/progressView';
import { studyProgressView } from '../domain/studyProgress';
import { ProgressValue } from '../components/ProgressValue';
import { calendarDisplayQuantity, materialUnit } from '../domain/calendarQuantity';
import { Props, duration } from '../components/common';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shortDate, shortDayLabel, startOfWeek, weekRangeLabel } from '../domain/calendar';
import { Session, addDays } from '../domain/model';
import { ScheduleViewSwitch } from '../components/ScheduleViewSwitch';
import { ShortfallDetails } from '../components/ShortfallDetails';
import { remainingWork } from '../domain/remainingWork';
import { currentPlanningStatus } from '../domain/progressAdjustment';
import { displayPlanSessions } from '../domain/planDisplay';
import { usePlanningClock } from '../hooks/usePlanningClock';
import { periodButton } from '../components/ui';

export interface FutureSelection { from: string; selectedOn: string }

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
  return <details className="future-disclosure my-4 [&>summary]:min-h-11 [&>summary]:cursor-pointer [&>summary]:content-center future-restart-panel" open={open} onKeyDown={(event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && open) { event.preventDefault(); close(); }
  }}>
    <summary ref={trigger} aria-disabled={sending || undefined}
      onClick={(event) => { event.preventDefault(); if (!sending) { if (open) close(); else { setDate(reference); setOpen(true); } } }}>計画を仕切り直す</summary>
    {open && <section aria-label="計画の仕切り直し">
      <form className="future-restart grid w-[20rem] max-w-full gap-2 p-1 [&_p]:m-0 [&_p]:text-[1rem]" onSubmit={(event) => {
        event.preventDefault();
        if (sending) return;
        setSending(true); setError('');
        void onRestart(date).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
          .finally(() => setSending(false));
      }}>
        <label htmlFor="restart-date" className="font-[650]">開始日</label>
        <input ref={input} id="restart-date" className="min-h-11 appearance-none" type="date" required min={reference} value={date}
          onChange={(event) => setDate(event.target.value)} />
        <div className="future-restart-controls flex flex-wrap items-center gap-2">
          <button className="primary" type="submit" disabled={sending}>この日から案を作成</button>
          <button type="button" disabled={sending} onClick={close}>やめる</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </section>}
  </details>;
}
/** Year shown before a week date. */
const weekYear =
  'future-week-year text-[1rem] font-normal text-muted';
/** A material line with its quantity at the end. */
const quantityRow =
  'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-1.5 text-[1rem]';
/** Planned and recorded quantity of a line. */
const quantityText =
  'future-quantity flex max-w-[15rem] flex-wrap items-baseline justify-end gap-x-2.5 gap-y-1 wrap-anywhere';

export function Future({
  state,
  onCalendar,
  onProposal,
  onRestart,
  selection,
  initialWeek,
  onWeekChange,
  adjustmentNotice = false,
}: Props & {
  onCalendar: (date?: string, revealDay?: boolean) => void;
  onProposal: () => void;
  onRestart?: (from: string) => Promise<void>;
  adjustmentNotice?: boolean;
  selection?: FutureSelection | null;
  initialWeek?: string;
  onWeekChange?: (date: string) => void;
}) {
  const { date: reference, minute } = usePlanningClock();
  const game = useGameUi();
  const [localSelection, setLocalSelection] = useState<FutureSelection | null>(() => initialWeek ? { from: initialWeek, selectedOn: reference } : null);
  const chosen = selection === undefined ? localSelection : selection;
  const currentWeek = startOfWeek(reference);
  const week = startOfWeek(chosen?.selectedOn === reference ? chosen.from : reference);
  const weekEnd = addDays(week, 6);
  const work = useMemo(() => remainingWork(state, reference, minute), [state, reference, minute]);
  const unavailableIds = new Set(work.flatMap((row) => row.unavailable.filter((item) => !item.clockOnly).map(({ session }) => session.id)));
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
  // Days up to today show recorded or unreported quantities too; compute each day once.
  const quantities = new Map<string, ReturnType<typeof calendarDisplayQuantity>>();
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(week, offset);
    if (date > reference) continue;
    const quantity = calendarDisplayQuantity(state, date, reference);
    quantities.set(date, quantity);
    if (quantity.rows.length && !groups.has(date)) groups.set(date, []);
  }
  const shortfalls = state.plan?.shortfalls ?? [];
  return (
    <div className="future-page max-w-[900px] [:where(&)_button]:min-h-11 [:where(&)_button]:max-w-full [:where(&)_button]:whitespace-normal [:where(&)_button]:wrap-anywhere [:where(&)_summary]:min-h-11 [:where(&)_summary]:cursor-pointer [:where(&)_summary]:py-2 [:where(&)_form]:scroll-my-3">
      <div className="future-week mb-1 flex flex-wrap items-center gap-x-2 gap-y-1" role="group" aria-label="週間予定の表示範囲">
        <div className="future-week-navigation flex min-w-0 flex-wrap items-center gap-1">
        <div className="future-week-range flex min-w-0 items-center gap-1">
          <button className={`shrink-0 p-3 ${periodButton}`} aria-label="前の週" onClick={() => moveWeek(addDays(week, -7))}><ChevronLeft className="shrink-0" size={20} strokeWidth={2.5} aria-hidden="true" /></button>
          <time className="flex min-w-0 flex-wrap items-baseline justify-center gap-x-1.5 text-center wrap-anywhere" dateTime={week} aria-live="polite" aria-label={weekRangeLabel(week)}>
            <span className={weekYear}>{week.slice(0, 4)}</span>{' '}
            <strong className="text-[1.125rem] tabular-nums">{shortDate(week)}–{week.slice(0, 4) !== weekEnd.slice(0, 4) && <><span className={weekYear}>{weekEnd.slice(0, 4)}</span>{' '}</>}{shortDate(weekEnd)}</strong>
          </time>
          <button className={`shrink-0 p-3 ${periodButton}`} aria-label="次の週" onClick={() => moveWeek(addDays(week, 7))}><ChevronRight className="shrink-0" size={20} strokeWidth={2.5} aria-hidden="true" /></button>
        </div>
        {game
          ? <button className={`${periodButton} font-display font-black italic`} aria-label="今日" onClick={() => moveWeek(currentWeek)}><span lang="en">TODAY</span></button>
          : <button className={periodButton} onClick={() => moveWeek(currentWeek)}>今日</button>}
        </div>
        <ScheduleViewSwitch calendar={false} onSwitch={() => onCalendar(week, false)} />
      </div>
      {state.proposal && <button className="primary" onClick={onProposal}>計画案を確認</button>}
      <div role="status" aria-live="polite" aria-atomic="true" className="future-notice [&:not(:empty)]:my-2">{adjustmentNotice && !needsReview ? '未消化分を調整しました' : ''}</div>
      {needsReview && <p className="future-reconciliation my-3 border-s-[3px] border-s-warning ps-3 wrap-anywhere" role="status">
        調整未反映・要確認。現在の計画を保持しています。{reviewReason ? ` ${reviewReason}` : ''}
      </p>}
      <ShortfallDetails state={state} inWeek />
      {groups.size ? (
        [...groups]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, sessions]) => {
            const quantity = quantities.get(date) ?? calendarDisplayQuantity(state, date, reference);
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
              <section className="future-day grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-2 py-2 [.future-day+&]:border-t [.future-day+&]:border-line max-[600px]:grid-cols-[minmax(0,1fr)] max-[600px]:gap-0" key={date}>
                <h2 className="m-0 mb-1.5 flex flex-wrap content-start items-center gap-x-1.5 text-[17px] game:font-display game:text-[18px] game:font-black game:italic">
                  <time dateTime={date}>{shortDayLabel(date)}</time>
                  {date === reference && (game
                    ? <span className="future-today ms-0 -skew-x-[12deg] bg-accent px-2 text-[.8125rem] font-display font-black italic text-on-accent"><span aria-hidden="true" lang="en">TODAY</span><span className="sr-only">今日</span></span>
                    : <span className="future-today ms-0 text-[.875rem] font-medium text-accent">今日</span>)}
                </h2>
                <ul className="m-0 min-w-0 list-none p-0">
                  {date <= reference && quantity.rows.map((row) => {
                      const progress = date === reference ? studyProgressView(state, row, date, reference) : progressView(row, date, reference);
                      const matching = sessions.filter(
                        (s) =>
                          s.kind === 'study' &&
                          s.materialId === row.materialId &&
                          s.round === row.round,
                      );
                      return (
                        <li className={quantityRow} key={JSON.stringify([row.materialId, row.round, row.unit])}>
                          <span className="min-w-0 wrap-anywhere">
                            {row.name} · {row.round + 1}周目
                          </span>
                          <span className={quantityText}>
                            <ProgressValue value={progress} />
                            {matching.some((s) => unavailableIds.has(s.id)) && <span>配置要確認</span>}
                            {matching.some((s) => s.fixed) && (
                              <span className="future-fixed text-[1rem] text-muted">
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
                      <li className={quantityRow}
                        key={`${session.kind}/${session.materialId}/${session.round}/${session.examId}/${session.fixed}`}
                      >
                        <span className="min-w-0 wrap-anywhere">
                          {session.kind === 'review'
                            ? `${state.settings.exams.find((exam) => exam.id === session.examId)?.name ?? '試験'} · 復習`
                            : `${state.settings.materials.find((material) => material.id === session.materialId)?.name ?? session.materialId} · ${session.round + 1}周目`}
                        </span>
                        <span className={quantityText}><strong className="text-[1.125rem] tabular-nums game:font-display game:font-black game:italic">
                          {session.kind === 'review' ? duration(minutes) : progressView({
                            planned: count, actual: 0, reported: false,
                            unit: quantity.rows.find(row => row.materialId === session.materialId && row.round === session.round)?.unit ??
                              materialUnit(state.settings.materials.find((material) => material.id === session.materialId)?.unit),
                          }, date, reference).text}
                        </strong>
                        {session.fixed && <span className="future-fixed text-[1rem] text-muted">固定</span>}
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
      {onRestart && !state.proposal && <FutureRestart onRestart={onRestart} />}

    </div>
  );
}
