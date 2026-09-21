import { useState } from 'react';
import { clock, defaultMeals, mealKeys, mealNames, minutes } from '../domain/model';
import { Field, Props } from './common';
import { NumericDraftProvider } from './NumberInput';
import { commuteScheduleErrors } from '../domain/commute';

/** Small, persisted questions shared by onboarding and the schedule editor. */
export function MealSetup({ state, update, onDone }: Props & { onDone: () => void }) {
  const [error, setError] = useState('');
  const index = Number(state.draft.mealStep ?? 0);
  const key = mealKeys[Math.min(2, Math.floor(index / 2))];
  const durationStep = index % 2 === 1;
  const meal = state.settings.meals?.[key] ?? defaultMeals[key];
  const change = (partial: Partial<typeof meal>) =>
    void update((s) => ({
      ...s,
      settings: { ...s.settings, meals: { ...s.settings.meals, [key]: { ...meal, ...partial } } },
    }));
  const timeDraft = state.draft.mealClock as { index: number; text: string } | undefined;
  const timeText = timeDraft?.index === index ? timeDraft.text : clock(meal.start);
  const next = () => {
    const chosen = durationStep ? meal : { ...meal, start: minutes(timeText) };
    if (
      !Number.isInteger(chosen.start) ||
      chosen.start < 0 ||
      chosen.start >= 1440 ||
      chosen.duration < 30 ||
      chosen.duration > 60
    ) {
      setError('開始時刻と30〜60分の長さを入力してください。');
      return;
    }
    const commute = state.settings.commute;
    // Validate the current meal after its duration, without blocking access to later meals.
    const conflicts =
      durationStep && (commute?.mode !== 'classDays' || commute.departureTimesConfirmed)
        ? commuteScheduleErrors({ ...state.settings, meals: { [key]: chosen } })
        : [];
    if (conflicts.length) {
      setError(conflicts.join(' '));
      return;
    }
    setError('');
    void update((s) => ({
      ...s,
      settings: { ...s.settings, meals: { ...s.settings.meals, [key]: chosen } },
      draft: { ...s.draft, mealClock: undefined, mealStep: index === 5 ? 0 : index + 1 },
    }))
      .then(() => {
        if (index === 5) onDone();
      })
      .catch((e) => setError(String(e)));
  };
  return (
    <NumericDraftProvider state={state} update={update} scope={`meals/${index}`}>
      <section className="question-card meal-questions" aria-label="食事時間の質問">
        <small>食事の質問 {index + 1} / 6 · 毎日に適用</small>
        <h2>
          {mealNames[key]}は{durationStep ? '何分確保しますか？' : '何時からですか？'}
        </h2>
        <p>{durationStep ? '30〜60分で指定してください。' : 'この時間は学習枠から除きます。'}</p>
        {durationStep ? (
          <>
            <div className="choices">
              {[30, 45, 60].map((n) => (
                <button
                  key={n}
                  className={meal.duration === n ? 'selected' : ''}
                  onClick={() => change({ duration: n })}
                >
                  {n}分
                </button>
              ))}
            </div>
            <Field label={`${mealNames[key]}の長さ（分）`}>
              <input
                type="number"
                min={30}
                max={60}
                value={meal.duration}
                onChange={(e) => change({ duration: Number(e.target.value) })}
              />
            </Field>
          </>
        ) : (
          <Field label={`${mealNames[key]}の開始時刻`}>
            <input
              type="time"
              value={timeText}
              onChange={(e) => {
                setError('');
                void update((s) => ({
                  ...s,
                  draft: { ...s.draft, mealClock: { index, text: e.target.value } },
                })).catch((e) => setError(String(e)));
              }}
            />
          </Field>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="question-footer">
          <button
            disabled={!index}
            onClick={() =>
              void update((s) => ({ ...s, draft: { ...s.draft, mealStep: index - 1 } }))
            }
          >
            前の質問
          </button>
          <button data-submit className="primary" onClick={() => next()}>
            {index === 5 ? '食事時間を保存して進む' : '次へ'}
          </button>
        </div>
      </section>
    </NumericDraftProvider>
  );
}
export function Meals({ state, update }: Props) {
  return (
    <section className="card">
      <h2>毎日の食事時間</h2>
      <p>朝・昼・夜を30〜60分ずつ確保し、学習可能枠から差し引きます。</p>
      <p className="hint">通学と重ならない時刻を設定してください。</p>
      {mealKeys.map((key) => (
        <p key={key}>
          {mealNames[key]}：
          {state.settings.meals?.[key]
            ? `${clock(state.settings.meals[key]!.start)}から${state.settings.meals[key]!.duration}分`
            : '未設定（計画から除外されません）'}
        </p>
      ))}
      {state.draft.mealOpen ? (
        <MealSetup
          state={state}
          update={update}
          onDone={() => void update((s) => ({ ...s, draft: { ...s.draft, mealOpen: false } }))}
        />
      ) : (
        <button
          onClick={() =>
            void update((s) => ({ ...s, draft: { ...s.draft, mealOpen: true, mealStep: 0 } }))
          }
        >
          食事時間を対話で設定する
        </button>
      )}
    </section>
  );
}
