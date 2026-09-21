import { useState } from 'react';
import { clock, minutes, OutsideTime } from '../domain/model';
import { outsideNames, outsideTimeError } from '../domain/dailyTimeDisplay';
import { Field, Props, useDraft } from './common';

export function OutsideTimeSetup({
  state,
  update,
  kind,
  onDone,
}: Props & {
  kind: keyof OutsideTime;
  onDone: () => void;
}) {
  const current = state.outsideTime?.[kind];
  const name = outsideNames[kind];
  const key = `outside-${kind}`;
  const [draft, set] = useDraft(state, update, key, {
    phase: 'ask' as 'ask' | 'start' | 'end',
    start: current ? clock(current.start) : '',
    end: current ? clock((current.start + current.duration) % 1440) : '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (part: Partial<typeof draft>) => {
    set({ ...draft, ...part });
    setError('');
  };
  const finish = async (remove = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const outsideTime = { ...state.outsideTime };
      if (remove) delete outsideTime[kind];
      else if (draft.phase === 'end') {
        if (![draft.start, draft.end].every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))
          throw new Error('開始・終了時刻を入力してください。');
        const start = minutes(draft.start),
          duration = (minutes(draft.end) - start + 1440) % 1440;
        if (!duration) throw new Error('開始と終了は異なる時刻にしてください。');
        outsideTime[kind] = { start, duration };
        const issue = outsideTimeError(outsideTime);
        if (issue) throw new Error(issue);
      }
      const value = outsideTime[kind];
      await update((s) => ({
        ...s,
        outsideTime,
        draft: {
          ...s.draft,
          [key]: {
            phase: 'ask',
            start: value ? clock(value.start) : '',
            end: value ? clock((value.start + value.duration) % 1440) : '',
          },
        },
      }));
      setError('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const title =
    draft.phase === 'ask'
      ? `${name}の時間を表示しますか？（任意）`
      : draft.phase === 'start'
        ? kind === 'sleep'
          ? '何時に寝ますか？'
          : '何時からお風呂に入りますか？'
        : kind === 'sleep'
          ? '何時に起きますか？'
          : '何時にお風呂から上がりますか？';
  return (
    <section className="outside-time-setup" aria-label={`${name}の質問`}>
      <h3>{title}</h3>
      <p>毎日の「学習対象外・未設定」だけを細分化します。学習計画には影響しません。</p>
      {draft.phase === 'ask' ? (
        <>
          {current && (
            <p>
              {clock(current.start)}〜{clock((current.start + current.duration) % 1440)}
            </p>
          )}
          <div className="actions">
            <button className="primary" onClick={() => change({ phase: 'start' })}>
              {current ? '時刻を変更する' : '設定する'}
            </button>
            <button disabled={busy} onClick={() => void finish()}>
              {current ? '今の設定で次へ' : 'あとで'}
            </button>
            {current && (
              <button disabled={busy} onClick={() => void finish(true)}>
                設定を解除して次へ
              </button>
            )}
          </div>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.phase === 'end') {
              void finish();
              return;
            }
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start)) {
              setError('開始時刻を入力してください。');
              return;
            }
            change({ phase: 'end' });
          }}
        >
          <Field label={`${name}の${draft.phase === 'start' ? '開始' : '終了'}時刻`}>
            <input
              type="time"
              value={draft[draft.phase]}
              onChange={(e) => change({ [draft.phase]: e.target.value })}
            />
          </Field>
          <div className="actions">
            <button
              type="button"
              onClick={() => change({ phase: draft.phase === 'end' ? 'start' : 'ask' })}
            >
              戻る
            </button>
            <button className="primary" type="submit" disabled={busy}>
              {draft.phase === 'end' ? '保存して次へ' : '次へ'}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
