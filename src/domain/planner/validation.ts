import { commuteErrors, commuteScheduleErrors } from '../commute';
import { addDays, Settings } from '../model';
import { sessionPolicy } from '../sessionPolicy';
import { MAX_MINUTES_PER_UNIT } from '../materialConstraints';
export function validateSettings(s: Settings): string[] {
  const errors: string[] = [...commuteErrors(s.commute), ...commuteScheduleErrors(s)];
  const policy = sessionPolicy(s);
  if (
    !Number.isInteger(policy.minimum) ||
    !Number.isInteger(policy.preferred) ||
    policy.minimum < 1 ||
    policy.preferred < policy.minimum ||
    policy.preferred > 1440
  )
    errors.push('予定の下限は1分以上、まとまりの目安は下限以上・1440分以下にしてください。');
  if (
    !Number.isInteger(s.classTransition ?? 0) ||
    (s.classTransition ?? 0) < 0 ||
    (s.classTransition ?? 0) > 180
  )
    errors.push('授業前後の移動・準備は0〜180分の整数で指定してください。');
  if (!(
    Number.isInteger(s.block) &&
    Number.isInteger(s.rest) &&
    s.block > 0 &&
    s.block <= 1440 &&
    s.rest >= 1 &&
    s.rest <= 1440 &&
    s.buffer >= 0 &&
    s.buffer < 1
  ))
    errors.push('連続学習は1〜1440分、休憩は1〜1440分、余裕率は0〜99%で設定してください。');
  for (const meal of Object.values(s.meals ?? {}))
    if (
      !meal ||
      !Number.isInteger(meal.start) ||
      meal.start < 0 ||
      meal.start >= 1440 ||
      !Number.isInteger(meal.duration) ||
      meal.duration < 30 ||
      meal.duration > 60
    )
      errors.push('食事は開始時刻と30〜60分の長さを指定してください。');
  for (const e of s.exams)
    if (
      !e.name.trim() ||
      !e.start ||
      !e.target ||
      e.target < e.start ||
      !Number.isInteger(e.reviewDays) ||
      e.reviewDays < 0 ||
      addDays(e.start, e.reviewDays) > e.target
    )
      errors.push(`${e.name || '試験'}：日付と復習期間を確認してください。`);
  for (const m of s.materials)
    if (
      !s.exams.some((e) => e.id === m.examId) ||
      !m.name.trim() ||
      !Number.isInteger(m.order) ||
      m.order < 1 ||
      !Number.isInteger(m.total) ||
      m.total < 1 ||
      !m.rounds.length ||
      m.rounds.some(
        (r) =>
          !Number.isInteger(r.completed) ||
          r.completed < 0 ||
          r.completed > m.total ||
          !Number.isFinite(r.minutes) ||
          r.minutes <= 0,
      )
    )
      errors.push(`${m.name || '教材'}：問題数と所要時間を確認してください。`);
  for (const m of s.materials)
    m.rounds.forEach((r, i) => {
      if (r.minutes > MAX_MINUTES_PER_UNIT)
        errors.push(
          `${m.name || '教材'}：${i + 1}周目の1問あたりを${MAX_MINUTES_PER_UNIT}分以下にしてください。`,
        );
    });
  for (const w of s.windows)
    if (
      !w.from ||
      w.to < w.from ||
      !w.weekdays.length ||
      !Number.isFinite(w.start) ||
      !Number.isFinite(w.end) ||
      w.start < 0 ||
      w.end > 1440 ||
      w.start >= w.end
    )
      errors.push(`${w.name}：期間・曜日・時間帯を確認してください。`);
  for (const e of s.exceptions)
    if (
      !e.date ||
      !Number.isFinite(e.start) ||
      !Number.isFinite(e.end) ||
      e.start < 0 ||
      e.end > 1440 ||
      e.start >= e.end
    )
      errors.push(`${e.name}：予定の時間を確認してください。`);
  return errors;
}
