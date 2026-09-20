import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  ReactNode,
  InputHTMLAttributes,
  ChangeEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { AppState } from '../domain/model';
import { parseNumberInput } from '../domain/numeric';
import type { Update } from './common';

type Edit = { text: string; base: string };
type NumericContext = {
  scope: string;
  edits: Record<string, Edit>;
  write: (key: string, edit?: Edit) => void;
  pending: Map<string, () => boolean>;
};
const Context = createContext<NumericContext | null>(null);
export function NumericDraftProvider({
  state,
  update,
  scope,
  children,
}: {
  state: AppState;
  update: Update;
  scope: string;
  children: ReactNode;
}) {
  const pending = useRef(new Map<string, () => boolean>());
  const replaying = useRef(false);
  const edits = (state.draft.numberEdits ?? {}) as Record<string, Edit>;
  const write = (key: string, edit?: Edit) => {
    void update((s) => {
      const values = { ...((s.draft.numberEdits as Record<string, Edit>) ?? {}) };
      if (edit) values[key] = edit;
      else delete values[key];
      return { ...s, draft: { ...s.draft, numberEdits: values } };
    }).catch(() => {});
  };
  return (
    <Context.Provider value={{ scope, edits, write, pending: pending.current }}>
      <div
        data-numeric-scope
        onClickCapture={(e) => {
          const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
            'button[data-submit]',
          );
          if (
            !button ||
            button.closest('[data-numeric-scope]') !== e.currentTarget ||
            replaying.current ||
            !pending.current.size
          )
            return;
          e.preventDefault();
          e.stopPropagation();
          let valid = true;
          // Apply each input synchronously before invoking the freshly rendered submit handler.
          for (const key of [...pending.current.keys()])
            flushSync(() => {
              if (pending.current.get(key)?.() === false) valid = false;
            });
          if (valid) {
            replaying.current = true;
            try {
              button.click();
            } finally {
              replaying.current = false;
            }
          }
        }}
        onKeyDown={(e) => {
          if (
            e.key !== 'Enter' ||
            e.repeat ||
            e.nativeEvent.isComposing ||
            e.nativeEvent.keyCode === 229
          )
            return;
          const target = e.target as HTMLElement;
          if (
            !target.matches('input') ||
            target.closest('[data-numeric-scope]') !== e.currentTarget
          )
            return;
          const next = target
            .closest('.question-card')
            ?.querySelector<HTMLButtonElement>('.question-footer button[data-submit]');
          if (next) {
            e.preventDefault();
            e.stopPropagation();
            next.click();
          }
        }}
      >
        {children}
      </div>
    </Context.Provider>
  );
}
export function NumberInput({
  fieldKey,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { fieldKey: string }) {
  const ctx = useContext(Context);
  const [fallback, setFallback] = useState<Edit>();
  const [error, setError] = useState('');
  const key = `${ctx?.scope ?? ''}/${fieldKey}`;
  const base = String(props.value ?? '');
  const stored = ctx?.edits[key] ?? fallback;
  const edit = stored?.base === base ? stored : undefined;
  const text = edit?.text ?? base;
  const write = (value?: Edit) => {
    if (ctx) ctx.write(key, value);
    else setFallback(value);
  };
  const commit = () => {
    try {
      const number = parseNumberInput(text, props.min, props.max, props.step);
      setError('');
      props.onChange?.({
        target: { value: String(number) },
        currentTarget: { value: String(number) },
      } as ChangeEvent<HTMLInputElement>);
      write();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };
  useLayoutEffect(() => setError(''), [key, base]);
  useLayoutEffect(() => {
    if (edit) ctx?.pending.set(key, commit);
    else ctx?.pending.delete(key);
    return () => {
      ctx?.pending.delete(key);
    };
  });
  return (
    <div className="number-input">
      <input
        {...props}
        type="text"
        inputMode={props.step && props.step !== '1' && props.step !== 1 ? 'decimal' : 'numeric'}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setError('');
          write({ text: e.target.value, base });
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
            return;
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat) return;
          const card = e.currentTarget.closest('.question-card');
          let valid = false;
          flushSync(() => {
            valid = commit();
          });
          if (valid)
            card?.querySelector<HTMLButtonElement>('.question-footer button[data-submit]')?.click();
        }}
      />
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
      {edit && (
        <button
          className="text-button small"
          type="button"
          onClick={() => {
            setError('');
            write();
          }}
        >
          入力を戻す
        </button>
      )}
    </div>
  );
}
