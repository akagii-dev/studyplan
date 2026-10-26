import { ReactNode } from 'react';

/** A warning panel. It is always shown while its condition holds (hiding and folding were removed). */
export function Warning({
  title,
  children,
  className = '',
  label,
}: {
  id: string;
  title: string;
  /** Kept for callers; warnings are no longer hidden per version. */
  version?: unknown;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section className={`warning dismissible-warning my-5 border-2 border-warning-line bg-warning-bg shadow-[6px_6px_0_var(--accent)] px-6 py-5 text-warning wrap-anywhere [&_h3]:[color:inherit] [&_li]:text-[11px] [&_p]:text-[12px] [&_p]:[color:inherit] [&_small]:[color:inherit] ${className}`} aria-label={label ?? title}>
      <h3 className="m-0 font-[650]">{title}</h3>
      <div className="warning-content mt-3">{children}</div>
    </section>
  );
}
