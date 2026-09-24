import { calendarQuantity } from '../domain/calendarQuantity';
import { progressView } from '../domain/progressView';
import { ProgressValue } from './ProgressValue';
import { AppState, CalendarDensity, clock, today } from '../domain/model';
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
  const quantities = calendarQuantity(state, date, today(), filter);
  const examIds = [
    ...new Set([...day.exams.map((e) => e.examId), ...quantities.rows.map((r) => r.examId)]),
  ];
  if (!day.classes.length && !examIds.length) return null;
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
      {examIds.map((id) => {
        const exam = state.settings.exams.find((e) => e.id === id);
        const scheduled = day.exams.find((e) => e.examId === id);
        const quantity = calendarQuantity(state, date, today(), id);
        return (
          <button
            key={id}
            className="calendar-event"
            data-exam={id}
            style={{ borderLeftColor: exam?.color }}
            onClick={onSelect}
          >
            <strong>{exam?.name ?? '試験'}</strong>
            {quantity.totals.map((total) => (
              <ProgressValue key={total.unit} value={progressView(total, date, today())} />
            ))}
            {scheduled?.reviewMinutes ? (
              <small>復習 {duration(scheduled.reviewMinutes)}</small>
            ) : null}
            {scheduled?.conflict && <small>授業・予定と重複</small>}
            {density !== 'compact' && (
              <small>{[...new Set(quantity.rows.map((r) => r.name))].join('・')}</small>
            )}
          </button>
        );
      })}
    </div>
  );
}
