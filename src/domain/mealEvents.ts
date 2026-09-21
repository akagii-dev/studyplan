import { Settings, mealKeys, mealNames } from './model';
/** Meals stay at their chosen time. Conflicts must be resolved by editing settings. */
export function mealEvents(settings: Settings) {
  return mealKeys.flatMap((key) => {
    const m = settings.meals?.[key];
    if (!m) return [];
    const events = [
      {
        id: 'meal-' + key,
        name: mealNames[key],
        kind: 'meal',
        start: m.start,
        end: Math.min(1440, m.start + m.duration),
      },
    ];
    if (m.start + m.duration > 1440)
      events.push({
        id: 'meal-' + key + '-previous',
        name: mealNames[key] + '（前日から）',
        kind: 'meal',
        start: 0,
        end: m.start + m.duration - 1440,
      });
    return events;
  });
}
