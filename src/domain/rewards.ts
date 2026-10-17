import { AppState, DateKey, addDays, today } from './model';

/** Points for the first record of a day (the login bonus). */
export const LOGIN_POINTS = 100;
/** Points per hour of the recorded amount's estimated study time. */
export const HOURLY_POINTS = 1200;
/** Level 1 is half of a full week: seven login bonuses and seven seven-hour days. */
export const FIRST_LEVEL_POINTS = (LOGIN_POINTS * 7 + HOURLY_POINTS * 7 * 7) / 2;
/** Each level asks for this many times the points of the level before it. */
export const LEVEL_GROWTH = 1.2;

export interface RewardEntry {
  kind: 'login' | 'study';
  date: DateKey;
  points: number;
  /** The study record the points come from. */
  recordId?: string;
  /** Minutes per unit when the record was first rewarded; later material edits do not rewrite it. */
  minutesPerUnit?: number;
}
export interface Rewards {
  /** Rewards count from this date; earlier records never earn points. */
  since: DateKey;
  entries: RewardEntry[];
}

/**
 * Brings the reward ledger in line with the records. Called with every record, correction and
 * cancellation: a record earns its estimated hours at the hourly rate, a corrected count changes
 * its points and a cancelled one returns them; a day with at least one counted record keeps its
 * login bonus. The ledger starts on the first call, so only study from that day on counts.
 */
export function settleRewards(state: AppState, date: DateKey = today()): AppState {
  const rewards = state.rewards ?? { since: date, entries: [] };
  const previous = new Map(rewards.entries.filter((e) => e.kind === 'study').map((e) => [e.recordId, e]));
  const study: RewardEntry[] = [];
  const days = new Set<DateKey>();
  for (const record of state.records) {
    if (record.date < rewards.since) continue;
    const material = state.settings.materials.find((m) => m.id === record.materialId);
    const minutesPerUnit = previous.get(record.id)?.minutesPerUnit ?? material?.rounds[record.round]?.minutes;
    if (minutesPerUnit === undefined) continue;
    const counted = !record.cancelled && record.count > 0;
    if (counted) days.add(record.date);
    study.push({
      kind: 'study',
      date: record.date,
      recordId: record.id,
      minutesPerUnit,
      points: counted ? Math.round((record.count * minutesPerUnit * HOURLY_POINTS) / 60) : 0,
    });
  }
  const login = [...days].map((day): RewardEntry => ({ kind: 'login', date: day, points: LOGIN_POINTS }));
  const entries = [...login, ...study].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'login' ? -1 : 1));
  return { ...state, rewards: { since: rewards.since, entries } };
}

export const totalPoints = (state: AppState) =>
  (state.rewards?.entries ?? []).reduce((sum, entry) => sum + entry.points, 0);

/** Points needed to go from level `level - 1` to `level`, rounded to tens. */
export const levelCost = (level: number) =>
  Math.round((FIRST_LEVEL_POINTS * LEVEL_GROWTH ** (level - 1)) / 10) * 10;

/** The level reached with `points`, and the progress toward the next one. */
export function levelOf(points: number) {
  let level = 0;
  let floor = 0;
  while (points >= floor + levelCost(level + 1)) {
    floor += levelCost(level + 1);
    level += 1;
  }
  const cost = levelCost(level + 1);
  return { level, current: points - floor, cost, toNext: floor + cost - points, nextTotal: floor + cost };
}

/** What each level stands for, valued at 1 point = 1 yen of its cumulative points. */
const rewardItems = [
  'ワイヤレスイヤホン',
  'ゲーム機',
  'タブレット',
  'ノートパソコン',
  '国内旅行',
  'ミラーレスカメラ',
  '海外旅行',
];
export const levelReward = (level: number) => rewardItems[level - 1] ?? 'ごほうびを自由に1つ';

/** Days in a row with a login bonus, ending today (or yesterday while today has no record yet). */
export function loginStreak(state: AppState, date: DateKey = today()) {
  const days = new Set((state.rewards?.entries ?? []).filter((e) => e.kind === 'login').map((e) => e.date));
  let day = days.has(date) ? date : addDays(date, -1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

export const loginDays = (state: AppState) =>
  new Set((state.rewards?.entries ?? []).filter((e) => e.kind === 'login').map((e) => e.date));

/** Points earned on one date. */
export const pointsOn = (state: AppState, date: DateKey) =>
  (state.rewards?.entries ?? []).filter((e) => e.date === date).reduce((sum, e) => sum + e.points, 0);
