import { ScheduleViewSwitch } from './ScheduleViewSwitch';
import { progressView } from '../domain/progressView';
import { ProgressValue } from './ProgressValue';
import { Warning } from './Warnings';
import { useState, useEffect, useLayoutEffect, useRef, useId, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Settings } from 'lucide-react';
import {
  CalendarDensity,
  CalendarView,
  Session,
  addDays,
  clock,
  today,
  weekday,
} from '../domain/model';
import { datesBetween } from '../domain/planner/intervals';
import { blockingEvents, overlapsBusy } from '../domain/planAudit';
import { moveCalendarDate, startOfWeek, shortDayLabel } from '../domain/calendar';
import { DailyTime } from './DailyTime';
import { CalendarQuantityDetails } from './CalendarQuantity';
import { calendarDisplayQuantity, materialUnit } from '../domain/calendarQuantity';
import { CalendarDaySummary } from './CalendarDaySummary';
import { renameOutsideRange } from '../domain/dailyTimeDisplay';
import { Empty, Field, Props, duration, weekdays } from './common';
import { CalendarExport } from './CalendarExport';
import { StudyCoverageNotice } from './SetupImpact';
import { displayPlanSessions } from '../domain/planDisplay';
import { periodButton } from './ui';/** Floating panel heading with its close button at the end. */
const panelHeading =
  'day-panel-heading mb-2 flex flex-row-reverse flex-wrap items-start justify-between gap-2';
/** Close button of a floating panel. */
const panelClose =
  'day-panel-close m-0 min-h-11 max-w-full';
/** A small line of details in a session card. */
const detailRow =
  'row flex-wrap items-start gap-[5px] text-[10px]';

export function Calendar({
  state,
  update,
  onRecord,
  onReplan,
  onFuture,
  todayOnly = false,
  initialDate = today(),
  onDateChange,
  revealDay = false,
  onDetailChange,
  initialView = 'month',
  onViewChange,
  initialFilter = 'all',
  onFilterChange,
}: Props & {
  onRecord: (session: Session) => void;
  onReplan: () => void;
  onFuture?: () => void;
  todayOnly?: boolean;
  initialDate?: string;
  onDateChange?: (date: string) => void;
  revealDay?: boolean;
  onDetailChange?: (open: boolean) => void;
  initialView?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
  initialFilter?: string;
  onFilterChange?: (filter: string) => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!todayOnly) return;
    const id = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [todayOnly]);
  const [view, setView] = useState<'month' | 'week'>(initialView === 'week' ? 'week' : 'month');
  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);
  const savedDensity = state.calendarDensity?.[view];
  const density = savedDensity === 'detailed' ? 'standard' : savedDensity ?? (view === 'month' ? 'compact' : 'standard');
  const [filter, setFilter] = useState(initialFilter);
  useEffect(() => {
    onFilterChange?.(filter);
  }, [filter, onFilterChange]);
  const [selected, setSelected] = useState(initialDate);
  const [showDay, setShowDay] = useState(revealDay);
  useEffect(() => {
    onDetailChange?.(showDay);
  }, [showDay, onDetailChange]);
  const calendarRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailMounted = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPosition, setSettingsPosition] = useState({ top: 0, left: 0 });
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsId = useId();
  const closeSettings = (restoreFocus = false) => {
    setSettingsOpen(false);
    if (restoreFocus) settingsButtonRef.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!settingsOpen) return;
    const place = () => {
      const button = settingsButtonRef.current?.getBoundingClientRect();
      const panel = settingsPanelRef.current?.getBoundingClientRect();
      if (!button || !panel) return;
      const below = button.bottom + 8;
      setSettingsPosition({
        top: Math.max(12, below + panel.height <= innerHeight - 12 ? below : button.top - panel.height - 8),
        left: Math.max(12, Math.min(button.right - panel.width, innerWidth - panel.width - 12)),
      });
    };
    place();
    const outside = (event: MouseEvent) => {
      if (!settingsPanelRef.current?.contains(event.target as Node) &&
          !settingsButtonRef.current?.contains(event.target as Node)) closeSettings();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); closeSettings(true);
      }
    };
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('click', outside);
    return () => {
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('click', outside);
    };
  }, [settingsOpen]);
  const selectDay = (date: string) => {
    setSelected(date);
    setShowDay(true);
  };
  useEffect(() => {
    if (showDay) {
      if (detailMounted.current)
        detailRef.current?.querySelector<HTMLHeadingElement>('h3')?.focus({ preventScroll: true });
    }
    detailMounted.current = true;
  }, [selected, showDay]);
  useEffect(() => {
    onDateChange?.(selected);
  }, [selected, onDateChange]);
  const monthStart = selected.slice(0, 7) + '-01';
  const nextMonth = new Date(`${monthStart}T12:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = addDays(nextMonth.toISOString().slice(0, 10), -1);
  const weekStart = startOfWeek(selected);
  const from =
    view === 'month'
      ? startOfWeek(monthStart)
      : weekStart;
  const to = view === 'month' ? addDays(from, 41) : addDays(from, 6);
  const days = datesBetween(from, to);
  const all = displayPlanSessions(state).filter((s) => s.kind === 'review' || s.count > 0);
  const visible = all.filter((s) => filter === 'all' || s.examId === filter);
  const collisions = all.filter(
    (s) => s.date >= today() && overlapsBusy(state.settings, s).length > 0,
  );
  const jump = (direction: number) => {
    setShowDay(false);
    setSelected((date) => moveCalendarDate(date, view, direction));
  };
  const sessionsOn = (date: string) => visible.filter((s) => s.date === date);
  const hasQuantity = (date: string) =>
    calendarDisplayQuantity(state, date, today(), filter).rows.length > 0;
  const recordsOn = (date: string) =>
    state.records.filter(
      (r) =>
        !r.cancelled &&
        r.date === date &&
        (filter === 'all' ||
          state.settings.materials.find((m) => m.id === r.materialId)?.examId === filter),
    );
  const dayRecords = (date: string) =>
    recordsOn(date).map((r) => {
      const material = state.settings.materials.find((m) => m.id === r.materialId);
      return (
        <p className="hint" key={r.id}>
          {material?.name} · {r.round + 1}
          周目：＋{r.count}
          {materialUnit(material?.unit)}
        </p>
      );
    });
  const detail = (s: Session, level: CalendarDensity = 'detailed') => {
    const e = state.settings.exams.find((e) => e.id === s.examId);
    const m = state.settings.materials.find((m) => m.id === s.materialId);
    const progress = calendarDisplayQuantity(state, s.date).rows.find(r => r.materialId === s.materialId && r.round === s.round);
    const overlaps = overlapsBusy(state.settings, s);
    // With the planned time shown, the quantity ("未報告 · 6問" etc.) sits right under it.
    const quantityUnderTime = level === 'detailed' && s.kind === 'study' && !!progress;
    return (
      <div
        key={s.id}
        className={`session-detail density-${level} ${todayOnly ? 'my-[18px]' : 'my-[15px]'} border-2 border-ink border-l-8 border-l-accent bg-surface px-[11px] py-2.5 shadow-[4px_4px_0_var(--ink)]`}
        style={{ borderLeftColor: e?.color, '--exam-color': e?.color } as CSSProperties}
      >
        {level !== 'compact' && (
          <div className={detailRow}>
            <span className="eyebrow text-[11px] tracking-[.6px]">{e?.name}</span>
            {level === 'detailed' && (
              <div className="grid justify-items-end gap-0.5 text-right">
                <span className="planned-time block text-[12px] tabular-nums">
                  学習予定 {clock(s.start)}–{clock(s.end)}
                </span>
                {quantityUnderTime && <ProgressValue value={progressView(progress, s.date, today())} />}
              </div>
            )}
          </div>
        )}
        <h3 className="mx-0 my-[5px] text-[14px]">{s.kind === 'review' ? 'まとめの復習' : m?.name}</h3>
        {overlaps.length > 0 && (
          <div className="error mt-3 text-[12px] [&_p]:mb-1.5 [&_p]:[color:inherit]" role="status">
            <b>学習予定と授業・予定が重複</b>
            {overlaps.map((e) => (
              <p key={e.id}>
                {e.kind === 'class' ? e.name.trim() || '大学の授業' : e.name} {clock(e.start)}–
                {clock(e.end)} と重なっています。
              </p>
            ))}
            <button onClick={onReplan}>対話で見直す</button>
          </div>
        )}
        {!quantityUnderTime && (
          <div className={detailRow}>
            {s.kind === 'study' && progress ? <ProgressValue value={progressView(progress, s.date, today())} /> : <span>{duration(s.end - s.start)}</span>}
          </div>
        )}
        {level === 'detailed' &&
          s.kind === 'study' &&
          m &&
          m.rounds[s.round] &&
          s.end - s.start > s.count * m.rounds[s.round].minutes + 0.01 && (
            <p className="hint">
              問題の推定 {duration(s.count * m.rounds[s.round].minutes)} ＋ 見直し{' '}
              {duration(s.end - s.start - s.count * m.rounds[s.round].minutes)}
            </p>
          )}
        <div className="actions mt-2.5">
          {s.kind === 'study' && s.date <= today() && (
            <button className="primary small px-[7px] py-[5px] text-[9px]" onClick={() => onRecord(s)}>
              進捗を記録
            </button>
          )}
        </div>
      </div>
    );
  };
  const timeline = (date: string) =>
    [
      ...sessionsOn(date).map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        session: s,
        busy: null,
      })),
      ...blockingEvents(state.settings, date)
        .filter((b) => b.kind === 'class')
        .map((b) => ({
          id: b.id,
          start: b.start,
          end: b.end,
          session: null,
          busy: b,
        })),
    ].sort((a, b) => a.start - b.start || a.end - b.end);
  const daySchedule = (date: string, level: CalendarDensity = 'detailed') =>
    timeline(date).map((x) =>
      x.session ? (
        detail(x.session, level)
      ) : (
        <div className={`busy-event bg-[var(--busy-bg)] text-[11px] text-[var(--busy-ink)] ${todayOnly ? 'my-[18px] p-2' : 'mb-4 p-3'}`} key={x.id}>
          <b>
            {x.busy!.kind === 'class'
              ? '授業：' + (x.busy!.name.trim() || '大学の授業')
              : x.busy!.name}{' '}
            · 学習不可
          </b>
          {level === 'detailed' && (
            <div>
              開始 {clock(x.start)} ／ 終了 {clock(x.end)}
            </div>
          )}
        </div>
      ),
    );
  if (todayOnly) {
    const date = today();
    const study = all.filter((x) => x.date === date);
    return (
      <>
        <section className="card today-schedule max-w-[900px] [&+.daily-time]:mt-6" aria-label="今日の予定一覧">
          <h2>
            {date}（{weekdays[weekday(date)]}）
          </h2>
          <p>
            勉強 {study.reduce((n, x) => n + x.count, 0)}問 ·{' '}
            {duration(study.reduce((n, x) => n + x.end - x.start, 0))} ／ 大学の授業{' '}
            {blockingEvents(state.settings, date).filter((x) => x.kind === 'class').length}件
          </p>
          {timeline(date).length ? (
            daySchedule(date)
          ) : (
            <Empty>今日の勉強・大学の予定はありません。</Empty>
          )}
          <h3>今日の学習実績</h3>
          {state.records
            .filter((r) => !r.cancelled && r.date === date)
            .map((r) => (
              <p key={r.id}>
                {state.settings.materials.find((m) => m.id === r.materialId)?.name} · {r.round + 1}
                周目：＋{r.count}問
              </p>
            ))}
          {!state.records.some((r) => !r.cancelled && r.date === date) && (
            <p className="hint">まだ報告はありません。</p>
          )}
        </section>
        <DailyTime
          settings={state.settings}
          date={date}
          outsideTime={state.outsideTime}
          outsideLabels={state.outsideLabels?.[date]}
          onRenameOutside={(start, end, title) =>
            update((s) => renameOutsideRange(s, date, start, end, title))
          }
        />
      </>
    );
  }
  const closeDay = () => {
    setShowDay(false);
    calendarRef.current?.querySelector<HTMLButtonElement>('.date-number[aria-pressed="true"]')?.focus({ preventScroll: true });
  };
  const selectedDayPanel = showDay && (
    <aside className="card day-panel fixed m-0 overflow-auto rounded-card border border-line bg-surface p-4 shadow-[0_6px_24px_#0003] bottom-20 right-4 z-12 h-max max-h-[min(45dvh,calc(100dvh-160px))] w-[min(26rem,calc(100vw-32px))]" aria-label="選択した日の学習詳細" ref={detailRef} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeDay(); } }}>
      <div className={panelHeading}>
      <button
        className={panelClose}
        onClick={closeDay}
      >
        詳細を閉じる
      </button>
      <h3 className="m-0 min-w-0 text-[1.125rem]" tabIndex={-1}>
        {Number(selected.slice(5, 7))}月{Number(selected.slice(8))}日（
        {weekdays[weekday(selected)]}）
      </h3>
      </div>
      {timeline(selected).length ? (
        daySchedule(selected)
      ) : (
        <p className="hint">学習予定はありません。</p>
      )}
      {!sessionsOn(selected).some(s => s.kind === 'study') && hasQuantity(selected) && (
        <CalendarQuantityDetails state={state} date={selected} filter={filter} onRecord={onRecord} />
      )}
        <>
          <h4>この日の学習実績</h4>
          {dayRecords(selected)}
          {!recordsOn(selected).length && <p className="hint">まだ報告はありません。</p>}
        </>
    </aside>
  );
  return (
    <>
      <div className="calendar-toolbar schedule-toolbar m-0 mb-1 flex max-w-[900px] flex-wrap items-center justify-between gap-x-2 gap-y-1 [&>*]:min-w-0">
        <div className="calendar-period flex flex-wrap items-center gap-1">
          <button aria-label="前の期間" className={`${periodButton} px-2.5 py-[7px] text-[11px]`} onClick={() => jump(-1)}>
            <ChevronLeft size={20} aria-hidden />
          </button>
          <h2 className="m-0 whitespace-nowrap text-[1.125rem]">
            {Number(selected.slice(0, 4))}年 {Number(selected.slice(5, 7))}月
          </h2>
          <button aria-label="次の期間" className={`${periodButton} px-2.5 py-[7px] text-[11px]`} onClick={() => jump(1)}>
            <ChevronRight size={20} aria-hidden />
          </button>
          <div className="calendar-today-actions flex items-center gap-1">
            <button className={`future-today ${periodButton} px-3.5 py-2.5 font-display text-[.875rem] font-black italic`} aria-label="今日"
              onClick={() => { setShowDay(false); setSelected(today()); }}>
              <span lang="en">TODAY</span>
            </button>
            <button ref={settingsButtonRef} className={`calendar-settings-toggle ${periodButton} px-2.5 py-[7px] text-[11px]`}
              aria-label="カレンダーの表示設定" aria-haspopup="dialog"
              aria-expanded={settingsOpen} aria-controls={settingsId}
              onClick={() => setSettingsOpen(open => !open)}
              onKeyDown={event => {
                if (settingsOpen && event.key === 'Tab' && !event.shiftKey) {
                  event.preventDefault();
                  settingsPanelRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
                }
              }}>
              <Settings size={20} aria-hidden />
            </button>
          </div>
        </div>
        {onFuture && <ScheduleViewSwitch calendar onSwitch={onFuture} />}
      </div>
      {settingsOpen && (
        <div ref={settingsPanelRef} id={settingsId} role="dialog" aria-labelledby={settingsId + '-title'}
          className="card compact calendar-display-settings fixed m-0 overflow-auto rounded-card border border-line bg-surface p-4 shadow-[0_6px_24px_#0003] z-13 max-h-[calc(100dvh-24px)] w-[min(322px,calc(100vw-24px))]" style={settingsPosition}
          onKeyDown={event => {
            if (event.key === 'Tab') {
              const controls = settingsPanelRef.current?.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select');
              if (!controls?.length) return;
              const first = controls[0], last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last.focus({ preventScroll: true });
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first.focus({ preventScroll: true });
              }
            }
          }}>
          <div className={panelHeading}>
            <button className={panelClose} aria-label="表示設定を閉じる" onClick={event => closeSettings(event.detail === 0)}>閉じる</button>
            <h3 className="m-0 min-w-0 text-[1.125rem]" id={settingsId + '-title'}>表示設定</h3>
          </div>
          <div className="calendar-settings-fields grid gap-2 [&_.field]:m-0 [&_.field]:flex-row [&_.field]:flex-wrap [&_.field]:items-center [&_.field]:gap-2 [&_.field]:text-[1rem] [&_.field>label]:flex-[0_1_5.5em] [&_select]:min-h-11 [&_select]:flex-[1_1_9em] [&_select]:px-2.5 [&_select]:py-2 [&_select]:text-[max(1rem,16px)]">
            <Field label="対象の試験">
              <select value={filter} onChange={event => setFilter(event.target.value)}>
                <option value="all">すべての試験</option>
                {state.settings.exams.map(exam => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
              </select>
            </Field>
            <Field label="表示期間">
              <select value={view} onChange={event => setView(event.target.value as 'month' | 'week')}>
                <option value="month">月</option><option value="week">週</option>
              </select>
            </Field>
            <Field label="表示密度">
              <select value={density} onChange={event => {
                const value = event.target.value as Exclude<CalendarDensity, 'detailed'>;
                void update(s => ({ ...s, calendarDensity: { ...s.calendarDensity, [view]: value } })).catch(() => {});
              }}>
                <option value="compact">コンパクト</option><option value="standard">標準</option>
              </select>
            </Field>
          </div>
        </div>
      )}
      {state.plan && (
        <StudyCoverageNotice
          settings={state.plan.settingsSnapshot ?? state.settings}
          onConfigure={onReplan}
          actionLabel="再計画で期間を見直す"
        />
      )}
      <div className="legend mb-[17px] flex flex-wrap items-center gap-[18px]">
        {state.settings.exams.map((e) => (
          <span key={e.id} className="flex items-center gap-1.5 text-[10px] text-muted">
            <i className="block size-[7px] rounded-full" style={{ background: e.color }} />
            {e.name}
          </span>
        ))}
      </div>
      {!!collisions.length && (
        <Warning
          id="calendar-0"
          title="授業・予定・通学と重なる学習予定があります"
          version={[state.plan?.id, state.settings]}
        >
          <b>授業・予定と重なる学習予定が{collisions.length}件あります</b>
          <p>
            保存済みの予定を現在の授業・予定と照合しました。重なった予定はそのまま実行せず、変更案を確認してください。
          </p>
          <button onClick={onReplan}>重なりを対話で見直す</button>
        </Warning>
      )}
      {!state.plan && (
        <Empty>
          <CalendarDays />
          <p>初期設定を終えたら、最初の計画を作成しましょう。</p>
        </Empty>
      )}
      <div className="calendar-only-layout grid min-w-0 gap-5" ref={calendarRef} onFocusCapture={(event) => { if (showDay && !detailRef.current?.contains(event.target)) setShowDay(false); }}>
        {selectedDayPanel}
        <div
          className={`calendar-grid ${view} density-${density} mb-[23px] overflow-hidden border-2 border-ink bg-surface shadow-[8px_8px_0_var(--ink)]`}
        >
          <div className="calendar-head grid grid-cols-[repeat(7,minmax(0,1fr))] bg-band text-on-band @max-[680px]:hidden">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <span key={d} className="py-2.5 text-center font-display text-[13px] font-black italic text-on-band @max-[430px]:py-2">{weekdays[d]}</span>
            ))}
          </div>
          <div className="calendar-body grid gap-px @max-[680px]:gap-3">
            {days.filter((_, index) => index % 7 === 0).map((week) => (
              <section className="calendar-week min-w-0" key={week} aria-label={`${shortDayLabel(week)}からの週`}>
                <h3 className="calendar-week-title hidden @max-[680px]:m-0 @max-[680px]:block @max-[680px]:bg-soft @max-[680px]:p-2 @max-[680px]:text-[.875rem] @max-[680px]:text-muted">{shortDayLabel(week)}–{shortDayLabel(addDays(week, 6))}</h3>
                <div className="calendar-week-days grid grid-cols-[repeat(7,minmax(0,1fr))] gap-px @max-[680px]:grid-cols-[repeat(2,minmax(0,1fr))]">
                  {days.filter(d => d >= week && d <= addDays(week, 6)).map((d) => (
                    <div
                      key={d}
                      className={`day ${d === today() ? 'today' : ''} ${d === selected ? 'chosen shadow-[inset_0_0_0_2px_var(--accent)]' : ''} ${view === 'month' && d.slice(0, 7) !== selected.slice(0, 7) ? 'muted-day' : ''} min-w-0 cursor-pointer bg-surface px-[5px] py-[7px] outline-1 outline-line @max-[680px]:px-2 @max-[680px]:py-1.5`}
                      onClick={() => selectDay(d)}
                    >
                      <button
                        className={`date-number mb-0.5 min-h-11 min-w-11 max-w-full border-0 bg-transparent p-1 text-[.875rem] ${d === today() ? 'hover:enabled:bg-transparent' : 'hover:enabled:bg-soft'} ${view === 'month' && d.slice(0, 7) !== selected.slice(0, 7) ? 'font-medium text-muted' : 'font-[650] text-ink'}`}
                        aria-label={`${d}を表示`}
                        aria-pressed={d === selected}
                      >
                        {d === today() ? <span className="today-date-badge mx-auto grid h-[2rem] min-w-[2.5rem] -skew-x-[12deg] place-items-center bg-accent px-1.5 font-display font-black italic text-on-accent shadow-[2px_2px_0_var(--ink)]">{Number(d.slice(8))}</span> : shortDayLabel(d)}
                      </button>
                        <CalendarDaySummary
                          state={state}
                          date={d}
                          filter={filter}
                          density={density}
                          onSelect={() => selectDay(d)}
                        />

                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
      <CalendarExport
        state={state}
        from={view === 'week' ? from : monthStart}
        to={view === 'week' ? to : monthEnd}
        examId={filter}
      />
    </>
  );
}
