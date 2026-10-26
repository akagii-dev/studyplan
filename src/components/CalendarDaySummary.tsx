import type { CSSProperties } from 'react';
import { calendarDisplayQuantity } from '../domain/calendarQuantity';
import { progressView } from '../domain/progressView';
import { ProgressValue } from './ProgressValue';
import { AppState, CalendarDensity, today } from '../domain/model';
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
  density: Exclude<CalendarDensity, 'detailed'>;
  onSelect: () => void;
}) {
  const day = calendarDaySummary(state, date, filter);
  const quantities = calendarDisplayQuantity(state, date, today(), filter);
  const examIds = [
    ...new Set([...day.exams.map((e) => e.examId), ...quantities.rows.map((r) => r.examId)]),
  ];
  if (!day.classes.length && !examIds.length) return null;
  return (
    <div className="calendar-day-summary grid min-w-0 gap-[0.35rem] [&_small]:block [&_strong]:block" role="group" aria-label={`${date}の日合計`}>
      {day.classes.length > 0 && (
        <button className="calendar-busy my-1 block w-full min-w-0 whitespace-normal border-l-[3px] border-l-[var(--busy-border)] bg-[var(--busy-bg)] px-[7px] py-[5px] text-left text-[11px] text-[var(--busy-ink)] wrap-anywhere hover:enabled:border-ink hover:enabled:bg-soft [&_small]:text-[10px] [&_small]:text-[var(--busy-muted)]" onClick={onSelect}>
          <strong>授業</strong>
          <small>
            {duration(day.classMinutes)} · {day.classes.length}件
          </small>
          {density !== 'compact' && (
            <small>{day.classes.map((x) => x.name.trim() || '大学の授業').join('・')}</small>
          )}
        </button>
      )}
      {examIds.map((id) => {
        const exam = state.settings.exams.find((e) => e.id === id);
        const scheduled = day.exams.find((e) => e.examId === id);
        const quantity = calendarDisplayQuantity(state, date, today(), id);
        return (
          <button
            key={id}
            className={`calendar-event mb-1 block w-full min-w-0 whitespace-normal rounded-[2px] game:rounded-none border-0 border-l-4 px-1 text-left text-[11px] text-ink wrap-anywhere bg-[color-mix(in_srgb,var(--exam-color,var(--accent))_12%,var(--surface))] hover:enabled:bg-[color-mix(in_srgb,var(--exam-color,var(--accent))_22%,var(--surface))] [&_small]:text-[10px] [&_small]:text-muted [&_small]:wrap-anywhere ${density === 'standard' ? 'py-1.5' : 'py-[3px]'}`}
            data-exam={id}
            style={{ borderLeftColor: exam?.color, '--exam-color': exam?.color } as CSSProperties}
            onClick={onSelect}
          >
            <strong>{exam?.name ?? '試験'}</strong>
            {quantity.totals.map((total) => (
              <ProgressValue key={total.unit} value={progressView(total, date, today())}
                layout={`block overflow-hidden text-ellipsis ${density === 'standard' ? 'whitespace-normal wrap-anywhere' : 'whitespace-nowrap'}`}
                className={`[&>span]:block [&>span]:overflow-hidden [&>span]:text-ellipsis ${density === 'standard' ? '[&>span]:whitespace-normal [&>span]:wrap-anywhere' : '[&>span]:whitespace-nowrap'}`}
                strongClassName="block" />
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
