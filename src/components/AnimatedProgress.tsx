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
      className="mx-0 my-3 h-3 w-full overflow-hidden bg-soft [clip-path:polygon(6px_0,100%_0,calc(100%-6px)_100%,0_100%)]"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span
        className="block h-full w-full origin-left bg-accent [transform:scaleX(var(--progress,0))] [transition:transform_700ms_cubic-bezier(0.2,0.7,0.25,1)] motion-reduce:[transition:none]"
        style={{ '--progress': visible || !animate ? percent / 100 : 0, background: color } as CSSProperties}
      />
    </div>
  );
}
