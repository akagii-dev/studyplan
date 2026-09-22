import type { Settings } from './model';

export const PLAN_CALCULATION_VERSION = 11;
export const DEFAULT_MINIMUM_SESSION_MINUTES = 10;
export const DEFAULT_PREFERRED_SESSION_MINUTES = 30;
export function sessionPolicy(settings: Settings) {
  return {
    minimum: settings.minimumSessionMinutes ?? DEFAULT_MINIMUM_SESSION_MINUTES,
    preferred: settings.preferredSessionMinutes ?? DEFAULT_PREFERRED_SESSION_MINUTES,
  };
}

/** Count whole units by duration. Short completion remainders are handled after normal slots. */
export function sessionUnitCount(
  left: number,
  minutesPerUnit: number,
  availableMinutes: number,
  quotaMinutes: number,
  policy: ReturnType<typeof sessionPolicy>,
) {
  const eps = 1e-7;
  const fits = Math.floor((availableMinutes + eps) / minutesPerUnit);
  const minimumUnits = Math.ceil((policy.minimum - eps) / minutesPerUnit);
  if (Math.min(left, fits) < minimumUnits) return 0;
  const preferredUnits = Math.floor(
    (Math.max(policy.preferred, quotaMinutes) + eps) / minutesPerUnit,
  );
  let count = Math.min(left, fits, Math.max(minimumUnits, preferredUnits));
  if ((left - count) * minutesPerUnit < policy.minimum - eps && fits >= left) count = left;
  return count;
}
