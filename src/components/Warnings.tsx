import { createContext, ReactNode, useContext, useState } from 'react';
import { Props } from './common';

const Context = createContext<Props | null>(null);
export function WarningsProvider({ children, ...props }: Props & { children: ReactNode }) {
  return <Context.Provider value={props}>{children}</Context.Provider>;
}
export function warningVersion(value: unknown) {
  const text = JSON.stringify(value) ?? '';
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}
export function Warning({
  id,
  title,
  version = title,
  children,
  className = '',
  label,
}: {
  id: string;
  title: string;
  version?: unknown;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const context = useContext(Context);
  const [error, setError] = useState('');
  const stamp = warningVersion(version);
  if (context?.state.ignoredWarnings?.[id]?.version === stamp) return null;
  const expanded = context?.state.warningExpanded?.[id] ?? true;
  return (
    <section className={`warning dismissible-warning ${className}`} aria-label={label ?? title}>
      <div className="warning-toolbar">
        <button
          className="warning-toggle"
          aria-expanded={expanded}
          onClick={() => {
            if (context)
              void context
                .update((s) => ({
                  ...s,
                  warningExpanded: { ...s.warningExpanded, [id]: !expanded },
                }))
                .catch((e) => setError(String(e)));
          }}
        >
          {expanded ? '▾' : '▸'} {title}
        </button>
        {context && (
          <button
            className="warning-ignore"
            onClick={() => {
              void context
                .update((s) => ({
                  ...s,
                  ignoredWarnings: {
                    ...s.ignoredWarnings,
                    [id]: { title, version: stamp, ignoredAt: new Date().toISOString() },
                  },
                }))
                .catch((e) => setError(String(e)));
            }}
          >
            無視する
          </button>
        )}
      </div>
      {expanded && <div className="warning-content">{children}</div>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function WarningSettings({ state, update }: Props) {
  const [error, setError] = useState('');
  const entries = Object.entries(state.ignoredWarnings ?? {});
  const restore = (id?: string) =>
    void update((s) => ({
      ...s,
      ignoredWarnings: id
        ? Object.fromEntries(Object.entries(s.ignoredWarnings ?? {}).filter(([key]) => key !== id))
        : {},
    })).catch((e) => setError(String(e)));
  return (
    <section className="card">
      <h2>無視した警告</h2>
      <p>再表示すると、該当する画面で現在も必要な警告が表示されます。</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!entries.length ? (
        <p>無視した警告はありません。</p>
      ) : (
        <>
          <button onClick={() => restore()}>すべて再表示</button>
          <ul className="ignored-warnings">
            {entries.map(([id, entry]) => (
              <li key={id}>
                <div>
                  <b>{entry.title}</b>
                  <small className="block">
                    {new Date(entry.ignoredAt).toLocaleString('ja-JP')}
                  </small>
                </div>
                <button onClick={() => restore(id)} aria-label={`${entry.title}を再表示`}>
                  再表示
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
