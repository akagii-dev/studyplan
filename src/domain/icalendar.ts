import { AppState, addDays, weekday } from './model';

export interface CalendarExportOptions {
  from: string;
  to: string;
  study: boolean;
  classes: boolean;
  examId: string;
}
interface ExportEvent {
  uid: string;
  date: string;
  start: number;
  end: number;
  name: string;
  description: string;
  kind: 'study' | 'class';
}
const encoder = new TextEncoder();
const escapeText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
function fold(line: string) {
  let result = '',
    length = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) {
      result += '\r\n ';
      length = 1;
    }
    result += character;
    length += bytes;
  }
  return result;
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function utc(date: Date) {
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999)
    throw new Error('書き出せない日付があります。期間を確認してください。');
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}
function timestamp(date: string, minutes: number) {
  const local = new Date(date + 'T00:00:00');
  // Use the device's zone for the specific date (including seasonal time changes).
  // 24:00 is the following midnight. Fractional minutes are represented in seconds.
  local.setHours(0, 0, Math.round(minutes * 60), 0);
  return utc(local);
}
export function calendarEvents(state: AppState, options: CalendarExportOptions): ExportEvent[] {
  if (!validDate(options.from) || !validDate(options.to) || options.from > options.to)
    throw new Error('開始日と終了日を確認してください。');
  const days = (Date.parse(options.to) - Date.parse(options.from)) / 86400000;
  if (days > 3660) throw new Error('書き出す期間は10年以内にしてください。');
  if (!options.study && !options.classes) throw new Error('書き出す予定を選んでください。');
  const events: ExportEvent[] = [];
  const append = (event: ExportEvent) => {
    if (events.length >= 50000) throw new Error('予定が多いため、書き出す期間を短くしてください。');
    events.push(event);
  };
  if (options.study) {
    for (const session of state.plan?.sessions ?? []) {
      if (
        session.date < options.from ||
        session.date > options.to ||
        (options.examId !== 'all' && session.examId !== options.examId)
      )
        continue;
      const settings = state.settings;
      const exam =
        settings.exams.find((e) => e.id === session.examId) ??
        state.plan?.settingsSnapshot?.exams.find((e) => e.id === session.examId);
      const material =
        settings.materials.find((m) => m.id === session.materialId) ??
        state.plan?.settingsSnapshot?.materials.find((m) => m.id === session.materialId);
      const subject = session.kind === 'review' ? 'まとめの復習' : material?.name || '教材';
      append({
        uid: `study-${encodeURIComponent(session.id)}@studyplan.local`,
        date: session.date,
        start: session.start,
        end: session.end,
        name: `${exam?.name || '学習'} / ${subject}${session.kind === 'study' ? `・${session.count}問` : ''}`,
        description: `${session.kind === 'study' ? `${session.round + 1}周目・予定 ${session.count}問` : '別枠の復習'}${session.fixed ? '\n固定した予定' : ''}`,
        kind: 'study',
      });
    }
  }
  if (options.classes) {
    const classes = state.settings.windows.filter((w) => w.kind === 'class');
    for (let date = options.from; date <= options.to; date = addDays(date, 1)) {
      for (const rule of classes) {
        if (date < rule.from || date > rule.to || !rule.weekdays.includes(weekday(date))) continue;
        append({
          uid: `class-${encodeURIComponent(rule.id)}-${date}@studyplan.local`,
          date,
          start: rule.start,
          end: rule.end,
          name: rule.name.trim() || '大学の授業',
          description: '大学の授業',
          kind: 'class',
        });
      }
    }
  }
  for (const event of events) {
    if (
      !validDate(event.date) ||
      !Number.isFinite(event.start) ||
      !Number.isFinite(event.end) ||
      event.start < 0 ||
      event.end > 1440 ||
      event.start >= event.end
    )
      throw new Error('時刻が不正な予定があります。設定を確認してください。');
  }
  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start - b.start ||
      a.end - b.end ||
      a.uid.localeCompare(b.uid),
  );
}
export function createCalendarFile(
  state: AppState,
  options: CalendarExportOptions,
  createdAt = new Date(),
) {
  const events = calendarEvents(state, options);
  if (!events.length) throw new Error('この期間には、選択した種類の予定がありません。');
  const stamp = utc(createdAt);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StudyPlan//Study Calendar//JA',
    'CALSCALE:GREGORIAN',
  ];
  for (const event of events) {
    const start = timestamp(event.date, event.start);
    const end = timestamp(event.date, event.end);
    if (end <= start)
      throw new Error('書き出す時刻を確認してください。終了は開始より1秒以上後にしてください。');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeText(event.name)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      `CATEGORIES:${event.kind === 'class' ? '大学の授業' : '学習'}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return {
    text: lines.map(fold).join('\r\n') + '\r\n',
    study: events.filter((e) => e.kind === 'study').length,
    classes: events.filter((e) => e.kind === 'class').length,
  };
}
