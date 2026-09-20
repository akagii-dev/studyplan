import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, LockKeyhole, Unlock, CalendarDays } from 'lucide-react';
import {
  AppState,
  Session,
  actual,
  addDays,
  clock,
  reported,
  today,
  weekday,
} from '../domain/model';
import { datesBetween, capacityForDate } from '../domain/planner';
import { blockingEvents, overlapsBusy } from '../domain/planAudit';
import { moveCalendarDate, startOfWeek } from '../domain/calendar';
import { DailyTime } from './DailyTime';
import { PlanInsights } from './PlanInsights';
import { Empty, Props, duration, weekdays } from './common';
import { CalendarExport } from './CalendarExport';
import { sessionPolicy } from '../domain/sessionPolicy';
export function Calendar({
  state,
  update,
  onRecord,
  onReplan,
  todayOnly = false,
}: Props & { onRecord: (session: Session) => void; onReplan: () => void; todayOnly?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!todayOnly) return;
    const id = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [todayOnly]);
  const [view, setView] = useState<'month' | 'week' | 'list'>('month');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(today());
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
  const all = state.plan?.sessions ?? [];
  const visible = all.filter((s) => filter === 'all' || s.examId === filter);
  const collisions = all.filter(
    (s) => s.date >= today() && overlapsBusy(state.settings, s).length > 0,
  );
  const jump = (direction: number) => {
    setSelected((date) => moveCalendarDate(date, view, direction));
  };
  const sessionsOn = (date: string) => visible.filter((s) => s.date === date);
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
        周目：＋{r.count}問
      </p>
    ));
  const detail = (s: Session) => {
    const e = state.settings.exams.find((e) => e.id === s.examId);
    const m = state.settings.materials.find((m) => m.id === s.materialId);
    const count = actual(state, s.date, s.materialId, s.round);
    const planned = all
      .filter((x) => x.date === s.date && x.materialId === s.materialId && x.round === s.round)
      .reduce((n, x) => n + x.count, 0);
    return (
      <div key={s.id} className="session-detail" style={{ borderLeftColor: e?.color }}>
        <div className="row">
          <span className="eyebrow">{e?.name}</span>
          <span className="planned-time">
            学習予定 {clock(s.start)}–{clock(s.end)}
          </span>
        </div>
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
          <span>
            {s.kind === 'study'
              ? `${s.round + 1}周目 · 予定 ${s.count}問`
              : duration(s.end - s.start)}
          </span>
          {s.kind === 'study' && (
            <span
              className={`status ${reported(state, s.date, s.materialId, s.round) ? 'done' : ''}`}
            >
              {reported(state, s.date, s.materialId, s.round)
                ? `当日実績 ${count}問 / 当日予定 ${planned}問`
                : '未報告'}
            </span>
          )}
        </div>
        {s.kind === 'study' &&
          m &&
          m.rounds[s.round] &&
          s.end - s.start > s.count * m.rounds[s.round].minutes + 0.01 && (
            <p className="hint">
              問題の推定 {duration(s.count * m.rounds[s.round].minutes)} ＋ 見直し{' '}
              {duration(s.end - s.start - s.count * m.rounds[s.round].minutes)}
            </p>
          )}
        {s.allocationReason &&
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
            {s.fixed ? '固定を解除' : '予定を固定'}
          </button>
          {s.kind === 'study' && (
            <button
              className="primary small"
              disabled={s.date > today()}
              onClick={() => onRecord(s)}
            >
              {s.date > today() ? '記録は当日から' : '進捗を記録'}
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
  const daySchedule = (date: string) =>
    timeline(date).map((x) =>
      x.session ? (
        detail(x.session)
      ) : (
        <div className="busy-event" key={x.id}>
          <b>
            {x.busy!.kind === 'class'
              ? '授業：' + (x.busy!.name.trim() || '大学の授業')
              : x.busy!.name}{' '}
            · 学習不可
          </b>
          <div>
            開始 {clock(x.start)} ／ 終了 {clock(x.end)}
          </div>
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
        <DailyTime settings={state.settings} date={date} />
      </>
    );
  }
  return (
    <>
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
      <CalendarExport
        state={state}
        from={view === 'week' ? from : monthStart}
        to={view === 'week' ? to : monthEnd}
        examId={filter}
      />
      <div className="legend">
        {state.settings.exams.map((e) => (
          <span key={e.id}>
            <i style={{ background: e.color }} />
            {e.name}
          </span>
        ))}
      </div>
      {!!collisions.length && (
        <div className="warning" role="alert">
          <b>授業・予定と重なる学習予定が{collisions.length}件あります</b>
          <p>
            保存済みの予定を現在の授業・予定と照合しました。重なった予定はそのまま実行せず、変更案を確認してください。
          </p>
          <button onClick={onReplan}>重なりを対話で見直す</button>
        </div>
      )}
      {!state.plan && (
        <Empty>
          <CalendarDays />
          <p>初期設定を終えたら、最初の計画を作成しましょう。</p>
        </Empty>
      )}
      <div className={view === 'month' ? 'calendar-layout' : ''}>
        {view === 'list' ? (
          <div className="card">
            {days
              .filter((d) => timeline(d).length || recordsOn(d).length)
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
                  {daySchedule(d)}
                  {recordsOn(d).length > 0 && (
                    <>
                      <h4>この日の学習実績</h4>
                      {dayRecords(d)}
                    </>
                  )}
                </section>
              ))}
            {!days.some((d) => timeline(d).length || recordsOn(d).length) && (
              <Empty>この期間に勉強・大学の予定と学習実績はありません。</Empty>
            )}
          </div>
        ) : (
          <div className={`calendar-grid ${view}`}>
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
                    aria-label={`${d}を表示`}
                    aria-pressed={d === selected}
                  >
                    {Number(d.slice(8))}
                  </button>
                  {timeline(d)
                    .slice(0, view === 'month' ? 4 : 100)
                    .map((entry) => {
                      if (entry.busy)
                        return (
                          <button
                            className="calendar-busy"
                            key={entry.id}
                            onClick={() => setSelected(d)}
                          >
                            {entry.busy.kind === 'class'
                              ? '授業：' + (entry.busy.name.trim() || '大学の授業')
                              : entry.busy.name}
                            <small>
                              {clock(entry.start)}–{clock(entry.end)} · 学習不可
                            </small>
                          </button>
                        );
                      const s = entry.session!;
                      const e = state.settings.exams.find((e) => e.id === s.examId);
                      return (
                        <button
                          key={s.id}
                          className={`calendar-event ${overlapsBusy(state.settings, s).length ? 'has-conflict' : ''}`}
                          style={{
                            borderLeftColor: e?.color,
                            background: `${e?.color ?? '#287569'}14`,
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(d);
                          }}
                        >
                          <span>
                            {s.fixed ? '🔒 ' : ''}
                            {s.kind === 'review'
                              ? '復習'
                              : state.settings.materials.find((m) => m.id === s.materialId)?.name}
                          </span>
                          <small>
                            {overlapsBusy(state.settings, s).length > 0
                              ? '⚠ 授業・予定と重複 · '
                              : ''}
                            {s.kind === 'study'
                              ? `${s.count}問 · ${reported(state, d, s.materialId, s.round) ? '報告済' : '未報告'}`
                              : clock(s.start)}
                          </small>
                        </button>
                      );
                    })}
                  {view === 'month' && timeline(d).length > 4 && (
                    <small>ほか {timeline(d).length - 4}件 · 日付を押して確認</small>
                  )}
                  {state.records.some(
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
        {view !== 'list' && (
          <aside className="card day-panel">
            <div className="eyebrow">DAY DETAILS</div>
            <h3>
              {Number(selected.slice(5, 7))}月{Number(selected.slice(8))}日（
              {weekdays[weekday(selected)]}）
            </h3>
            {timeline(selected).length ? (
              daySchedule(selected)
            ) : (
              <p className="hint">学習予定はありません。</p>
            )}
            <h4>この日の学習実績</h4>
            {dayRecords(selected)}
            {!recordsOn(selected).length && <p className="hint">まだ報告はありません。</p>}
          </aside>
        )}
      </div>
      <DailyTime settings={state.settings} date={selected} />
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
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>空き枠</th>
                <th>学習可能量</th>
                <th>割当可能量</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((c) => (
                <tr key={c.date}>
                  <td>{c.date}</td>
                  <td>{duration(c.free)}</td>
                  <td>{duration(c.focus)}</td>
                  <td>{duration(c.allocatable)}</td>
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
