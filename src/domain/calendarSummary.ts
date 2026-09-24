import { AppState, reported } from './model';
import { blockingEvents, overlapsBusy } from './planAudit';
import { mergeIntervals } from './planner/intervals';
import { materialUnit } from './calendarQuantity';

/** Summarize the one approved plan; filters never generate separate plans. */
export function calendarDaySummary(state: AppState, date: string, filter = 'all') {
  const classes = blockingEvents(state.settings, date).filter((x) => x.kind === 'class');
  const sessions = (state.plan?.sessions ?? []).filter(
    (x) =>
      (x.kind === 'review' || x.count > 0) &&
      x.date === date &&
      (filter === 'all' || x.examId === filter),
  );
  const records = state.records.filter((r) => !r.cancelled && r.date === date);
  const exams = [...new Set(sessions.map((x) => x.examId))].map((examId) => {
    const exam = state.settings.exams.find((x) => x.id === examId);
    const items = sessions.filter((x) => x.examId === examId);
    const groups = [
      ...new Map(
        items
          .filter((x) => x.kind === 'study')
          .map((x) => [JSON.stringify([x.materialId, x.round]), x]),
      ).values(),
    ];
    const actuals = records.filter(
      (r) => state.settings.materials.find((m) => m.id === r.materialId)?.examId === examId,
    );
    const amounts = (list: { materialId: string; count: number }[]) => {
      const units = new Map<string, number>();
      for (const item of list) {
        const unit = materialUnit(
          state.settings.materials.find((m) => m.id === item.materialId)?.unit,
        );
        units.set(unit, (units.get(unit) ?? 0) + item.count);
      }
      return [...units].map(([unit, count]) => `${count}${unit}`).join('・');
    };
    return {
      examId,
      name: exam?.name ?? '削除済みの試験',
      color: exam?.color,
      sessions: items,
      count: items.reduce((n, x) => n + x.count, 0),
      quantityLabel: amounts(items.filter((s) => s.kind === 'study')) || '0問',
      actualLabel: amounts(actuals),
      minutes: items.reduce((n, x) => n + x.end - x.start, 0),
      reviewMinutes: items
        .filter((x) => x.kind === 'review')
        .reduce((n, x) => n + x.end - x.start, 0),
      groupCount: groups.length,
      reportedCount: groups.filter((x) => reported(state, date, x.materialId, x.round)).length,
      actualCount: actuals.reduce((n, x) => n + x.count, 0),
      hasActual: !!actuals.length,
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
