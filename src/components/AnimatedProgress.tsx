import { useEffect, useRef, useState, CSSProperties } from 'react';

function useVisibleProgress<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}
export function AnimatedProgress({
  value,
  max,
  label,
  color,
}: {
  value: number;
  max: number;
  label: string;
  color?: string;
}) {
  const { ref, visible } = useVisibleProgress<HTMLDivElement>();
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      ref={ref}
      className="animated-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span
        className="animated-progress-fill"
        style={{ '--progress': visible ? percent / 100 : 0, background: color } as CSSProperties}
      />
    </div>
  );
}
export function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const { ref, visible } = useVisibleProgress<SVGSVGElement>();
  const amount = Math.min(100, Math.max(0, percent));
  return (
    <svg ref={ref} className="progress-donut" viewBox="0 0 220 220" role="img" aria-label={label}>
      <circle
        className="progress-donut-track"
        cx="110"
        cy="110"
        r="88"
        fill="none"
        strokeWidth="22"
      />
      <circle
        className="progress-donut-value"
        cx="110"
        cy="110"
        r="88"
        fill="none"
        strokeWidth="22"
        pathLength="100"
        strokeDasharray="100 100"
        style={{ strokeDashoffset: visible ? 100 - amount : 100 }}
        transform="rotate(-90 110 110)"
      />
      <text x="110" y="108" textAnchor="middle" className="progress-donut-percent">
        {amount.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%
      </text>
      <text x="110" y="135" textAnchor="middle" className="progress-donut-caption">
        達成
      </text>
    </svg>
  );
}
