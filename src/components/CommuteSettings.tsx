import { useState } from 'react';
import { Commute, clock, minutes, today } from '../domain/model';
import { commuteErrors, defaultCommute } from '../domain/commute';
import { proposeSettings } from '../domain/planner';
import { Field, Props, useDraft, weekdays } from './common';

export function CommuteEditor({
  state,
  update,
  value,
  draftKey,
  onSave,
}: Props & {
  value?: Commute;
  draftKey: string;
  onSave: (commute: Commute) => Promise<void>;
}) {
  const initial = value ?? defaultCommute();
  const [draft, set] = useDraft(state, update, `commute-${draftKey}`, {
    step: 0,
    ...initial,
    outboundMinutes: String(initial.outboundMinutes),
    returnMinutes: String(initial.returnMinutes),
    outboundStart: clock(initial.outboundStart),
    returnStart: clock(initial.returnStart),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const patch = (changes: Partial<typeof draft>) => {
    set({ ...draft, ...changes });
    setError('');
  };
  const parse = (): Commute => {
    if (
      ![draft.outboundMinutes, draft.returnMinutes].every((n) => /^\d+$/.test(n)) ||
      ![draft.outboundStart, draft.returnStart].every((t) => /^\d{2}:\d{2}$/.test(t))
    )
      throw new Error('時間を入力してください。');
    const { step: _, ...form } = draft;
    const result = {
      ...form,
      outboundMinutes: Number(form.outboundMinutes),
      returnMinutes: Number(form.returnMinutes),
      outboundStart: minutes(form.outboundStart),
      returnStart: minutes(form.returnStart),
    };
    const errors = commuteErrors(result);
    if (errors.length) throw new Error(errors[0]);
    return result;
  };
  const submit = async () => {
    if (busy) return;
    try {
      const c = parse();
      if (draft.step < 3 && draft.enabled) {
        patch({ step: draft.step + 1 });
        return;
      }
      setBusy(true);
      await onSave(c);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card commute-editor" aria-label="通学時間の設定">
      <h2>
        {
          [
            '通学はいつありますか？',
            '往路は何分かかりますか？',
            '復路は何分かかりますか？',
            '通学時間を確認してください',
          ][draft.step]
        }
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {draft.step === 0 && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => patch({ enabled: e.target.checked })}
              />
              通学時間を確保する
            </label>
            <Field label="適用する日">
              <select
                value={draft.mode}
                onChange={(e) => patch({ mode: e.target.value as Commute['mode'] })}
              >
                <option value="classDays">授業がある日のみ</option>
                <option value="weekdays">曜日を指定</option>
              </select>
            </Field>
            <div className="two">
              <Field label="通学の適用開始日">
                <input
                  type="date"
                  value={draft.from}
                  onChange={(e) => patch({ from: e.target.value })}
                />
              </Field>
              <Field label="通学の適用終了日">
                <input
                  type="date"
                  value={draft.to}
                  onChange={(e) => patch({ to: e.target.value })}
                />
              </Field>
            </div>
            {draft.mode === 'weekdays' && (
              <div className="choices" aria-label="通学する曜日">
                {weekdays.map((day, i) => (
                  <button
                    type="button"
                    key={i}
                    aria-pressed={draft.weekdays.includes(i)}
                    className={draft.weekdays.includes(i) ? 'selected' : ''}
                    onClick={() =>
                      patch({
                        weekdays: draft.weekdays.includes(i)
                          ? draft.weekdays.filter((d) => d !== i)
                          : [...draft.weekdays, i],
                      })
                    }
                  >
                    {day}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {(draft.step === 1 || draft.step === 2) && (
          <>
            <Field label={draft.step === 1 ? '往路の所要時間（分）' : '復路の所要時間（分）'}>
              <input
                inputMode="numeric"
                value={draft.step === 1 ? draft.outboundMinutes : draft.returnMinutes}
                onChange={(e) =>
                  patch(
                    draft.step === 1
                      ? { outboundMinutes: e.target.value }
                      : { returnMinutes: e.target.value },
                  )
                }
              />
            </Field>
            {draft.mode === 'classDays' ? (
              <p>
                {draft.step === 1
                  ? 'その日の最初の授業の直前に確保します。'
                  : 'その日の最後の授業の直後に確保します。'}
              </p>
            ) : (
              <Field label={draft.step === 1 ? '往路の出発時刻' : '復路の出発時刻'}>
                <input
                  type="time"
                  value={draft.step === 1 ? draft.outboundStart : draft.returnStart}
                  onChange={(e) =>
                    patch(
                      draft.step === 1
                        ? { outboundStart: e.target.value }
                        : { returnStart: e.target.value },
                    )
                  }
                />
              </Field>
            )}
          </>
        )}
        {draft.step === 3 && (
          <>
            <p>
              {draft.from}〜{draft.to} ／{' '}
              {draft.mode === 'classDays'
                ? '授業がある日のみ'
                : draft.weekdays.map((d) => weekdays[d]).join('・')}
            </p>
            <p>
              往路 {draft.outboundMinutes}分 ／ 復路 {draft.returnMinutes}分
            </p>
            {draft.mode === 'weekdays' && (
              <p>
                出発：往路 {draft.outboundStart} ／ 復路 {draft.returnStart}
              </p>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          {draft.step > 0 && (
            <button type="button" onClick={() => patch({ step: draft.step - 1 })}>
              前の質問
            </button>
          )}
          <button className="primary" type="submit" disabled={busy}>
            {draft.step === 3 || !draft.enabled ? 'この通学設定を使う' : '次へ'}
          </button>
        </div>
      </form>
    </section>
  );
}
export function CommuteSettings({ state, update, onReview }: Props & { onReview: () => void }) {
  const [message, setMessage] = useState('');
  return (
    <>
      <p>
        {state.plan
          ? '変更は計画案を承認すると反映されます。'
          : '通学時間を保存し、最初の計画に反映します。'}
      </p>
      {message && <p role="status">{message}</p>}
      <CommuteEditor
        state={state}
        update={update}
        value={state.settings.commute}
        draftKey="settings"
        onSave={async (commute) => {
          await update((s) => {
            if (s.proposal)
              throw new Error('承認待ちの計画案があります。先に承認または破棄してください。');
            const settings = { ...s.settings, commute };
            const next = s.plan ? proposeSettings(s, settings, today()) : { ...s, settings };
            return { ...next, draft: { ...next.draft, 'commute-settings': undefined } };
          });
          if (state.plan) onReview();
          else setMessage('通学時間を保存しました。');
        }}
      />
    </>
  );
}
