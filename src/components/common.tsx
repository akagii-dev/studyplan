import { ReactNode, ReactElement, cloneElement, isValidElement, useId } from 'react';
import { AppState } from '../domain/model';
import { NumberInput } from './NumberInput';
import type { InputHTMLAttributes } from 'react';
export type Update = (fn: (s: AppState) => AppState) => Promise<void>;
export interface Props {
  state: AppState;
  update: Update;
}
export function Field({
  label,
  children,
  hint,
  draftKey,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  draftKey?: string;
}) {
  const id = useId();
  const control =
    isValidElement(children) &&
    typeof children.type === 'string' &&
    ['input', 'select', 'textarea'].includes(children.type);
  return (
    <div className="field">
      {control ? <label htmlFor={id}>{label}</label> : <span>{label}</span>}
      {control ? (
        (children as ReactElement<InputHTMLAttributes<HTMLInputElement>>).props.type ===
        'number' ? (
          <NumberInput
            {...(children as ReactElement<InputHTMLAttributes<HTMLInputElement>>).props}
            id={id}
            fieldKey={draftKey ?? label}
          />
        ) : (
          cloneElement(children as ReactElement<{ id: string; 'aria-describedby'?: string }>, {
            id,
            'aria-describedby': hint ? `${id}-hint` : undefined,
          })
        )
      ) : (
        <div role="group" aria-label={label}>
          {children}
        </div>
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function duration(n: number) {
  return n >= 60
    ? `${Math.floor(n / 60)}時間${Math.round((n % 60) * 10) / 10 ? ` ${Math.round((n % 60) * 10) / 10}分` : ''}`
    : `${Math.round(n * 10) / 10}分`;
}
export const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
export function useDraft<T>(
  state: AppState,
  update: Update,
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const value = (state.draft[key] as T) ?? initial;
  return [
    value,
    (value: T) => {
      void update((s) => ({ ...s, draft: { ...s.draft, [key]: value } }));
    },
  ];
}
