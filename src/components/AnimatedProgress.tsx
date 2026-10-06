import { useEffect, useRef, useState, CSSProperties } from 'react';

function useVisibleProgress<T extends Element>(animate = true) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!animate) return;
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
  }, [animate]);
  return { ref, visible };
}
export function AnimatedProgress({
  value,
  max,
  label,
  color,
  animate = true,
}: {
  value: number;
  max: number;
  label: string;
  color?: string;
  animate?: boolean;
}) {
  const { ref, visible } = useVisibleProgress<HTMLDivElement>(animate);
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
        style={{ '--progress': visible || !animate ? percent / 100 : 0, background: color } as CSSProperties}
      />
    </div>
  );
}
export function ProgressRing({ percent, label, animate = true, showPercentage = true }: { percent: number; label: string; animate?: boolean; showPercentage?: boolean }) {
  const { ref, visible } = useVisibleProgress<SVGSVGElement>(animate);
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
        style={{ strokeDashoffset: visible || !animate ? 100 - amount : 100 }}
        transform="rotate(-90 110 110)"
      />
      {showPercentage && <><text x="110" y="108" textAnchor="middle" className="progress-donut-percent">
        {amount.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%
      </text>
      <text x="110" y="135" textAnchor="middle" className="progress-donut-caption">
        達成
      </text></>}
    </svg>
  );
}
