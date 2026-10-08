import { CircleCheck } from 'lucide-react';
import { progressView } from '../domain/progressView';

export function ProgressValue({ value }: { value: ReturnType<typeof progressView> & { complete?: boolean } }) {
  return (
    <span className="progress-value">
      <strong className={value.warning && !value.hasReport ? 'quantity-warning' : undefined}>
        {value.complete && <CircleCheck aria-hidden="true" className="progress-check" size={16} strokeWidth={2.25} />}
        {value.text}
      </strong>
      {value.supplement && (
        <span className={value.warning ? 'quantity-warning' : undefined}>{value.supplement}</span>
      )}
    </span>
  );
}
