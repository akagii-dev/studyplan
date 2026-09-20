import { describe, expect, it } from 'vitest';
import { moveCalendarDate, startOfWeek } from '../src/domain/calendar';

describe('カレンダーで選択した日の移動', () => {
  it('選んだ週は月曜開始で、日曜も同じ週に含める', () => {
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21');
    expect(startOfWeek('2026-09-27')).toBe('2026-09-21');
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28');
  });
  it('週移動で曜日を維持し年をまたぐ', () => {
    expect(moveCalendarDate('2026-12-29', 'week', 1)).toBe('2027-01-05');
    expect(moveCalendarDate('2027-01-05', 'week', -1)).toBe('2026-12-29');
  });
  it('月末の日付は翌月末に収め、うるう年に対応する', () => {
    expect(moveCalendarDate('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(moveCalendarDate('2028-01-31', 'month', 1)).toBe('2028-02-29');
    expect(moveCalendarDate('2026-03-31', 'list', -1)).toBe('2026-02-28');
  });
  it('月・一覧の移動で日を維持し年をまたぐ', () => {
    expect(moveCalendarDate('2026-12-21', 'month', 1)).toBe('2027-01-21');
    expect(moveCalendarDate('2027-01-21', 'list', -1)).toBe('2026-12-21');
  });
});
