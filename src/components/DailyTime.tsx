import { Settings, clock } from '../domain/model';
import { dailyTime, TimeKind } from '../domain/dailyTime';
import { duration } from './common';
const labels: Record<TimeKind, string> = {
  meal: '食事',
  busy: '授業・予定・移動',
  available: '計画を入れられる時間',
  buffer: '余裕として残す時間',
  rest: '学習の合間の休憩',
  outside: '学習対象外・未設定',
};
export function DailyTime({ settings, date }: { settings: Settings; date: string }) {
  let day;
  try {
    day = dailyTime(settings, date);
  } catch {
    return (
      <p className="warning">
        時間の内訳を表示するには、連続学習・休憩・余裕率の設定を確認してください。
      </p>
    );
  }
  return (
    <section className="card daily-time" aria-label="1日の可処分時間">
      <div className="row">
        <h3>1日の可処分時間</h3>
        <small>{date} · 現在の設定</small>
      </div>
      <p>
        勉強に使える空き時間 <strong>{duration(day.capacity.free)}</strong> ／ 休憩・余裕を残すと{' '}
        <strong>{duration(day.capacity.allocatable)}</strong>
      </p>
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
            title={`${clock(s.start)}〜${clock(s.end)} ${labels[s.kind]}`}
          />
        ))}
      </div>
      <div className="row hint">
        <span>00:00</span>
        <span>12:00</span>
        <span>24:00</span>
      </div>
      <dl className="time-legend">
        {(Object.keys(labels) as TimeKind[]).map((kind) => (
          <div key={kind}>
            <dt>
              <i className={`time-${kind}`} />
              {labels[kind]}
            </dt>
            <dd>{duration(day.totals[kind])}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>時刻の内訳を見る</summary>
        <ul className="day-time-list">
          {day.segments.map((s) => (
            <li key={s.start}>
              {clock(s.start)}〜{clock(s.end)}：{labels[s.kind]}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
