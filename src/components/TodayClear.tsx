import { useEffect, useRef, useState } from 'react';
import { todayStudyRows } from '../domain/todayProgress';

type Rows = ReturnType<typeof todayStudyRows>;

/** Ids of the rows that became complete while the screen was open; they get the stamp animation. */
export function useNewlyCleared(rows: Rows, key: (row: Rows[number]) => string) {
  const previous = useRef<Set<string> | null>(null);
  const [landed, setLanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const done = new Set(rows.filter((row) => row.progress.complete).map(key));
    // The first render only records the state: a screen that opens on cleared rows does not replay the stamp.
    if (previous.current) {
      const fresh = [...done].filter((id) => !previous.current!.has(id));
      if (fresh.length) setLanded((current) => new Set([...current, ...fresh]));
    }
    previous.current = done;
  }, [rows]);
  return landed;
}

/** A filled stamp beside a cleared row. The visible word is decoration; screen readers hear 完了. */
export function ClearStamp({ animate }: { animate: boolean }) {
  return (
    <span className={`inline-block -rotate-6 bg-accent px-2.5 py-0.5 text-[15px] leading-[1.4] font-black tracking-[0.14em] text-on-accent shadow-[3px_3px_0_var(--ink)] ${animate ? 'motion-safe:animate-stamp' : ''}`}>
      <span aria-hidden="true">CLEAR</span>
      <span className="sr-only">完了</span>
    </span>
  );
}

/** The mission panel at the top of today: how many of today's rows are cleared, as a game meter. */
export function TodayClear({ rows }: { rows: Rows }) {
  const total = rows.length;
  const cleared = rows.filter((row) => row.progress.complete).length;
  const all = total > 0 && cleared === total;
  const wasAll = useRef(all);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (all && !wasAll.current) setLanded(true);
    wasAll.current = all;
  }, [all]);
  if (!total) return null;
  const unit = rows.every((row) => row.unit === rows[0].unit) ? rows[0].unit : '';
  const actual = rows.reduce((sum, row) => sum + row.actual, 0);
  return (
    <section
      aria-label="今日のミッション"
      className="today-clear relative mb-8 -rotate-[1.5deg] bg-band px-6 pt-5 pb-6 text-on-band [clip-path:polygon(0_0,100%_0,calc(100%-24px)_100%,0_100%)] @max-[430px]:px-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-bold tracking-[0.18em] text-band-muted">今日のミッション</p>
          <p className="m-0 text-[22px] leading-[1.4] font-black text-on-band @max-[430px]:text-[18px]">
            {all ? 'すべてクリア' : `あと${total - cleared}件でクリア`}
            {all && (
              <span
                aria-hidden="true"
                className={`ms-4 inline-block -rotate-[10deg] -skew-x-[10deg] bg-band-accent px-4 py-0.5 align-middle text-[30px] shadow-[4px_4px_0_var(--on-band)] leading-[1.3] font-black tracking-[0.1em] text-band ${landed ? 'motion-safe:animate-stamp' : ''}`}
              >
                ALL CLEAR
              </span>
            )}
          </p>
        </div>
        <p className="m-0 leading-none font-black tabular-nums text-on-band">
          <span aria-hidden="true" className="text-[76px] text-band-accent @max-[430px]:text-[52px]">{cleared}</span>
          <span aria-hidden="true" className="text-[28px] text-on-band"> / {total}</span>
          <span className="sr-only">{total}件中{cleared}件クリア</span>
        </p>
      </div>
      <div aria-hidden="true" className="mt-4 flex gap-1.5 pe-6">
        {rows.map((row) => (
          <span
            key={`${row.materialId}/${row.round}`}
            className={`h-3 flex-1 -skew-x-[24deg] transition-[background-color] duration-150 ${row.progress.complete ? 'bg-band-accent' : 'bg-[color-mix(in_oklab,var(--on-band)_20%,transparent)]'}`}
          />
        ))}
      </div>
      {unit && actual > 0 && (
        <p className="mt-3 mb-0 text-[13px] text-band-muted tabular-nums">今日の記録 {actual}{unit}</p>
      )}
    </section>
  );
}
