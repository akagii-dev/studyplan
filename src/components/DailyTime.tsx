import { useId } from 'react';
import { Warning } from './Warnings';
import { Settings, clock } from '../domain/model';
import { dailyTime, TimeKind } from '../domain/dailyTime';
import { duration } from './common';

const labels: Record<TimeKind, string> = {
  available: '学習可能',
  rest: '学習の合間の休憩',
  busy: '授業・予定・移動',
  meal: '食事',
  commute: '通学',
  mealCommute: '食事・通学（重複）',
  outside: '学習対象外・未設定',
};

export function DailyTime({ settings, date }: { settings: Settings; date: string }) {
  const headingId = useId();
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
    <section className="card daily-time" aria-labelledby={headingId}>
      <header className="daily-time-heading">
        <h2 id={headingId}>1日の可処分時間</h2>
        <p>
          <time dateTime={date}>{date}</time> · 現在の設定
        </p>
      </header>
      {settings.commute?.enabled &&
        settings.commute.mode === 'classDays' &&
        !settings.commute.departureTimesConfirmed && (
          <Warning
            id="commute-departure-confirmation"
            title="通学の出発時刻を確認してください"
            version={settings.commute}
          >
            「通学時間」で往路・復路の出発時刻を設定してください。確認前は従来の授業前後の時間を表示しています。
          </Warning>
        )}
      {day.totals.mealCommute > 0 && (
        <p className="daily-time-warning">
          食事と通学が{duration(day.totals.mealCommute)}
          重なっています。通学の出発時刻または食事時間を修正してください。
        </p>
      )}
      <div className="daily-time-summary">
        <div className="daily-time-primary">
          <dl className="daily-time-metric">
            <div>
              <dt>学習可能</dt>
              <dd>{duration(day.capacity.focus)}</dd>
            </div>
          </dl>
          <p className="daily-time-support">休憩を含む空き枠 {duration(day.capacity.free)}</p>
        </div>
        {/* The adjacent text and detail table provide the full alternative to this chart. */}
        <div className="daily-time-visual" aria-hidden="true">
          <svg className="daily-time-donut" viewBox="0 0 200 200" focusable="false">
            {(Object.keys(labels) as TimeKind[]).map((kind, index, kinds) => {
              const value = day.totals[kind];
              if (!value) return null;
              const offset = kinds.slice(0, index).reduce((sum, k) => sum + day.totals[k], 0);
              return (
                <circle
                  key={kind}
                  className={`time-${kind}`}
                  data-kind={kind}
                  cx="100"
                  cy="100"
                  r="74"
                  pathLength="1440"
                  strokeDasharray={`${value} ${1440 - value}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 100 100)"
                />
              );
            })}
          </svg>
          <span className="daily-time-total">24時間</span>
        </div>
        <dl className="time-legend">
          {(Object.keys(labels) as TimeKind[])
            .filter((kind) => kind !== 'mealCommute' || day.totals.mealCommute > 0)
            .map((kind) => (
              <div key={kind} data-kind={kind}>
                <dt>
                  <span className={`time-swatch time-${kind}`} aria-hidden="true" />
                  {labels[kind]}
                  {day.totals.mealCommute > 0 && (kind === 'meal' || kind === 'commute')
                    ? '（重複分を除く）'
                    : ''}
                </dt>
                <dd>{duration(day.totals[kind])}</dd>
              </div>
            ))}
        </dl>
      </div>
      <details className="daily-time-details">
        <summary>時刻・通学の内訳を見る</summary>
        {day.commutes.length > 0 && (
          <div className="daily-commute">
            <h3>通学の往復</h3>
            <p>この日の通学：計{duration(day.commuteMinutes)}（重複区間は1回だけ集計）</p>
            <dl className="daily-commute-list">
              {day.commutes.map((e) => (
                <div key={e.id}>
                  <dt>{e.name}</dt>
                  <dd>
                    {clock(e.start)}〜{clock(e.end)} · {duration(e.end - e.start)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {day.totals.mealCommute > 0 && (
          <p>食事・通学の重複は独立した区分です。凡例の食事・通学には重複分を含めません。</p>
        )}
        <table className="daily-time-table">
          <caption>24時間の内訳</caption>
          <thead>
            <tr>
              <th scope="col">時刻</th>
              <th scope="col">分類</th>
              <th scope="col">長さ</th>
            </tr>
          </thead>
          <tbody>
            {day.segments.map((s) => (
              <tr key={s.start} data-kind={s.kind}>
                <th scope="row">
                  <span>{clock(s.start)}</span>〜<wbr />
                  <span>{clock(s.end)}</span>
                </th>
                <td>
                  {labels[s.kind]}
                  {s.commuteNames.length > 0 && (
                    <span className="daily-time-note">{s.commuteNames.join('・')}</span>
                  )}
                </td>
                <td>{duration(s.end - s.start)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
