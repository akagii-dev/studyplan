import { useLayoutEffect, useRef, useState } from 'react';
import { DisplayTimeKind } from '../domain/dailyTimeDisplay';
import { duration } from './common';

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
    <div className="daily-time-visual" data-expanded={expanded || undefined}>
      <svg
        ref={chart}
        className="daily-time-donut"
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
      <dl ref={metric} className="daily-time-metric">
        <div>
          <dt>学習可能</dt>
          <dd>{duration(focus)}</dd>
        </div>
      </dl>
    </div>
  );
}
