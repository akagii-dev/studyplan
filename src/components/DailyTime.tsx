import { useId } from 'react';
import { Warning } from './Warnings';
import { Settings, OutsideTime, clock } from '../domain/model';
import { dailyTime } from '../domain/dailyTime';
import { dailyTimeDisplay, DisplayTimeKind } from '../domain/dailyTimeDisplay';
import { duration } from './common';

const labels: Record<DisplayTimeKind, string> = {
  available: '学習可能',
  rest: '学習の合間の休憩',
  busy: '授業・予定・移動',
  meal: '食事',
  commute: '通学',
  mealCommute: '食事・通学（重複）',
  sleep: '睡眠',
  bath: '風呂',
  outside: '学習対象外・未設定',
};

export function DailyTime({
  settings,
  date,
  outsideTime,
}: {
  settings: Settings;
  date: string;
  outsideTime?: OutsideTime;
}) {
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
  const display = dailyTimeDisplay(day.segments, outsideTime);
  // Group only the chart/legend. Detailed categories and calculation stay independent.
  const chartItems = (Object.keys(labels) as DisplayTimeKind[])
    .filter((kind) => kind !== 'commute' && kind !== 'mealCommute')
    .map((kind) => ({
      kind,
      value:
        kind === 'meal'
          ? display.totals.meal + display.totals.commute + display.totals.mealCommute
          : display.totals[kind],
    }));
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
            {chartItems.map(({ kind, value }, index) => {
              if (!value) return null;
              const offset = chartItems.slice(0, index).reduce((sum, item) => sum + item.value, 0);
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
          {chartItems
            .filter(({ kind }) => (kind !== 'sleep' && kind !== 'bath') || !!outsideTime?.[kind])
            .map(({ kind, value }) => (
              <div key={kind} data-kind={kind}>
                <dt>
                  <span className={`time-swatch time-${kind}`} aria-hidden="true" />
                  {kind === 'meal' ? '通学・食事' : labels[kind]}
                </dt>
                <dd>
                  {kind === 'meal' ? (
                    <>
                      （食事{duration(display.totals.meal + display.totals.mealCommute)}、通学
                      {duration(display.totals.commute + display.totals.mealCommute)}）
                    </>
                  ) : (
                    duration(value)
                  )}
                </dd>
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
          <p>凡例の食事・通学はそれぞれ重複分を含みます。円グラフでは重複分を1回だけ集計します。</p>
        )}
        {(outsideTime?.sleep || outsideTime?.bath) && (
          <p>睡眠・風呂は学習対象外の区間に重なる分だけを表示しています。</p>
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
            {display.segments.map((s) => (
              <tr key={s.start} data-kind={s.kind}>
                <th scope="row">
                  <span>{clock(s.start)}</span>〜<wbr />
                  <span>{clock(s.end)}</span>
                </th>
                <td>
                  <span className={`time-category time-${s.kind}`}>{labels[s.kind]}</span>
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
