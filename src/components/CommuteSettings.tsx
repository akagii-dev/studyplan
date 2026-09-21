import { useState } from 'react';
import { Commute, Settings, clock, minutes, today, mealKeys, mealNames } from '../domain/model';
import { commuteErrors, commuteScheduleErrors, defaultCommute } from '../domain/commute';
import { proposeSettings } from '../domain/planning';
import { Field, Props, useDraft, weekdays } from './common';

export function CommuteEditor({
  state,
  update,
  value,
  draftKey,
  onSave,
  settings = state.settings,
}: Props & {
  value?: Commute;
  draftKey: string;
  onSave: (commute: Commute) => Promise<void>;
  settings?: Settings;
}) {
  const initial = value ?? defaultCommute();
  const [draft, set] = useDraft(state, update, `commute-${draftKey}`, {
    step: 0,
    flowVersion: 2,
    ...initial,
    outboundMinutes: String(initial.outboundMinutes),
    returnMinutes: String(initial.returnMinutes),
    outboundStart:
      initial.mode === 'classDays' && !initial.departureTimesConfirmed
        ? ''
        : clock(initial.outboundStart),
    returnStart:
      initial.mode === 'classDays' && !initial.departureTimesConfirmed
        ? ''
        : clock(initial.returnStart),
  });
  const step = draft.flowVersion === 2 ? draft.step : 0;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const patch = (changes: Partial<typeof draft>) => {
    set({ ...draft, step, flowVersion: 2, ...changes });
    setError('');
  };
  const parse = (): Commute => {
    if (
      ![draft.outboundMinutes, draft.returnMinutes].every((n) => /^\d+$/.test(n)) ||
      ![draft.outboundStart, draft.returnStart].every((t) => /^\d{2}:\d{2}$/.test(t))
    )
      throw new Error('時間を入力してください。');
    const { step: _, flowVersion: _flow, ...form } = draft;
    const result = {
      ...form,
      departureTimesConfirmed: true,
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
      if (draft.enabled && step < 5) {
        if (step === 0) {
          const errors = commuteErrors({
            ...defaultCommute(),
            ...draft,
            outboundMinutes: 0,
            returnMinutes: 0,
            outboundStart: 0,
            returnStart: 0,
          });
          if (errors.length) throw new Error(errors[0]);
        }
        if (step === 1 || step === 3) {
          const time = step === 1 ? draft.outboundStart : draft.returnStart;
          if (!/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(minutes(time)))
            throw new Error('出発時刻を入力してください。');
        }
        if (step === 2 || step === 4) {
          const length = step === 2 ? draft.outboundMinutes : draft.returnMinutes;
          if (!/^\d+$/.test(length) || Number(length) > 360)
            throw new Error('所要時間は0〜360分の整数で入力してください。');
        }
        patch({ step: step + 1 });
        return;
      }
      const c = draft.enabled ? parse() : { ...initial, enabled: false };
      const conflicts = commuteScheduleErrors({ ...settings, commute: c });
      if (conflicts.length) throw new Error(conflicts.join(' '));
      setBusy(true);
      await onSave(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
            '往路は何時に出発しますか？',
            '往路は何分かかりますか？',
            '復路は何時に出発しますか？',
            '復路は何分かかりますか？',
            '通学時間を確認してください',
          ][step]
        }
      </h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {step === 0 && (
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
        {(step === 1 || step === 3) && (
          <Field label={step === 1 ? '往路の出発時刻' : '復路の出発時刻'}>
            <input
              type="time"
              value={step === 1 ? draft.outboundStart : draft.returnStart}
              onChange={(e) =>
                patch(
                  step === 1 ? { outboundStart: e.target.value } : { returnStart: e.target.value },
                )
              }
            />
          </Field>
        )}
        {(step === 1 || step === 3) && (
          <p className="hint">
            {mealKeys
              .flatMap((key) => {
                const meal = settings.meals?.[key];
                return meal
                  ? [
                      `${mealNames[key]} ${clock(meal.start)}〜${clock((meal.start + meal.duration) % 1440)}`,
                    ]
                  : [];
              })
              .join(' ／ ')}
          </p>
        )}
        {(step === 2 || step === 4) && (
          <Field label={step === 2 ? '往路の所要時間（分）' : '復路の所要時間（分）'}>
            <input
              inputMode="numeric"
              value={step === 2 ? draft.outboundMinutes : draft.returnMinutes}
              onChange={(e) =>
                patch(
                  step === 2
                    ? { outboundMinutes: e.target.value }
                    : { returnMinutes: e.target.value },
                )
              }
            />
          </Field>
        )}
        {step === 5 && (
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
            <p>
              出発：往路 {draft.outboundStart} ／ 復路 {draft.returnStart}
            </p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {error && (
          <div className="actions">
            <button type="button" onClick={() => patch({ step: 1 })}>
              往路の出発時刻を修正
            </button>
            <button type="button" onClick={() => patch({ step: 3 })}>
              復路の出発時刻を修正
            </button>
          </div>
        )}
        <div className="actions">
          {step > 0 && (
            <button type="button" onClick={() => patch({ step: step - 1 })}>
              前の質問
            </button>
          )}
          <button className="primary" type="submit" disabled={busy}>
            {step === 5 || !draft.enabled ? 'この通学設定を使う' : '次へ'}
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
