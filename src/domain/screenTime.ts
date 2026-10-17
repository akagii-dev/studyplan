import { AppState, DateKey, addDays, weekday } from './model';
import { todayStudyRows } from './todayProgress';

/**
 * A Screen Time passcode kept by the app: the user enters it on their phone without learning it,
 * and the app shows it only on a Sunday after six cleared days (Monday to Saturday).
 */
export interface ScreenTimeLock {
  enabled: boolean;
  /** The passcode the phone should have now; absent until the first one is issued. */
  code?: string;
  /** The passcode it replaced, shown beside a new one because the phone asks for the old one. */
  previous?: string;
  issuedOn?: DateKey;
  /** Shown until the user confirms they entered it on the phone; hidden from then on. */
  pending?: boolean;
  /** The day the user confirmed; a week counts when it was set by that week's Monday. */
  setOn?: DateKey;
}

/** Codes that are easy to guess or remember: one digit, runs, two-digit repeats and years. */
export function isObviousCode(code: string) {
  if (!/^\d{4}$/.test(code)) return true;
  const d = [...code].map(Number);
  const steps = [d[1] - d[0], d[2] - d[1], d[3] - d[2]];
  if (steps.every((s) => s === 0)) return true;
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  if (code.slice(0, 2) === code.slice(2)) return true;
  if (/^(19|20)\d\d$/.test(code)) return true;
  return false;
}

/** A random four-digit passcode that is not obvious and differs from the one it replaces. */
export function generateCode(previous?: string, random: () => number = secureRandom) {
  for (;;) {
    const code = String(Math.floor(random() * 10_000)).padStart(4, '0');
    if (!isObviousCode(code) && code !== previous) return code;
  }
}
function secureRandom() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 2 ** 32;
}

/** A day counts as cleared when every planned row is complete; a day with nothing planned counts too. */
export const dayCleared = (state: AppState, date: DateKey) =>
  todayStudyRows(state, date).every((row) => row.progress.complete);

export const mondayOf = (date: DateKey) => addDays(date, -((weekday(date) + 6) % 7));

/** Monday to Saturday of the week containing `date`, with each day's state as of `today`. */
export function weekProgress(state: AppState, date: DateKey, today: DateKey) {
  const monday = mondayOf(date);
  return Array.from({ length: 6 }, (_, i) => {
    const day = addDays(monday, i);
    return { date: day, status: day > today ? 'upcoming' as const : dayCleared(state, day) ? 'cleared' as const : day === today ? 'open' as const : 'missed' as const };
  });
}

/** Whether the Sunday `sunday` unlocks: the code was set by that week's Monday and all six days are cleared. */
export function sundayUnlocks(state: AppState, sunday: DateKey) {
  const lock = state.screenTime;
  if (!lock?.enabled || !lock.code || lock.pending || !lock.setOn || weekday(sunday) !== 0) return false;
  const monday = addDays(sunday, -6);
  if (lock.setOn > monday) return false;
  return Array.from({ length: 6 }, (_, i) => addDays(monday, i)).every((day) => dayCleared(state, day));
}

/** What the lock panel shows on `today`. */
export function lockView(state: AppState, today: DateKey) {
  const lock = state.screenTime;
  if (!lock?.enabled) return { kind: 'off' as const };
  if (!lock.code) return { kind: 'unissued' as const };
  if (lock.pending) return { kind: 'pending' as const, code: lock.code, previous: lock.previous };
  if (sundayUnlocks(state, today)) return { kind: 'unlocked' as const, code: lock.code };
  // After a Sunday that revealed the code, a new one can be issued from Monday on.
  const lastSunday = addDays(today, -((weekday(today) + 7) % 7 || 7));
  if (lock.issuedOn && lock.issuedOn <= lastSunday && sundayUnlocks(state, lastSunday))
    return { kind: 'renew' as const };
  // A code set after this week's Monday starts counting next week.
  const startsNextWeek = !!lock.setOn && lock.setOn > mondayOf(today);
  return { kind: 'locked' as const, week: weekProgress(state, today, today), startsNextWeek };
}

/** Issues a passcode (the first one, or a new one after an unlocked Sunday); it stays shown until confirmed. */
export function issueCode(state: AppState, today: DateKey, random?: () => number): AppState {
  const lock = state.screenTime ?? { enabled: true };
  const code = generateCode(lock.code, random);
  return { ...state, screenTime: { ...lock, previous: lock.code, code, issuedOn: today, pending: true, setOn: undefined } };
}

/** The user entered the shown passcode on the phone; hide it until an unlocked Sunday. */
export function confirmCode(state: AppState, today: DateKey): AppState {
  const lock = state.screenTime;
  if (!lock?.code) return state;
  return { ...state, screenTime: { ...lock, pending: false, previous: undefined, setOn: today } };
}
