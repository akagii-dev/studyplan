import { useId } from 'react';
import { Warning } from './Warnings';
import { Settings, OutsideTime, OutsideLabel, clock } from '../domain/model';
import { dailyTime } from '../domain/dailyTime';
import { dailyTimeDisplay, DisplayTimeKind } from '../domain/dailyTimeDisplay';
import { duration } from './common';
import { DailyTimeChart } from './DailyTimeChart';
import { OutsideLabelEditor } from './OutsideLabelEditor';

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
  outsideLabels,
  onRenameOutside,
}: {
  settings: Settings;
  date: string;
  outsideTime?: OutsideTime;
  outsideLabels?: OutsideLabel[];
  onRenameOutside?: (start: number, end: number, title: string | null) => Promise<void>;
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
  const display = dailyTimeDisplay(day.segments, outsideTime, outsideLabels);
  // Group only the chart/legend. Detailed categories and calculation stay independent.
  const chartItems = (Object.keys(labels) as DisplayTimeKind[])
    .filter((kind) => kind !== 'commute' && kind !== 'mealCommute' && kind !== 'bath')
    .map((kind) => ({
      kind,
      value:
        kind === 'meal'
          ? display.totals.meal + display.totals.commute + display.totals.mealCommute
          : kind === 'sleep'
            ? display.totals.sleep + display.totals.bath
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
        <DailyTimeChart items={chartItems} focus={day.capacity.focus} />
        <div className="daily-time-breakdown">
          <dl className="time-legend">
            {chartItems
              .filter(
                ({ kind }) =>
                  kind !== 'available' &&
                  (kind !== 'sleep' || !!outsideTime?.sleep || !!outsideTime?.bath),
              )
              .map(({ kind, value }) => (
                <div key={kind} data-kind={kind}>
                  <dt>
                    <span className={`time-swatch time-${kind}`} aria-hidden="true" />
                    {kind === 'meal'
                      ? '通学・食事'
                      : kind === 'sleep'
                        ? '睡眠・風呂'
                        : labels[kind]}
                  </dt>
                  <dd>
                    {kind === 'meal' ? (
                      <>
                        （食事{duration(display.totals.meal + display.totals.mealCommute)}、通学
                        {duration(display.totals.commute + display.totals.mealCommute)}）
                      </>
                    ) : kind === 'sleep' ? (
                      <>
                        （睡眠{duration(display.totals.sleep)}、風呂{duration(display.totals.bath)}
                        ）
                      </>
                    ) : (
                      duration(value)
                    )}
                  </dd>
                </div>
              ))}
          </dl>
          <p className="daily-time-support">休憩を含む空き枠 {duration(day.capacity.free)}</p>
        </div>
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
                  <span className={`time-category time-${s.kind}`}>
                    {s.title ?? labels[s.kind]}
                  </span>
                  {s.title && <span className="daily-time-note">学習対象外</span>}
                  {s.kind === 'outside' && onRenameOutside && (
                    <OutsideLabelEditor
                      start={s.start}
                      end={s.end}
                      title={s.title}
                      save={(title) => onRenameOutside(s.start, s.end, title)}
                    />
                  )}
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
