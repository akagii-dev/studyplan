import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { clock } from '../domain/model';
import { Field } from './common';

export function OutsideLabelEditor({
  start,
  end,
  title,
  save,
}: {
  start: number;
  end: number;
  title?: string;
  save: (title: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(title ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const finish = () => {
    setEditing(false);
    setError('');
    requestAnimationFrame(() => button.current?.focus());
  };
  const commit = async (value: string | null) => {
    if (busy) return;
    if (value !== null && (!value.trim() || value.trim().length > 120)) {
      setError('名前は1〜120文字で入力してください。');
      return;
    }
    setBusy(true);
    try {
      await save(value);
      finish();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const range = `${clock(start)}〜${clock(end)}`;
  return editing ? (
    <form
      className="outside-label-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void commit(text);
      }}
    >
      <Field label={`${range}の名前`}>
        <input autoFocus value={text} maxLength={120} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="actions">
        <button type="submit" disabled={busy}>
          保存
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            finish();
          }}
        >
          取消
        </button>
        {title && (
          <button type="button" disabled={busy} onClick={() => void commit(null)}>
            元の名前に戻す
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  ) : (
    <button
      ref={button}
      type="button"
      className="outside-label-edit"
      aria-label={`${range}の「${title ?? '学習対象外・未設定'}」の名前を編集`}
      title="名前を編集"
      onClick={() => {
        setText(title ?? '');
        setEditing(true);
      }}
    >
      <Pencil size={14} aria-hidden="true" />
    </button>
  );
}
