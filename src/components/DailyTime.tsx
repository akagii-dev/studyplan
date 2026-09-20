import { Warning } from './Warnings';
import { Settings, clock } from '../domain/model';
import { dailyTime, TimeKind, TimeSegment, OverviewSegment } from '../domain/dailyTime';
import { duration } from './common';
const labels: Record<TimeKind, string> = {
  meal: '食事',
  commute: '通学',
  mealCommute: '食事・通学（重複）',
  busy: '授業・予定・移動',
  available: '学習可能時間',
  rest: '学習の合間の休憩',
  outside: '学習対象外・未設定',
};
const segmentLabel = (s: TimeSegment | OverviewSegment) =>
  s.commuteNames.length
    ? `${s.kind === 'mealCommute' ? '食事・' : ''}${s.commuteNames.join('・')}`
    : s.kind === 'studyWindow'
      ? '学習可能枠（休憩を含む）'
      : labels[s.kind];
export function DailyTime({ settings, date }: { settings: Settings; date: string }) {
  let day;
  try {
    day = dailyTime(settings, date);
  } catch {
    return (
      <Warning id="dailytime-0" title="時間の設定を確認してください" version={settings}>
        時間の内訳を表示するには、連続学習・休憩・余裕率の設定を確認してください。
      </Warning>
    );
  }
  return (
    <section className="card daily-time" aria-label="1日の可処分時間">
      <div className="row">
        <h3>1日の可処分時間</h3>
        <small>{date} · 現在の設定</small>
      </div>
      <p>
        勉強に使える空き時間 <strong>{duration(day.capacity.free)}</strong> ／ 休憩を除くと{' '}
        <strong>{duration(day.capacity.focus)}</strong>
      </p>
      {day.commutes.length > 0 && (
        <div className="daily-commute" aria-label="通学の往復内訳">
          <p>
            <strong>この日の通学：計{duration(day.commuteMinutes)}</strong>
          </p>
          <ul className="day-time-list">
            {day.commutes.map((e) => (
              <li key={e.id}>
                {e.name}：{clock(e.start)}〜{clock(e.end)}（{duration(e.end - e.start)}）
              </li>
            ))}
          </ul>
          {day.totals.mealCommute > 0 && (
            <p className="hint">
              食事と{duration(day.totals.mealCommute)}
              重なっています。下の内訳では「食事・通学（重複）」にまとめ、二重には差し引きません。
            </p>
          )}
        </div>
      )}
      {day.adjustedMeals.length > 0 && (
        <p className="hint">
          {day.adjustedMeals
            .map((e) => `${e.name}：${clock(e.start)}〜${clock(e.end)}`)
            .join(' ／ ')}
        </p>
      )}
      <div
        className="day-time-bar"
        role="img"
        aria-label="24時間の内訳。詳しい時刻は下の一覧で確認できます。"
      >
        {day.segments.map((s) => (
          <span
            key={s.start}
            className={`time-${s.kind}`}
            style={{ width: `${((s.end - s.start) / 1440) * 100}%` }}
            title={`${clock(s.start)}〜${clock(s.end)} ${segmentLabel(s)}`}
          />
        ))}
      </div>
      <div className="row hint">
        <span>00:00</span>
        <span>12:00</span>
        <span>24:00</span>
      </div>
      <dl className="time-legend">
        {(Object.keys(labels) as TimeKind[])
          .filter((kind) => kind !== 'mealCommute' || day.totals.mealCommute > 0)
          .map((kind) => (
            <div key={kind}>
              <dt>
                <i className={`time-${kind}`} />
                {labels[kind]}
                {day.totals.mealCommute > 0 && (kind === 'meal' || kind === 'commute')
                  ? '（重複分を除く）'
                  : ''}
              </dt>
              <dd>{duration(day.totals[kind])}</dd>
            </div>
          ))}
      </dl>
      <details>
        <summary>時刻の内訳を見る</summary>
        <ul className="day-time-list">
          {day.overview.map((s) => (
            <li key={s.start}>
              {clock(s.start)}〜{clock(s.end)}：{segmentLabel(s)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
