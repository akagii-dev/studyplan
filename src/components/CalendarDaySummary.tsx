import { AppState, CalendarDensity, clock } from '../domain/model';
import { calendarDaySummary } from '../domain/calendarSummary';
import { duration } from './common';

export function CalendarDaySummary({
  state,
  date,
  filter,
  density,
  onSelect,
}: {
  state: AppState;
  date: string;
  filter: string;
  density: CalendarDensity;
  onSelect: () => void;
}) {
  const day = calendarDaySummary(state, date, filter);
  if (!day.classes.length && !day.exams.length) return null;
  return (
    <div className="calendar-day-summary" role="group" aria-label={`${date}の日合計`}>
      {day.classes.length > 0 && (
        <button className="calendar-busy" onClick={onSelect}>
          <strong>授業</strong>
          <small>
            {duration(day.classMinutes)} · {day.classes.length}件
          </small>
          {density !== 'compact' && (
            <small>{day.classes.map((x) => x.name.trim() || '大学の授業').join('・')}</small>
          )}
          {density === 'detailed' && (
            <small>
              {day.classes.map((x) => `${clock(x.start)}–${clock(x.end)}`).join(' ／ ')} · 学習不可
            </small>
          )}
        </button>
      )}
      {day.exams.map((e) => (
        <button
          key={e.examId}
          className={`calendar-event ${e.conflict ? 'has-conflict' : ''}`}
          data-exam={e.examId}
          style={{ borderLeftColor: e.color, background: `${e.color ?? '#287569'}14` }}
          onClick={onSelect}
        >
          <strong className="event-exam">{e.name}</strong>
          <small>
            予定 {e.count}問 · {duration(e.minutes)}
          </small>
          {e.conflict && <small>⚠ 授業・予定と重複</small>}
          {density !== 'compact' && (
            <>
              <small>
                {[
                  ...new Set(
                    e.sessions.map((s) =>
                      s.kind === 'review'
                        ? 'まとめの復習'
                        : (state.settings.materials.find((m) => m.id === s.materialId)?.name ??
                          '教材'),
                    ),
                  ),
                ].join('・')}
              </small>
              {e.groupCount > 0 && (
                <small>
                  {e.reportedCount === 0
                    ? '未報告'
                    : e.reportedCount === e.groupCount
                      ? '報告済'
                      : '一部報告済'}
                </small>
              )}
            </>
          )}
          {density === 'detailed' && (
            <>
              <small>
                {e.sessions.length}枠{e.sessions.some((s) => s.fixed) ? ' · 固定あり' : ''}
                {e.reviewMinutes ? ` · 復習 ${duration(e.reviewMinutes)}` : ''}
              </small>
              <small>当日実績 {e.hasActual ? `${e.actualCount}問` : '未報告'}</small>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
