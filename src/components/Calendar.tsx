import { Warning } from './Warnings';
import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, LockKeyhole, Unlock, CalendarDays } from 'lucide-react';
import {
  CalendarDensity,
  CalendarView,
  Session,
  actual,
  addDays,
  clock,
  reported,
  today,
  weekday,
} from '../domain/model';
import { datesBetween, capacityForDate } from '../domain/planning';
import { weeklyCapacities } from '../domain/weeklyCapacity';
import { blockingEvents, overlapsBusy } from '../domain/planAudit';
import { moveCalendarDate, startOfWeek, shortDayLabel } from '../domain/calendar';
import { DailyTime } from './DailyTime';
import { CalendarQuantity, CalendarQuantityDetails } from './CalendarQuantity';
import { calendarQuantity, materialUnit } from '../domain/calendarQuantity';
import { CalendarDaySummary } from './CalendarDaySummary';
import { renameOutsideRange } from '../domain/dailyTimeDisplay';
import { PlanInsights } from './PlanInsights';
import { Empty, Props, duration, weekdays } from './common';
import { CalendarExport } from './CalendarExport';
import { sessionPolicy } from '../domain/sessionPolicy';
import { StudyCoverageNotice } from './SetupImpact';
import { originalSessionCount } from '../domain/progressReflection';
export function Calendar({
  state,
  update,
  onRecord,
  onReplan,
  todayOnly = false,
  initialMode = 'content',
  onModeChange,
  initialDate = today(),
  onDateChange,
  revealDay = false,
  initialView = 'month',
  onViewChange,
  initialFilter = 'all',
  onFilterChange,
}: Props & {
  onRecord: (session: Session) => void;
  onReplan: () => void;
  todayOnly?: boolean;
  initialMode?: 'content' | 'quantity';
  onModeChange?: (mode: 'content' | 'quantity') => void;
  initialDate?: string;
  onDateChange?: (date: string) => void;
  revealDay?: boolean;
  initialView?: CalendarView;
  onViewChange?: (view: CalendarView) => void;
  initialFilter?: string;
  onFilterChange?: (filter: string) => void;
}) {
  const [mode, setMode] = useState<'content' | 'quantity'>(initialMode);
  const changeMode = (value: 'content' | 'quantity') => {
    setMode(value);
    onModeChange?.(value);
  };
  const [, tick] = useState(0);
  useEffect(() => {
    if (!todayOnly) return;
    const id = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [todayOnly]);
  const [view, setView] = useState<CalendarView>(initialView);
  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);
  const density = state.calendarDensity?.[view] ?? (view === 'month' ? 'compact' : 'standard');
  const [filter, setFilter] = useState(initialFilter);
  useEffect(() => {
    onFilterChange?.(filter);
  }, [filter, onFilterChange]);
  const [selected, setSelected] = useState(initialDate);
  useEffect(() => {
    onDateChange?.(selected);
  }, [selected, onDateChange]);
  const anchor = selected;
  const monthStart = anchor.slice(0, 7) + '-01';
  const nextMonth = new Date(`${monthStart}T12:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = addDays(nextMonth.toISOString().slice(0, 10), -1);
  const weekStart = startOfWeek(selected);
  const from =
    view === 'month'
      ? addDays(monthStart, -((weekday(monthStart) + 6) % 7))
      : view === 'week'
        ? weekStart
        : monthStart;
  const to = view === 'month' ? addDays(from, 41) : view === 'week' ? addDays(from, 6) : monthEnd;
  const days = datesBetween(from, to);
  const all = (state.plan?.sessions ?? []).filter((s) => s.kind === 'review' || s.count > 0);
  const visible = all.filter((s) => filter === 'all' || s.examId === filter);
  const collisions = all.filter(
    (s) => s.date >= today() && overlapsBusy(state.settings, s).length > 0,
  );
  const jump = (direction: number) => {
    setSelected((date) => moveCalendarDate(date, view, direction));
  };
  const sessionsOn = (date: string) => visible.filter((s) => s.date === date);
  const hasQuantity = (date: string) =>
    calendarQuantity(state, date, today(), filter).rows.length > 0;
  const recordsOn = (date: string) =>
    state.records.filter(
      (r) =>
        !r.cancelled &&
        r.date === date &&
        (filter === 'all' ||
          state.settings.materials.find((m) => m.id === r.materialId)?.examId === filter),
    );
  const dayRecords = (date: string) =>
    recordsOn(date).map((r) => (
      <p className="hint" key={r.id}>
        {state.settings.materials.find((m) => m.id === r.materialId)?.name} · {r.round + 1}
        周目：＋{r.count}
        {materialUnit(state.settings.materials.find((m) => m.id === r.materialId)?.unit)}
      </p>
    ));
  const detail = (s: Session, level: CalendarDensity = 'detailed') => {
    const e = state.settings.exams.find((e) => e.id === s.examId);
    const m = state.settings.materials.find((m) => m.id === s.materialId);
    const unit = materialUnit(m?.unit);
    const count = actual(state, s.date, s.materialId, s.round);
    const original = originalSessionCount(state.plan, s);
    const planned = all
      .filter((x) => x.date === s.date && x.materialId === s.materialId && x.round === s.round)
      .reduce((n, x) => n + originalSessionCount(state.plan, x), 0);
    return (
      <div
        key={s.id}
        className={`session-detail density-${level}`}
        style={{ borderLeftColor: e?.color }}
      >
        {level !== 'compact' && (
          <div className="row">
            <span className="eyebrow">{e?.name}</span>
            {level === 'detailed' && (
              <span className="planned-time">
                学習予定 {clock(s.start)}–{clock(s.end)}
              </span>
            )}
          </div>
        )}
        <h3>{s.kind === 'review' ? 'まとめの復習' : m?.name}</h3>
        {overlapsBusy(state.settings, s).length > 0 && (
          <div className="error" role="status">
            <b>学習予定と授業・予定が重複</b>
            {overlapsBusy(state.settings, s).map((e) => (
              <p key={e.id}>
                {e.kind === 'class' ? e.name.trim() || '大学の授業' : e.name} {clock(e.start)}–
                {clock(e.end)} と重なっています。
              </p>
            ))}
            <button onClick={onReplan}>対話で見直す</button>
          </div>
        )}
        <div className="row">
          <span className="session-quantity">
            {s.kind === 'study'
              ? `${level === 'detailed' ? `${s.round + 1}周目 · ` : ''}${s.count === original ? '予定' : '前倒し反映後'} ${s.count}${unit}${s.count !== original ? `（当初 ${original}${unit}）` : ''}`
              : duration(s.end - s.start)}
          </span>
          {s.kind === 'study' && (
            <span
              className={`status ${reported(state, s.date, s.materialId, s.round) ? 'done' : ''}`}
            >
              {reported(state, s.date, s.materialId, s.round)
                ? level === 'detailed'
                  ? `当日実績 ${count}${unit} / 当日予定 ${planned}${unit}`
                  : '報告済'
                : '未報告'}
            </span>
          )}
        </div>
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
        {level === 'detailed' &&
          s.allocationReason &&
          s.end - s.start <
            sessionPolicy(state.plan?.settingsSnapshot ?? state.settings).minimum - 1e-7 && (
            <p className="hint">
              {s.allocationReason === 'final-remainder'
                ? '教材・周回を完了するため、設定した下限より短い予定です。'
                : '期限内に配置するため、設定した下限より短い予定です。'}
            </p>
          )}
        <div className="actions">
          <button
            onClick={() =>
              void update((x) => ({
                ...x,
                plan: x.plan
                  ? {
                      ...x.plan,
                      sessions: x.plan.sessions.map((y) =>
                        y.id === s.id ? { ...y, fixed: !y.fixed } : y,
                      ),
                    }
                  : null,
                proposal: null,
              }))
            }
          >
            {s.fixed ? <LockKeyhole size={14} /> : <Unlock size={14} />}{' '}
            {s.fixed ? '固定を解除' : '固定する'}
          </button>
          {s.kind === 'study' && s.date <= today() && (
            <button className="primary small" onClick={() => onRecord(s)}>
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
        <div className="busy-event" key={x.id}>
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
  const weekly = (() => {
    try {
      return datesBetween(weekStart, addDays(weekStart, 6)).map((d) =>
        capacityForDate(state.settings, d),
      );
    } catch {
      return [];
    }
  })();
  if (todayOnly) {
    const date = today();
    const study = all.filter((x) => x.date === date);
    return (
      <>
        <section className="card today-schedule" aria-label="今日の予定一覧">
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
            <p className="hint">まだ報告はありません。0問としては扱いません。</p>
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
  const selectedDayPanel = (view !== 'list' || mode === 'quantity') && (
    <aside className="card day-panel" aria-label="選択した日の学習詳細">
      <h3>
        {Number(selected.slice(5, 7))}月{Number(selected.slice(8))}日（
        {weekdays[weekday(selected)]}）
      </h3>
      {mode === 'quantity' ? (
        <CalendarQuantityDetails
          state={state}
          date={selected}
          filter={filter}
          onRecord={onRecord}
        />
      ) : timeline(selected).length ? (
        daySchedule(selected)
      ) : (
        <p className="hint">学習予定はありません。</p>
      )}
      {mode === 'content' && (
        <>
          <h4>この日の学習実績</h4>
          {dayRecords(selected)}
          {!recordsOn(selected).length && <p className="hint">まだ報告はありません。</p>}
        </>
      )}
    </aside>
  );
  return (
    <>
      <div className="segmented calendar-mode" role="group" aria-label="カレンダーの表示内容">
        <button
          aria-pressed={mode === 'content'}
          className={mode === 'content' ? 'active' : ''}
          onClick={() => changeMode('content')}
        >
          内容
        </button>
        <button
          aria-pressed={mode === 'quantity'}
          className={mode === 'quantity' ? 'active' : ''}
          onClick={() => changeMode('quantity')}
        >
          学習量
        </button>
      </div>
      <div className="calendar-toolbar">
        <div className="row">
          <button aria-label="前の期間" className="icon" onClick={() => jump(-1)}>
            <ChevronLeft size={18} />
          </button>
          <h2>
            {Number(anchor.slice(0, 4))}年 {Number(anchor.slice(5, 7))}月
          </h2>
          <button aria-label="次の期間" className="icon" onClick={() => jump(1)}>
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => {
              setSelected(today());
            }}
          >
            今日
          </button>
        </div>
        <div className="row">
          <select
            aria-label="表示する試験"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">すべての試験</option>
            {state.settings.exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <div className="segmented">
            {(['month', 'week', 'list'] as const).map((v, i) => (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {['月', '週', '一覧'][i]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {mode === 'content' && (
        <div className="calendar-density" role="group" aria-label="カレンダーの表示密度">
          <span>表示密度</span>
          <div className="segmented">
            {(['compact', 'standard', 'detailed'] as const).map((value, i) => (
              <button
                key={value}
                aria-pressed={density === value}
                className={density === value ? 'active' : ''}
                onClick={() =>
                  void update((s) => ({
                    ...s,
                    calendarDensity: { ...s.calendarDensity, [view]: value },
                  })).catch(() => {})
                }
              >
                {['コンパクト', '標準', '詳細'][i]}
              </button>
            ))}
          </div>
        </div>
      )}
      <CalendarExport
        state={state}
        from={view === 'week' ? from : monthStart}
        to={view === 'week' ? to : monthEnd}
        examId={filter}
      />
      {state.plan && (
        <StudyCoverageNotice
          settings={state.plan.settingsSnapshot ?? state.settings}
          onConfigure={onReplan}
          actionLabel="再計画で期間を見直す"
        />
      )}
      <div className="legend">
        {state.settings.exams.map((e) => (
          <span key={e.id}>
            <i style={{ background: e.color }} />
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
      <div
        className={
          view === 'month'
            ? `calendar-layout ${mode === 'quantity' ? 'quantity-layout' : ''} ${revealDay ? 'selected-date-first' : ''}`
            : ''
        }
      >
        {revealDay && selectedDayPanel}
        {view === 'list' ? (
          <div className={`card calendar-list density-${density}`}>
            {days
              .filter(
                (d) =>
                  timeline(d).length ||
                  recordsOn(d).length ||
                  (mode === 'quantity' && hasQuantity(d)),
              )
              .map((d) => (
                <section key={d}>
                  <h3>
                    <button
                      className="text-button"
                      aria-label={`${d}の時間の内訳を表示`}
                      aria-pressed={selected === d}
                      onClick={() => setSelected(d)}
                    >
                      {d}（{weekdays[weekday(d)]}）
                    </button>
                  </h3>
                  {mode === 'quantity' ? (
                    <CalendarQuantity
                      state={state}
                      date={d}
                      filter={filter}
                      onSelect={() => setSelected(d)}
                    />
                  ) : (
                    <CalendarDaySummary
                      state={state}
                      date={d}
                      filter={filter}
                      density={density}
                      onSelect={() => setSelected(d)}
                    />
                  )}
                  {mode === 'content' && (
                    <details className="calendar-individual" open={selected === d || undefined}>
                      <summary>個別の予定を確認</summary>
                      {daySchedule(d, density)}
                    </details>
                  )}
                  {mode === 'content' && recordsOn(d).length > 0 && (
                    <>
                      <h4>この日の学習実績</h4>
                      {dayRecords(d)}
                    </>
                  )}
                </section>
              ))}
            {!days.some(
              (d) =>
                timeline(d).length ||
                recordsOn(d).length ||
                (mode === 'quantity' && hasQuantity(d)),
            ) && <Empty>この期間に勉強・大学の予定と学習実績はありません。</Empty>}
          </div>
        ) : (
          <div
            className={`calendar-grid ${view} density-${density} ${mode === 'quantity' ? 'quantity-grid' : ''}`}
          >
            <div className="calendar-head">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <span key={d}>{weekdays[d]}</span>
              ))}
            </div>
            <div className="calendar-body">
              {days.map((d) => (
                <div
                  key={d}
                  className={`day ${d === today() ? 'today' : ''} ${d === selected ? 'chosen' : ''} ${view === 'month' && d.slice(0, 7) !== anchor.slice(0, 7) ? 'muted-day' : ''}`}
                  onClick={() => setSelected(d)}
                >
                  <button
                    className="date-number"
                    aria-label={
                      mode === 'quantity' ? `${d}を表示 ${shortDayLabel(d)}` : `${d}を表示`
                    }
                    aria-pressed={d === selected}
                  >
                    {mode === 'quantity' ? shortDayLabel(d) : Number(d.slice(8))}
                  </button>
                  {mode === 'quantity' ? (
                    <CalendarQuantity
                      state={state}
                      date={d}
                      filter={filter}
                      onSelect={() => setSelected(d)}
                    />
                  ) : (
                    <CalendarDaySummary
                      state={state}
                      date={d}
                      filter={filter}
                      density={density}
                      onSelect={() => setSelected(d)}
                    />
                  )}
                  {mode === 'content' &&
                    state.records.some(
                      (r) =>
                        !r.cancelled &&
                        r.date === d &&
                        (filter === 'all' ||
                          state.settings.materials.find((m) => m.id === r.materialId)?.examId ===
                            filter),
                    ) && <small className="actual-marker">● 実績あり</small>}
                </div>
              ))}
            </div>
          </div>
        )}
        {!revealDay && selectedDayPanel}
      </div>
      <DailyTime
        settings={state.settings}
        date={selected}
        outsideTime={state.outsideTime}
        outsideLabels={state.outsideLabels?.[selected]}
      />
      <section className="card capacity-panel" aria-label="選択した日の週の時間の内訳">
        <div className="row">
          <h3>選択した日の週の時間の内訳（現在の設定）</h3>
          <small>
            {weekStart}〜{addDays(weekStart, 6)} · 全試験で共有
          </small>
        </div>
        <div className="metrics compact-metrics">
          {(['free', 'focus'] as const).map((key, i) => (
            <div key={key}>
              <span>{['① 授業・予定を除いた空き枠', '② 連続学習の長さ・休憩を適用'][i]}</span>
              <strong>
                {weekly.length
                  ? duration(weekly.reduce((n, c) => n + c[key], 0))
                  : '連続時間・余裕率を確認'}
              </strong>
            </div>
          ))}
        </div>
        <details>
          <summary>日ごとの内訳を見る</summary>
          <p>
            週の割当上限：
            {weekly.length
              ? duration(weeklyCapacities(weekly, state.settings.buffer)[0].limit)
              : '設定を確認'}
            。余裕率は週全体に適用し、日ごとの予約はしません。
          </p>
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>空き枠</th>
                <th>学習可能量</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((c) => (
                <tr key={c.date}>
                  <td>{c.date}</td>
                  <td>{duration(c.free)}</td>
                  <td>{duration(c.focus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
      {state.plan && <PlanInsights state={state} plan={state.plan} />}
    </>
  );
}
