import { CircleCheck } from 'lucide-react';
import { progressView } from '../domain/progressView';

const warning = 'quantity-warning font-bold text-error';

export function ProgressValue({ value, layout = 'inline-flex flex-wrap items-baseline gap-x-2.5 gap-y-1', className = '', strongClassName = '', tone = '' }: {
  value: ReturnType<typeof progressView> & { complete?: boolean };
  /** Display of the value; a calendar card shows it as one truncated line. */
  layout?: string;
  /** Layout from the screen that shows the value. */
  className?: string;
  /** Size and layout of the main quantity on that screen. */
  strongClassName?: string;
  /** Text color of the main quantity; a warning color takes priority. */
  tone?: string;
}) {
  const alert = value.warning && !value.hasReport;
  return (
    <span className={`progress-value ${layout} tabular-nums ${className}`}>
      <strong className={`${strongClassName} ${alert ? warning : tone}`.trim() || undefined}>
        {value.complete && (
          <CircleCheck aria-hidden="true" className="progress-check shrink-0 text-accent" size={16} strokeWidth={2.25} />
        )}
        {value.text}
      </strong>
      {value.supplement && <span className={value.warning ? warning : undefined}>{value.supplement}</span>}
    </span>
  );
}
