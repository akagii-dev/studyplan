import { AppState, today } from './model';
import { blockingEvents, overlapsBusy } from './planAudit';
import { mergeIntervals } from './planner/intervals';
import { calendarQuantity } from './calendarQuantity';

/** Summarize the one approved plan; filters never generate separate plans. */
export function calendarDaySummary(state: AppState, date: string, filter = 'all') {
  const classes = blockingEvents(state.settings, date).filter((x) => x.kind === 'class');
  const sessions = (state.plan?.sessions ?? []).filter(
    (x) =>
      (x.kind === 'review' || x.count > 0) &&
      x.date === date &&
      (filter === 'all' || x.examId === filter),
  );
  const exams = [...new Set(sessions.map((x) => x.examId))].map((examId) => {
    const exam = state.settings.exams.find((x) => x.id === examId);
    const items = sessions.filter((x) => x.examId === examId);
    const quantity = calendarQuantity(state, date, today(), examId);
    return {
      examId,
      name: exam?.name ?? '削除済みの試験',
      color: exam?.color,
      sessions: items,
      quantities: quantity.totals,
      minutes: items.reduce((n, x) => n + x.end - x.start, 0),
      reviewMinutes: items
        .filter((x) => x.kind === 'review')
        .reduce((n, x) => n + x.end - x.start, 0),
      conflict: items.some((x) => overlapsBusy(state.settings, x).length > 0),
    };
  });
  return {
    classes,
    classMinutes: mergeIntervals(classes.map((x) => [x.start, x.end])).reduce(
      (n, [a, b]) => n + b - a,
      0,
    ),
    exams,
  };
}
