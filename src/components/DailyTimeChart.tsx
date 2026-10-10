import { CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { DisplayTimeKind } from '../domain/dailyTimeDisplay';
import { duration } from './common';

/** Theme color of each kind in the ring, the legend and the 24-hour table. */
export const timeColor: Record<DisplayTimeKind, string> = {
  available: 'var(--accent)',
  rest: 'var(--art)',
  meal: 'var(--warning-border)',
  commute: 'var(--warning-border)',
  mealCommute: 'var(--warning-border)',
  busy: 'var(--busy-border)',
  outside: 'var(--border)',
  sleep: 'var(--soft)',
  bath: 'var(--soft)',
};
export const timeColorStyle = (kind: DisplayTimeKind) => ({ '--time-color': timeColor[kind] }) as CSSProperties;

export function DailyTimeChart({
  items,
  focus,
}: {
  items: { kind: DisplayTimeKind; value: number }[];
  focus: number;
}) {
  const chart = useRef<SVGSVGElement>(null);
  const metric = useRef<HTMLDListElement>(null);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    // At large text sizes, move the value below the ring instead of overlapping arcs.
    // Its width stays the same in either layout, so observing it cannot cause oscillation.
    const measure = () => {
      const circle = chart.current!.getBoundingClientRect();
      const label = metric.current!.getBoundingClientRect();
      setExpanded(Math.hypot(label.width, label.height) > circle.width * 0.58 - 4);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(chart.current!);
    observer.observe(metric.current!);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <div className="daily-time-visual grid w-[min(100%,260px)] place-items-center justify-self-center" data-expanded={expanded || undefined}>
      <svg
        ref={chart}
        className="daily-time-donut block h-auto w-full [grid-area:1/1]"
        viewBox="0 0 200 200"
        focusable="false"
        aria-hidden="true"
      >
        {items.map(({ kind, value }, index) => {
          if (!value) return null;
          const offset = items.slice(0, index).reduce((sum, item) => sum + item.value, 0);
          return (
            <circle
              key={kind}
              className={`time-${kind} bg-[var(--time-color)] [fill:none] [stroke:var(--time-color)] [stroke-linecap:butt] [stroke-width:32]`}
              style={timeColorStyle(kind)}
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
      <dl ref={metric} className={`daily-time-metric m-0 min-w-0 max-w-[56%] text-center ${expanded ? '[grid-area:2/1]' : '[grid-area:1/1]'}`}>
        <div>
          <dt className="text-[14px] font-semibold">学習可能</dt>
          <dd className="m-0 text-[22px] leading-[1.4] font-bold text-accent tabular-nums">{duration(focus)}</dd>
        </div>
      </dl>
    </div>
  );
}
