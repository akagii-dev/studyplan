import { expect, it, afterAll } from 'vitest';
import ICAL from 'ical.js';
import { initialState, AppState, WindowRule } from '../src/domain/model';
import { CalendarExportOptions, createCalendarFile } from '../src/domain/icalendar';
import { sortedClasses } from '../src/domain/timetable';

const originalTZ = process.env.TZ;
process.env.TZ = 'Asia/Tokyo';
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});
const options: CalendarExportOptions = {
  from: '2026-09-21',
  to: '2026-09-28',
  study: true,
  classes: true,
  examId: 'all',
};
function fixture(): AppState {
  const s = initialState();
  s.settings.exams = [
    {
      id: 'e',
      name: '資格試験',
      start: options.from,
      target: '2026-10-01',
      priority: 2,
      color: '#123456',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '問題集',
      total: 7,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'c',
      kind: 'class',
      name: '経済学',
      from: '2026-09-21',
      to: '2026-09-28',
      weekdays: [1],
      start: 540,
      end: 640,
    },
  ];
  s.settings.meals = { lunch: { start: 720, duration: 45 } };
  s.plan = {
    id: 'p',
    createdAt: '2026-09-20T00:00:00Z',
    from: options.from,
    capacities: [],
    shortfalls: [],
    conflicts: [],
    sessions: [
      {
        id: 's',
        examId: 'e',
        materialId: 'm',
        date: options.from,
        start: 660,
        end: 674,
        count: 7,
        round: 0,
        fixed: true,
        kind: 'study',
      },
    ],
  };
  s.proposal = {
    plan: {
      ...structuredClone(s.plan),
      sessions: [{ ...s.plan.sessions[0], id: 'unapproved', count: 3, start: 780, end: 786 }],
    },
    basedOn: 'p',
    reason: '未承認',
    unreported: [],
  };
  return s;
}
const events = (text: string) =>
  new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent').map((c) => new ICAL.Event(c));
it('授業の曜日・適用期間を守り、授業名と承認済みの学習予定を書き出す', () => {
  const state = fixture(),
    before = structuredClone(state);
  const file = createCalendarFile(state, options);
  const parsed = events(file.text);
  expect(file).toMatchObject({ study: 1, classes: 2 });
  expect(parsed.map((e) => e.summary)).toEqual(['経済学', '資格試験 / 問題集・7問', '経済学']);
  expect(parsed[0].startDate.toJSDate().toISOString()).toBe('2026-09-21T00:00:00.000Z');
  expect(parsed[0].endDate.toJSDate().toISOString()).toBe('2026-09-21T01:40:00.000Z');
  expect(parsed[1].description).toContain('1周目・予定 7問');
  expect(file.text).not.toContain('未承認');
  expect(file.text).not.toContain('VALARM');
  expect(state).toEqual(before);
});
it('授業だけ・学習だけ・試験別・計画なしでも書き出せる', () => {
  const s = fixture();
  expect(
    events(createCalendarFile(s, { ...options, study: false }).text).every(
      (e) => e.summary === '経済学',
    ),
  ).toBe(true);
  expect(events(createCalendarFile(s, { ...options, classes: false }).text)).toHaveLength(1);
  expect(events(createCalendarFile(s, { ...options, examId: 'other' }).text)).toHaveLength(2);
  s.plan = null;
  expect(events(createCalendarFile(s, options).text)).toHaveLength(2);
});
it('日本語・絵文字・改行・カンマ・区切り記号を壊さず75バイトで折り返す', () => {
  const s = fixture();
  const name = '長い授業名📘'.repeat(20) + ',演習;応用\\教室\n2階';
  s.settings.windows[0].name = name;
  const text = createCalendarFile(s, options).text;
  expect(events(text)[0].summary).toBe(name);
  expect(text.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
});
it('24:00を翌日の00:00として表し、同じ予定のUIDを保持する', () => {
  const s = fixture();
  s.plan!.sessions[0].start = 1380;
  s.plan!.sessions[0].end = 1440;
  const first = events(createCalendarFile(s, options, new Date('2026-09-20T00:00:00Z')).text);
  const second = events(createCalendarFile(s, options, new Date('2026-09-20T01:00:00Z')).text);
  const study = first.find((e) => e.summary.includes('問題集'))!;
  expect(study.endDate.toJSDate().toISOString()).toBe('2026-09-21T15:00:00.000Z');
  expect(first.map((e) => e.uid)).toEqual(second.map((e) => e.uid));
});
it('空の期間・不正日付・選択なし・空の予定・不正時刻を拒否する', () => {
  const s = fixture();
  for (const patch of [
    { from: '' },
    { from: '2026-02-30' },
    { to: '2026-09-20' },
    { to: '2040-01-01' },
    { study: false, classes: false },
    { from: '2026-10-01', to: '2026-10-02' },
  ])
    expect(() => createCalendarFile(s, { ...options, ...patch })).toThrow();
  s.plan!.sessions[0].end = s.plan!.sessions[0].start;
  expect(() => createCalendarFile(s, options)).toThrow('時刻');
  s.plan!.sessions[0].end = s.plan!.sessions[0].start + 0.00001;
  expect(() => createCalendarFile(s, options)).toThrow('1秒以上');
});
it('授業名の入力順は月曜から日曜、各日の時刻順で、元の並びを変更しない', () => {
  const base = fixture().settings.windows[0];
  const rules: WindowRule[] = [
    { ...base, id: 'friday', weekdays: [5] },
    { ...base, id: 'monday-late', start: 800 },
    { ...base, id: 'sunday', weekdays: [0] },
    { ...base, id: 'monday-early', weekdays: [3, 1], start: 500 },
  ];
  const before = structuredClone(rules);
  const sorted = sortedClasses(rules);
  expect(sorted.map((r) => r.id)).toEqual(['monday-early', 'monday-late', 'friday', 'sunday']);
  expect(sorted[0].weekdays).toEqual([1, 3]);
  expect(rules).toEqual(before);
});
