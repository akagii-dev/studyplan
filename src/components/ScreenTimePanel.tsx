import { useState } from 'react';
import { Props } from './common';
import { weekday } from '../domain/model';
import { confirmCode, issueCode, lockView } from '../domain/screenTime';

const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
/** Same black band as the mission and reward panels. */
const panel =
  'relative mb-6 bg-band px-6 pt-5 pb-6 text-on-band [clip-path:polygon(0_0,100%_0,calc(100%-24px)_100%,0_100%)] @max-[430px]:px-4';
const eyebrow = 'm-0 font-display text-[13px] font-black italic tracking-[0.16em] text-band-muted';
const digits = 'font-display text-[48px] leading-none font-black italic tracking-[0.3em] text-band-accent tabular-nums';
/** A button on the band: paper plate, inverted on hover. */
const bandButton = 'mt-4 border-on-band bg-on-band text-band hover:enabled:border-band-accent hover:enabled:bg-band-accent hover:enabled:text-band';

/** The Screen Time lock on today: issue, confirm, the week toward Sunday (from the set day), and the Sunday reveal. */
export function ScreenTimePanel({ state, update, date }: Props & { date: string }) {
  const view = lockView(state, date);
  const [busy, setBusy] = useState(false);
  if (view.kind === 'off') return null;
  async function act(change: typeof issueCode | typeof confirmCode) {
    if (busy) return;
    setBusy(true);
    try {
      await update((current) => change(current, date));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="screen-time-title" className={panel}>
      <p className={eyebrow} lang="en">SCREEN TIME</p>
      <h2 id="screen-time-title" className="m-0 font-display text-[20px] font-black italic text-on-band">
        スクリーンタイムのパスコード
      </h2>
      {view.kind === 'unissued' && (
        <>
          <p className="mt-2 mb-0 text-[14px] text-on-band">
            4桁のパスコードを作ります。表示された番号をスマホのスクリーンタイムに設定すると、月〜土をすべてクリアした週の日曜だけ、ここに表示されます。
          </p>
          <button className={bandButton} disabled={busy} onClick={() => void act(issueCode)}>パスコードを発行する</button>
        </>
      )}
      {view.kind === 'renew' && (
        <>
          <p className="mt-2 mb-0 text-[14px] text-on-band">先週はすべてクリアしました。新しいパスコードに替えて、また1週間がんばりましょう。</p>
          <button className={bandButton} disabled={busy} onClick={() => void act(issueCode)}>新しいパスコードを発行する</button>
        </>
      )}
      {view.kind === 'pending' && (
        <>
          <p className="mt-2 mb-0 text-[14px] text-on-band">
            スマホの「設定」→「スクリーンタイム」でパスコードをこの番号に変えてください。設定したら下のボタンを押すと、番号は隠れます。
          </p>
          <dl className="m-0 mt-3 flex flex-wrap gap-x-10 gap-y-2">
            {view.previous && (
              <div>
                <dt className="text-[12px] text-band-muted">今のパスコード</dt>
                <dd className={`m-0 ${digits} text-on-band`}>{view.previous}</dd>
              </div>
            )}
            <div>
              <dt className="text-[12px] text-band-muted">新しいパスコード</dt>
              <dd className={`m-0 ${digits}`}>{view.code}</dd>
            </div>
          </dl>
          <button className={bandButton} disabled={busy} onClick={() => void act(confirmCode)}>スマホに設定した</button>
        </>
      )}
      {view.kind === 'unlocked' && (
        <>
          <p className="mt-2 mb-1 font-display text-[22px] font-black italic text-band-accent" lang="en">UNLOCKED</p>
          <p className="m-0 text-[14px] text-on-band">{weekdays[view.from]}〜土をすべてクリアしました。今日だけパスコードを表示します。</p>
          <p className={`mt-3 mb-0 ${digits}`}>{view.code}</p>
          <p className="mt-2 mb-0 text-[12px] text-band-muted">月曜に新しいパスコードを発行できます。</p>
        </>
      )}
      {view.kind === 'locked' && (
        <>
          <p className="mt-2 mb-0 text-[14px] text-on-band">
            <span className="font-display font-black italic text-band-accent" lang="en">LOCKED</span>
            {' '}{view.startsNextWeek ? '月' : weekdays[view.from]}〜土をすべてクリアすると、日曜にパスコードを表示します。
          </p>
          <ol className="m-0 mt-3 grid list-none grid-cols-6 gap-1.5 p-0 pe-6">
            {view.week.map((day) => (
              <li
                key={day.date}
                className={`flex -skew-x-[8deg] flex-col items-center py-1.5 text-[12px] ${day.status === 'cleared' ? 'bg-band-accent text-band' : day.status === 'missed' ? 'bg-[color-mix(in_oklab,var(--on-band)_12%,transparent)] text-band-muted line-through' : day.status === 'open' ? 'border-2 border-dashed border-band-accent text-on-band' : day.status === 'before' ? 'border-2 border-[color-mix(in_oklab,var(--on-band)_20%,transparent)] text-band-muted' : 'bg-[color-mix(in_oklab,var(--on-band)_12%,transparent)] text-band-muted'}`}
              >
                <span>{weekdays[weekday(day.date)]}</span>
                <span className="font-display font-black italic">
                  {{ cleared: 'CLEAR', missed: 'MISS', open: 'TODAY', upcoming: '·', before: '—' }[day.status]}
                </span>
                <span className="sr-only">{{ cleared: 'クリア', missed: '未達成', open: '今日・未達成', upcoming: 'これから', before: '設定前のため数えない' }[day.status]}</span>
              </li>
            ))}
          </ol>
          {view.startsNextWeek && (
            <p className="mt-2 mb-0 text-[12px] text-band-muted">日曜に設定したため、明日の月曜から数えます。</p>
          )}
          {!view.startsNextWeek && view.from !== 1 && (
            <p className="mt-2 mb-0 text-[12px] text-band-muted">今週は設定した{weekdays[view.from]}曜から数えます。</p>
          )}
          {!view.startsNextWeek && view.week.some((day) => day.status === 'missed') && (
            <p className="mt-2 mb-0 text-[12px] text-band-muted">今週は達成できなかった日があるため、日曜は表示しません。来週もこのパスコードのまま続きます。</p>
          )}
        </>
      )}
    </section>
  );
}
