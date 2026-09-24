import { progressView } from '../domain/progressView';

export function ProgressValue({ value }: { value: ReturnType<typeof progressView> }) {
  return (
    <span className="progress-value">
      <strong className={value.warning && !value.hasReport ? 'quantity-warning' : undefined}>
        {value.text}
      </strong>
      {value.supplement && (
        <span className={value.warning ? 'quantity-warning' : undefined}>{value.supplement}</span>
      )}
    </span>
  );
}
