import { AppState, addDays, weekday } from '../domain/model';
import {
  HOURLY_POINTS, LOGIN_POINTS, levelOf, levelReward, loginDays, loginStreak, pointsOn, totalPoints,
} from '../domain/rewards';

const pt = (points: number) => `${points.toLocaleString('ja-JP')}pt`;
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
/** A game panel on the black band, slanted on its right edge like the mission panel. */
const panel =
  'relative mb-6 bg-band px-6 pt-5 pb-6 text-on-band [clip-path:polygon(0_0,100%_0,calc(100%-24px)_100%,0_100%)] @max-[430px]:px-4';
const eyebrow = 'm-0 font-display text-[13px] font-black italic tracking-[0.16em] text-band-muted';

/** The login bonus week: Monday to Sunday around today, one stamp per day with a record. */
export function LoginBonus({ state, date }: { state: AppState; date: string }) {
  const days = loginDays(state);
  const since = state.rewards?.since;
  const monday = addDays(date, -((weekday(date) + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const streak = loginStreak(state, date);
  return (
    <section aria-labelledby="login-bonus-title" className={panel}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <p className={eyebrow} lang="en">LOGIN BONUS</p>
          <h2 id="login-bonus-title" className="m-0 font-display text-[20px] font-black italic text-on-band">
            ログインボーナス
          </h2>
        </div>
        <p className="m-0 text-[13px] text-band-muted">
          <span className="font-display font-black italic text-[28px] text-band-accent tabular-nums">{streak}</span>日連続 · 毎日の最初の記録で +{LOGIN_POINTS}pt
        </p>
      </div>
      <ol className="m-0 mt-4 grid list-none grid-cols-7 gap-1.5 p-0 pe-6 @max-[430px]:pe-3">
        {week.map((day) => {
          const got = days.has(day);
          const isToday = day === date;
          const before = !since || day < since;
          const status = got ? `ボーナス獲得 +${LOGIN_POINTS}pt` : isToday ? '今日はまだ記録なし' : day > date ? '' : before ? '対象外' : '記録なし';
          return (
            <li
              key={day}
              className={`flex min-w-0 -skew-x-[8deg] flex-col items-center gap-0.5 py-2 ${got ? 'bg-band-accent text-band' : isToday ? 'border-2 border-dashed border-band-accent text-on-band' : 'bg-[color-mix(in_oklab,var(--on-band)_12%,transparent)] text-band-muted'}`}
            >
              <span className="text-[11px]">{weekdays[weekday(day)]}</span>
              <span className="font-display font-black italic text-[18px] tabular-nums">{Number(day.slice(8))}</span>
              <span aria-hidden="true" className="font-display font-black italic text-[11px]">{got ? `+${LOGIN_POINTS}` : isToday ? 'TODAY' : '·'}</span>
              {status && <span className="sr-only">{status}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Points and the level they reach, with the points still needed and the next level's reward. */
export function RewardProgress({ state, date }: { state: AppState; date: string }) {
  const total = totalPoints(state);
  const { level, current, cost, toNext } = levelOf(total);
  const today = pointsOn(state, date);
  const percent = Math.min(100, (current / cost) * 100);
  return (
    <section aria-labelledby="reward-title" className={panel}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className={eyebrow} lang="en">REWARD</p>
          <h2 id="reward-title" className="m-0 font-display text-[20px] font-black italic text-on-band">
            報酬レベル
          </h2>
        </div>
        <p className="m-0 leading-none text-on-band">
          <span className="font-display font-black italic text-[20px] text-band-muted" lang="en">Lv</span>
          <span className="font-display font-black italic text-[60px] text-band-accent tabular-nums @max-[430px]:text-[44px]">{level}</span>
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={`レベル${level + 1}までの進み具合`}
        aria-valuemin={0}
        aria-valuemax={cost}
        aria-valuenow={current}
        aria-valuetext={`${pt(cost)}中${pt(current)}`}
        className="mt-3 me-6 h-4 -skew-x-[24deg] bg-[color-mix(in_oklab,var(--on-band)_20%,transparent)]"
      >
        <span className="block h-full bg-band-accent [transition:width_400ms_cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-3 mb-0 text-[14px] text-on-band tabular-nums">
        Lv{level + 1}まで あと <strong className="font-display font-black italic text-[20px] font-normal text-band-accent">{pt(toNext)}</strong>
        <span className="text-band-muted">（{pt(current)} / {pt(cost)}）</span>
      </p>
      <p className="mt-1 mb-0 text-[14px] text-on-band">
        Lv{level + 1}の報酬：<strong className="font-display font-black italic">{levelReward(level + 1)}</strong>
      </p>
      <p className="mt-3 mb-0 text-[12px] text-band-muted tabular-nums">
        合計 {pt(total)} · 今日 +{pt(today)} · 勉強1時間 {pt(HOURLY_POINTS)}
      </p>
    </section>
  );
}
