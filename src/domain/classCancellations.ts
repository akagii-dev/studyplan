import { ClassCancellation, Settings, WindowRule, clock, weekday } from './model';

/** The inclusive union of cancellations only removes the named class occurrences. */
export function classIsCancelled(settings: Settings, classId: string, date: string): boolean {
  return (settings.classCancellations ?? []).some(
    (item) => item.from <= date && date <= item.to &&
      (item.classIds === undefined || item.classIds.includes(classId)),
  );
}

export function classesForDate(settings: Settings, date: string): WindowRule[] {
  return settings.windows.filter(
    (item) => item.kind === 'class' && item.from <= date && date <= item.to &&
      item.weekdays.includes(weekday(date)) && !classIsCancelled(settings, item.id, date),
  );
}

export function classCancellationErrors(settings: Settings): string[] {
  const validDate = (value: string) => {
    const date = new Date(`${value}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;
  };
  const items = settings.classCancellations ?? [];
  if (!Array.isArray(items)) return ['休講の一覧を確認してください。'];
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id) ||
      !validDate(item.from) || !validDate(item.to) || item.to < item.from ||
      (item.classIds !== undefined && (!Array.isArray(item.classIds) || !item.classIds.length ||
        item.classIds.some((id) => typeof id !== 'string' || !id.trim()) ||
        new Set(item.classIds).size !== item.classIds.length)))
      return ['休講の開始日・終了日と対象の授業を確認してください。'];
    ids.add(item.id);
  }
  return [];
}

export function classLabel(rule: WindowRule): string {
  return `${rule.name || '大学の授業'} ${rule.weekdays.map((day) => '日月火水木金土'[day]).join('・')} ${clock(rule.start)}〜${clock(rule.end)}（${rule.from}〜${rule.to}）`;
}

export function classCancellationLabel(settings: Settings, item: ClassCancellation): string {
  const dates = item.from === item.to ? item.from : `${item.from}〜${item.to}`;
  const target = item.classIds === undefined ? '全授業' : item.classIds.map((id) => {
    const rule = settings.windows.find((rule) => rule.id === id && rule.kind === 'class');
    return rule ? classLabel(rule) : '削除済みの授業';
  }).join('、');
  return `${dates} / ${target}`;
}
