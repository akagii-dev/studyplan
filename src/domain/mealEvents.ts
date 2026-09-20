import { commuteEvents } from './commute';
import { Settings, addDays, mealKeys, mealNames } from './model';

/** Keep travel fixed; reserve the full meal after any overlapping travel/meal. */
export function mealEvents(settings: Settings, date: string) {
  const travel = [-1, 0, 1, 2].flatMap((offset) =>
    commuteEvents(settings, addDays(date, offset)).map((e) => ({
      start: e.start + offset * 1440,
      end: e.end + offset * 1440,
    })),
  );
  const meals = [-1, 0]
    .flatMap((offset) =>
      mealKeys.flatMap((key) => {
        const meal = settings.meals?.[key];
        return meal
          ? [{ key, offset, original: meal.start + offset * 1440, duration: meal.duration }]
          : [];
      }),
    )
    .sort((a, b) => a.original - b.original);
  const reserved = [...travel];
  return meals.flatMap((meal) => {
    let start = meal.original;
    // Every jump passes the end of at least one blocking interval.
    for (;;) {
      const overlaps = reserved.filter((e) => start < e.end && e.start < start + meal.duration);
      if (!overlaps.length) break;
      start = Math.max(...overlaps.map((e) => e.end));
    }
    const end = start + meal.duration;
    reserved.push({ start, end });
    const a = Math.max(0, start),
      b = Math.min(1440, end);
    return a < b
      ? [
          {
            id: `meal-${meal.key}${meal.offset < 0 ? '-previous' : ''}`,
            name:
              mealNames[meal.key] +
              (meal.offset < 0 ? '（前日から）' : '') +
              (start !== meal.original ? '（通学・食事後へ調整）' : ''),
            kind: 'meal',
            start: a,
            end: b,
            adjusted: start !== meal.original,
          },
        ]
      : [];
  });
}
