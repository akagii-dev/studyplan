import { Warning } from './Warnings';
import { useState } from 'react';
import { CommuteEditor } from './CommuteSettings';
import {
  Settings,
  addDays,
  clock,
  minutes,
  today,
  uid,
  mealKeys,
  mealNames,
  defaultMeals,
} from '../domain/model';
import {
  beginRevision,
  RevisionDraft,
  RevisionTopic,
  revisionIsStale,
  settingChanges,
  validateRevisedSettings,
  minimumRetainedRounds,
} from '../domain/revision';
import { proposeSettings, validateSettings } from '../domain/planning';
import { Field, Props, weekdays } from './common';
import { NumericDraftProvider } from './NumberInput';
import { TimetablePreview } from './TimetablePreview';
import { sessionPolicy } from '../domain/sessionPolicy';
import { StudyCoverageNotice } from './SetupImpact';
import { beginStudyCoverageRepair, beginStudyGoalReview } from '../domain/repairPlan';

const topics: [RevisionTopic, string][] = [
  ['exam', '試験・目標日'],
  ['material', '教材・問題数・推定時間'],
  ['study', '勉強できる時間'],
  ['class', '大学の授業'],
  ['busy', '授業以外の定期予定'],
  ['exception', '特定の日の予定'],
  ['meal', '朝・昼・夜の食事時間'],
  ['commute', '通学時間'],
  ['focus', '連続時間・休憩・余裕率'],
];
type Question = {
  label: string;
  value: string | number;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: [string, string][];
  set: (s: Settings, value: string) => void;
};
export function GuidedRevision({ state, update, onClose }: Props & { onClose: () => void }) {
  const d = state.draft.revision as RevisionDraft;
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [remove, setRemove] = useState(false);
  const patch = (changes: Partial<RevisionDraft>) =>
    void update((s) => ({
      ...s,
      draft: { ...s.draft, revision: { ...(s.draft.revision as RevisionDraft), ...changes } },
    })).catch((e) => setError(String(e)));
  const change = (mutate: (s: Settings) => void) => {
    const settings = structuredClone(d.settings);
    mutate(settings);
    patch({ settings });
    setError('');
  };
  const questions: Question[] = [];
  const add = (q: Question) => questions.push(q);
  const itemList =
    d.topic === 'exam'
      ? d.settings.exams
      : d.topic === 'material'
        ? d.settings.materials
        : d.topic === 'exception'
          ? d.settings.exceptions
          : d.settings.windows.filter((w) => w.kind === d.topic);
  const item = itemList.find((x) => x.id === d.itemId);
  if (d.topic === 'focus') {
    for (const [key, label, min, max] of [
      ['block', '最長で何分続けて勉強できますか？', 1, 1440],
      ['rest', '学習ブロックの間に何分休みますか？', 1, 1440],
      ['classTransition', '授業の前後に何分空けますか？', 0, 180],
    ] as const)
      add({
        label,
        value: d.settings[key] ?? 0,
        type: 'number',
        min,
        max,
        set: (s, v) => {
          s[key] = Number(v);
        },
      });
    add({
      label: '週全体で余裕を何％残しますか？',

      value: Math.round(d.settings.buffer * 100),
      type: 'number',
      min: 0,
      max: 99,
      set: (s, v) => {
        s.buffer = Number(v) / 100;
      },
    });
    add({
      label: '予定の下限は何分にしますか？',
      value: sessionPolicy(d.settings).minimum,
      type: 'number',
      min: 1,
      max: 1440,
      set: (s, v) => {
        s.minimumSessionMinutes = Number(v);
      },
    });
    add({
      label: 'なるべく何分のまとまりで学びますか？',
      value: sessionPolicy(d.settings).preferred,
      type: 'number',
      min: sessionPolicy(d.settings).minimum,
      max: 1440,
      set: (s, v) => {
        s.preferredSessionMinutes = Number(v);
      },
    });
  } else if (d.topic === 'meal') {
    for (const key of mealKeys) {
      const meal = d.settings.meals?.[key] ?? defaultMeals[key];
      add({
        label: mealNames[key] + 'は何時からですか？',

        value: clock(meal.start),
        type: 'time',
        set: (s, v) => {
          s.meals = { ...s.meals, [key]: { ...meal, start: minutes(v) } };
        },
      });
      add({
        label: mealNames[key] + 'は何分確保しますか？',

        value: meal.duration,
        type: 'number',
        min: 30,
        max: 60,
        set: (s, v) => {
          s.meals = { ...s.meals, [key]: { ...meal, duration: Number(v) } };
        },
      });
    }
  } else if (d.topic === 'exam' && item) {
    const e = d.settings.exams.find((x) => x.id === d.itemId)!;
    const set = (key: keyof typeof e) => (s: Settings, v: string) => {
      const target = s.exams.find((x) => x.id === e.id)!;
      Object.assign(target, { [key]: ['priority', 'reviewDays'].includes(key) ? Number(v) : v });
    };
    add({
      label: '試験名はこのままですか？',

      value: e.name,
      set: set('name'),
    });
    add({
      label: '目標日はいつですか？',

      value: e.target,
      type: 'date',
      set: set('target'),
    });
    add({
      label: 'いつから計画に入れますか？',

      value: e.start,
      type: 'date',
      set: set('start'),
    });
    add({
      label: '優先度を変えますか？',

      value: e.priority,
      choices: [
        ['1', '低め'],
        ['2', '標準'],
        ['3', '高め'],
      ],
      set: set('priority'),
    });
    add({
      label: '別枠の復習を何日確保しますか？',

      value: e.reviewDays,
      type: 'number',
      min: 0,
      max: 3660,
      set: set('reviewDays'),
    });
    add({
      label: '試験の表示色を変えますか？',

      value: e.color,
      type: 'color',
      set: set('color'),
    });
  } else if (d.topic === 'material' && item) {
    const m = d.settings.materials.find((x) => x.id === d.itemId)!;
    add({
      label: '教材名はこのままですか？',

      value: m.name,
      set: (s, v) => {
        s.materials.find((x) => x.id === m.id)!.name = v;
      },
    });
    add({
      label: '教材は全部で何問ですか？',

      value: m.total,
      type: 'number',
      min: 1,
      max: 1000000000,
      set: (s, v) => {
        s.materials.find((x) => x.id === m.id)!.total = Number(v);
      },
    });
    add({
      label: '何周取り組みますか？',

      value: m.rounds.length,
      type: 'number',
      min: minimumRetainedRounds(state, m.id),
      max: 20,
      set: (s, v) => {
        const target = s.materials.find((x) => x.id === m.id)!;
        target.rounds = Array.from(
          { length: Number(v) },
          (_, i) => target.rounds[i] ?? { completed: 0, minutes: target.rounds[0].minutes },
        );
      },
    });
    m.rounds.forEach((r, i) =>
      add({
        label: `${i + 1}周目は1問に何分かかりそうですか？`,

        value: r.minutes,
        type: 'number',
        min: 0.1,
        step: 0.1,
        set: (s, v) => {
          s.materials.find((x) => x.id === m.id)!.rounds[i].minutes = Number(v);
        },
      }),
    );
    add({
      label: 'この教材は何番目に取り組みますか？',

      value: m.order,
      type: 'number',
      min: 1,
      set: (s, v) => {
        s.materials.find((x) => x.id === m.id)!.order = Number(v);
      },
    });
  } else if (d.topic === 'exception' && item) {
    const e = d.settings.exceptions.find((x) => x.id === d.itemId)!;
    const set = (key: keyof typeof e) => (s: Settings, v: string) =>
      Object.assign(
        s.exceptions.find((x) => x.id === e.id)!,
        { [key]: key === 'start' || key === 'end' ? minutes(v) : v },
      );
    add({
      label: '何の予定ですか？',

      value: e.name,
      set: set('name'),
    });
    add({
      label: '予定は何日ですか？',

      value: e.date,
      type: 'date',
      set: set('date'),
    });
    add({
      label: '何時から勉強できませんか？',

      value: clock(e.start),
      type: 'time',
      set: set('start'),
    });
    add({
      label: '何時まで勉強できませんか？',

      value: clock(e.end),
      type: 'end-time',
      set: set('end'),
    });
  } else if (item) {
    const w = d.settings.windows.find((x) => x.id === d.itemId)!;
    const study = w.kind === 'study';
    const set = (key: keyof typeof w) => (s: Settings, v: string) =>
      Object.assign(
        s.windows.find((x) => x.id === w.id)!,
        { [key]: key === 'start' || key === 'end' ? minutes(v) : v },
      );
    add({
      label: study
        ? 'この学習枠に名前を付けますか？'
        : w.kind === 'class'
          ? '授業名（任意）'
          : '何の予定ですか？',

      value: w.name,
      set: set('name'),
    });
    add({
      label: 'この時間帯はいつから使いますか？',

      value: w.from,
      type: 'date',
      set: set('from'),
    });
    add({
      label: 'この時間帯はいつまで使いますか？',

      value: w.to,
      type: 'date',
      set: set('to'),
    });
    add({
      label: study ? '何曜日に勉強できますか？' : '何曜日に授業・予定がありますか？',

      value: w.weekdays.join(','),
      type: 'weekdays',
      set: () => {},
    });
    add({
      label: study ? '何時から勉強できる状態ですか？' : '授業・予定は何時に始まりますか？',

      value: clock(w.start),
      type: 'time',
      set: set('start'),
    });
    add({
      label: study ? '何時までなら勉強できますか？' : '授業・予定は何時に終わりますか？',

      value: clock(w.end),
      type: 'end-time',
      set: set('end'),
    });
  }
  const q = questions[d.index];
  const stale = revisionIsStale(d, state.settings);
  const review = () => {
    try {
      const errors = validateSettings(d.settings);
      if (errors.length) throw new Error(errors.join(' '));
      validateRevisedSettings(state, d.settings);
      setError('');
      patch({ stage: 'review' });
    } catch (e) {
      setError(String(e));
    }
  };
  const next = () => {
    if (
      q &&
      !(d.topic === 'class' && d.index === 0) &&
      (String(q.value) === '' || (q.type === 'weekdays' && !String(q.value)))
    ) {
      setError('入力・選択してください。');
      return;
    }
    if (
      q &&
      ['time', 'end-time'].includes(q.type ?? '') &&
      (!Number.isFinite(minutes(String(q.value))) ||
        minutes(String(q.value)) < 0 ||
        minutes(String(q.value)) > 1440)
    ) {
      setError('時刻を入力してください。');
      return;
    }
    if (d.topic === 'meal' && q) change((s) => q.set(s, String(q.value)));
    setError('');
    patch(d.index + 1 < questions.length ? { index: d.index + 1 } : { stage: 'choose', index: 0 });
  };
  const addItem = () => {
    const settings = structuredClone(d.settings),
      id = uid();
    if (d.topic === 'exception')
      settings.exceptions.push({
        id,
        name: '勉強できない予定',
        date: today(),
        start: 0,
        end: 1440,
      });
    else if (['study', 'class', 'busy'].includes(d.topic))
      settings.windows.push({
        id,
        name: d.topic === 'study' ? '学習可能枠' : d.topic === 'class' ? '大学の授業' : '定期予定',
        kind: d.topic as 'study' | 'class' | 'busy',
        from: today(),
        to: addDays(today(), 90),
        weekdays: [1, 2, 3, 4, 5],
        start: d.topic === 'class' ? 540 : 1080,
        end: d.topic === 'class' ? 640 : 1260,
      });
    patch({ settings, itemId: id, index: 0, stage: 'question' });
  };
  const apply = async () => {
    try {
      await update((s) => {
        const draft = s.draft.revision as RevisionDraft;
        if (revisionIsStale(draft, s.settings))
          throw new Error('編集中に元の設定が変わりました。現在の設定からやり直してください。');
        return proposeSettings(s, draft.settings, today());
      });
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <NumericDraftProvider
      state={state}
      update={update}
      scope={`revision/${d.id}/${d.topic}/${d.itemId}/${d.index}`}
    >
      <section className="card question-card revision-wizard" aria-label="対話式の再計画">
        <div className="eyebrow">今の設定を引き継いで、必要なところだけ</div>
        <p>変更は、最後に承認すると反映されます。</p>
        {d.stage !== 'review' && !(d.stage === 'question' && d.topic === 'commute') && (
          <div className="wizard-skip">
            <button data-submit disabled={stale} onClick={review}>
              残りを一括スキップして確認
            </button>
          </div>
        )}
        {stale && (
          <Warning
            id="guidedrevision-0"
            title="下書きの元の設定が変更されています"
            version={[d.id, state.settings]}
          >
            別の画面で設定が変更されています。この下書きの承認はできません。
            <button onClick={() => void update(beginRevision)}>現在の設定からやり直す</button>
          </Warning>
        )}
        {d.stage === 'choose' && (
          <>
            <h2>どこを見直しますか？</h2>
            <div className="wizard-options">
              {topics.map(([topic, label]) => (
                <button
                  key={topic}
                  onClick={() =>
                    patch({
                      topic,
                      stage: ['focus', 'meal', 'commute'].includes(topic) ? 'question' : 'item',
                      index: 0,
                      itemId: '',
                    })
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <button data-submit className="primary" onClick={review}>
              変更内容を確認する
            </button>
          </>
        )}
        {d.stage === 'item' && (
          <>
            <h2>どの{topics.find(([t]) => t === d.topic)?.[1]}を見直しますか？</h2>
            <div className="wizard-options">
              {itemList.map((x) => (
                <button
                  key={x.id}
                  onClick={() => patch({ stage: 'question', itemId: x.id, index: 0 })}
                >
                  {x.name || '大学の授業（名称なし）'}
                  {'from' in x && (
                    <small>
                      {x.from}〜{x.to} ／ {x.weekdays.map((day) => weekdays[day]).join('・')}{' '}
                      {clock(x.start)}〜{clock(x.end)}
                    </small>
                  )}
                  {'date' in x && <small>{x.date}</small>}
                </button>
              ))}
            </div>
            {!itemList.length && <p>登録済みの項目はありません。</p>}
            {['study', 'class', 'busy', 'exception'].includes(d.topic) && (
              <button onClick={addItem}>新しい時間枠・予定を追加する</button>
            )}
            <button onClick={() => patch({ stage: 'choose' })}>見直す項目に戻る</button>
          </>
        )}
        {d.stage === 'question' && d.topic === 'commute' && (
          <CommuteEditor
            state={state}
            update={update}
            value={d.settings.commute}
            draftKey={d.id}
            onSkipRemaining={async (commute) => {
              await update((s) => {
                const current = s.draft.revision as RevisionDraft;
                const settings = { ...current.settings, commute };
                const errors = validateSettings(settings);
                if (errors.length) throw new Error(errors.join(' '));
                validateRevisedSettings(s, settings);
                return {
                  ...s,
                  draft: {
                    ...s.draft,
                    [`commute-${d.id}`]: undefined,
                    revision: { ...current, settings, stage: 'review' },
                  },
                };
              });
            }}
            onSave={async (commute) => {
              await update((s) => {
                const current = s.draft.revision as RevisionDraft;
                return {
                  ...s,
                  draft: {
                    ...s.draft,
                    [`commute-${d.id}`]: undefined,
                    revision: {
                      ...current,
                      settings: { ...current.settings, commute },
                      stage: 'choose',
                    },
                  },
                };
              });
            }}
          />
        )}
        {d.stage === 'question' && q && (
          <>
            <h2>{q.label}</h2>
            <small>
              {item?.name ?? '全試験で共通の設定'} · {d.index + 1} / {questions.length}
            </small>
            {q.type === 'weekdays' ? (
              <div className="choices">
                {weekdays.map((name, day) => {
                  const selected = d.settings.windows
                    .find((w) => w.id === d.itemId)!
                    .weekdays.includes(day);
                  return (
                    <button
                      key={day}
                      aria-pressed={selected}
                      className={selected ? 'selected' : ''}
                      onClick={() =>
                        change((s) => {
                          const w = s.windows.find((w) => w.id === d.itemId)!;
                          w.weekdays = selected
                            ? w.weekdays.filter((x) => x !== day)
                            : [...w.weekdays, day];
                        })
                      }
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Field
                label={q.label}
                hint={q.type === 'number' ? `${q.min ?? 0}〜${q.max ?? '上限なし'}` : undefined}
              >
                {q.choices ? (
                  <select value={q.value} onChange={(e) => change((s) => q.set(s, e.target.value))}>
                    {q.choices.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={q.type === 'end-time' ? 'time' : (q.type ?? 'text')}
                    min={q.min}
                    max={q.max}
                    step={q.step}
                    value={q.value === '24:00' ? '00:00' : q.value}
                    onChange={(e) => change((s) => q.set(s, e.target.value))}
                  />
                )}
              </Field>
            )}
            {q.type === 'end-time' && (
              <button
                onClick={() => change((s) => q.set(s, '24:00'))}
                aria-pressed={q.value === '24:00'}
              >
                翌日00:00（24:00）まで{q.value === '24:00' ? '（選択中）' : ''}
              </button>
            )}
            {d.topic === 'material' && d.index === 2 && (
              <p className="hint">完了数・記録・開始済み予定・固定予定のある周回は残します。</p>
            )}
            <div className="question-footer">
              <button onClick={() => patch(d.index ? { index: d.index - 1 } : { stage: 'choose' })}>
                前の質問
              </button>
              <button data-submit className="primary" onClick={next}>
                {d.index + 1 === questions.length ? 'この項目の変更を終える' : '次へ'}
              </button>
            </div>
          </>
        )}
        {d.stage === 'question' && ['study', 'class', 'busy', 'exception'].includes(d.topic) && (
          <div className="revision-remove">
            <button onClick={() => setRemove(true)}>この時間枠・予定を取り除く</button>
            {remove && (
              <div className="confirmation-panel">
                <p>
                  この時間枠・予定を変更案から取り除きます。承認するまで元の設定は変わりません。
                </p>
                <button
                  onClick={() => {
                    change((s) => {
                      if (d.topic === 'exception')
                        s.exceptions = s.exceptions.filter((x) => x.id !== d.itemId);
                      else s.windows = s.windows.filter((x) => x.id !== d.itemId);
                    });
                    patch({ stage: 'choose' });
                    setRemove(false);
                  }}
                >
                  変更案から取り除く
                </button>
                <button onClick={() => setRemove(false)}>戻る</button>
              </div>
            )}
          </div>
        )}
        {d.stage === 'review' && (
          <>
            <h2>この変更で計画案を作りますか？</h2>
            <ul>
              {settingChanges(d.base, d.settings).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            {!settingChanges(d.base, d.settings).length && (
              <p>設定は変えず、現在の残数で予定を組み直します。</p>
            )}
            <StudyCoverageNotice
              settings={d.settings}
              onReviewGoal={(gap, topic) =>
                void update((s) => beginStudyGoalReview(s, gap, topic)).catch((e) =>
                  setError(String(e)),
                )
              }
              onConfigure={(gap) =>
                void update((s) => beginStudyCoverageRepair(s, gap)).catch((e) =>
                  setError(String(e)),
                )
              }
            />
            {d.settings.windows.some((w) => w.kind === 'study') && (
              <TimetablePreview
                periodLabel="確認できる期間"
                settings={d.settings}
                from={today()}
                to={addDays(today(), 90)}
              />
            )}
            <div className="actions">
              <button onClick={() => patch({ stage: 'choose' })}>別の項目も見直す</button>
              <button data-submit className="primary" disabled={stale} onClick={() => void apply()}>
                この条件で再計画案を作成
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="revision-bottom">
          <button onClick={onClose}>下書きを残して閉じる</button>
          <button onClick={() => setDiscard(true)}>変更の下書きを破棄する</button>
        </div>
        {discard && (
          <div className="confirmation-panel">
            <p>この見直しの回答を破棄します。現在の設定・計画・実績はそのままです。</p>
            <button
              onClick={() =>
                void update((s) => ({ ...s, draft: { ...s.draft, revision: undefined } })).then(
                  onClose,
                )
              }
            >
              下書きを破棄する
            </button>
            <button onClick={() => setDiscard(false)}>戻る</button>
          </div>
        )}
      </section>
    </NumericDraftProvider>
  );
}
