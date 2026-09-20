import { Settings, addDays, today } from './model';

export interface StudyCoverageGap {
  examId: string;
  examName: string;
  from: string;
  to: string;
}

const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`));

export function isLongTermStudyGap(settings: Settings, gap: StudyCoverageGap, from = today()) {
  const exam = settings.exams.find((e) => e.id === gap.examId);
  if (!exam || !validDate(from) || !validDate(exam.target)) return false;
  const start = exam.start > from ? exam.start : from;
  return Date.parse(`${exam.target}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`) >= 90 * 86400000;
}

/** Check applicability periods, not selected weekdays: a weekly day off is not missing data. */
export function studyCoverageGaps(settings: Settings, from = today()): StudyCoverageGap[] {
  if (!validDate(from)) return [];
  const periods = settings.windows
    .filter((w) => w.kind === 'study' && validDate(w.from) && validDate(w.to) && w.from <= w.to)
    .sort((a, b) => a.from.localeCompare(b.from));
  return settings.exams.flatMap((exam) => {
    if (!validDate(exam.start) || !validDate(exam.target)) return [];
    // Review days also need availability. The exam day itself is not scheduled.
    const end = addDays(exam.target, -1);
    let cursor = exam.start > from ? exam.start : from;
    const gaps: StudyCoverageGap[] = [];
    const gap = (to: string) =>
      gaps.push({ examId: exam.id, examName: exam.name, from: cursor, to });
    for (const period of periods) {
      if (cursor > end || period.from > end) break;
      if (period.to < cursor) continue;
      if (period.from > cursor) gap(addDays(period.from, -1));
      cursor = addDays(period.to, 1);
    }
    if (cursor <= end) gap(end);
    return gaps;
  });
}
