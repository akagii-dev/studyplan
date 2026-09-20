import { ArrowRight, Plus } from 'lucide-react';
import { ReactNode } from 'react';
import { Field } from '../common';
import { newMaterial } from './model';
import { QuestionView, StepContext } from './types';

export function MaterialSteps(ctx: StepContext): QuestionView | undefined {
  const { w, state, mode, mat, go, choice, saveAndGo, savingItem } = ctx;
  let title: string,
    content: ReactNode,
    valid = true;
  switch (w.step) {
    case 'material.exam':
      title = 'どの試験の教材を登録しますか？';
      content = (
        <div className="wizard-options">
          {state.settings.exams.map((e) =>
            choice(e.name, w.material.examId === e.id, () => mat({ examId: e.id })),
          )}
        </div>
      );
      valid = state.settings.exams.some((e) => e.id === w.material.examId);
      break;
    case 'material.name':
      title = '教材の名前を教えてください。';
      content = (
        <Field label="教材名">
          <input
            placeholder="例：過去問題集"
            value={w.material.name}
            onChange={(e) => mat({ name: e.target.value })}
          />
        </Field>
      );
      valid = !!w.material.name.trim();
      break;
    case 'material.total':
      title = '問題は全部で何問ありますか？';
      content = (
        <Field label="総問題数">
          <input
            type="number"
            min="1"
            max="1000000000"
            value={w.material.total}
            onChange={(e) => mat({ total: +e.target.value })}
          />
        </Field>
      );
      valid = Number.isInteger(w.material.total) && w.material.total > 0;
      break;
    case 'material.rounds':
      title = 'この教材を何周しますか？';
      content = (
        <>
          <div className="choices">
            {[1, 2, 3].map((n) =>
              choice(`${n}周`, w.material.rounds.length === n, () =>
                mat({
                  rounds: Array.from(
                    { length: n },
                    (_, i) => w.material.rounds[i] ?? { completed: 0, minutes: 2 },
                  ),
                }),
              ),
            )}
          </div>
          <Field label="周回数">
            <input
              type="number"
              min="1"
              max="20"
              value={w.material.rounds.length}
              onChange={(e) =>
                mat({
                  rounds: Array.from(
                    { length: Math.min(20, Math.max(1, +e.target.value)) },
                    (_, i) => w.material.rounds[i] ?? { completed: 0, minutes: 2 },
                  ),
                })
              }
            />
          </Field>
        </>
      );
      break;
    case 'material.completed': {
      const i = Math.min(w.roundIndex, w.material.rounds.length - 1);
      title = `${i + 1}周目は、すでに何問終わっていますか？`;
      content = (
        <Field label={`${i + 1}周目の初期完了数`} hint="記録画面から追加した問題数は含めません。">
          <input
            type="number"
            min="0"
            max={w.material.total}
            value={w.material.rounds[i].completed}
            onChange={(e) =>
              mat({
                rounds: w.material.rounds.map((r, j) =>
                  i === j ? { ...r, completed: +e.target.value } : r,
                ),
              })
            }
          />
        </Field>
      );
      valid =
        Number.isInteger(w.material.rounds[i].completed) &&
        w.material.rounds[i].completed >= 0 &&
        w.material.rounds[i].completed <= w.material.total;
      break;
    }
    case 'material.minutes':
      title = '1問に何分くらいかかりそうですか？';
      content = (
        <Field label="1問あたりの推定時間（分）">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={w.material.rounds[0].minutes}
            onChange={(e) =>
              mat({ rounds: w.material.rounds.map((r) => ({ ...r, minutes: +e.target.value })) })
            }
          />
        </Field>
      );
      valid = w.material.rounds[0].minutes > 0;
      break;
    case 'material.custom':
      title = '周回ごとに、所要時間を変えますか？';
      content = (
        <div className="wizard-options">
          <button
            data-submit
            className="primary"
            onClick={() =>
              go('material.order', {
                material: {
                  ...w.material,
                  rounds: w.material.rounds.map((r) => ({
                    ...r,
                    minutes: w.material.rounds[0].minutes,
                  })),
                },
              })
            }
          >
            すべて同じ時間で進める
          </button>
          <button onClick={() => go('material.roundMinutes', { roundIndex: 1 })}>
            周回ごとに変更する
          </button>
        </div>
      );
      break;
    case 'material.roundMinutes': {
      const i = Math.min(w.roundIndex, w.material.rounds.length - 1);
      title = `${i + 1}周目は1問に何分かけますか？`;
      content = (
        <Field label={`${i + 1}周目の推定時間（分）`}>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={w.material.rounds[i].minutes}
            onChange={(e) =>
              mat({
                rounds: w.material.rounds.map((r, j) =>
                  i === j ? { ...r, minutes: +e.target.value } : r,
                ),
              })
            }
          />
        </Field>
      );
      valid = w.material.rounds[i].minutes > 0;
      break;
    }
    case 'material.order':
      title = 'この教材は何番目に取り組みますか？';
      content = (
        <Field label="取り組む順序">
          <input
            type="number"
            min="1"
            value={w.material.order}
            onChange={(e) => mat({ order: +e.target.value })}
          />
        </Field>
      );
      valid = Number.isInteger(w.material.order) && w.material.order > 0;
      break;
    case 'material.done':
      title = mode ? 'この教材を登録しますか？' : 'ほかの教材も登録しますか？';
      content = (
        <>
          <div className="answer-summary">
            <h3>{w.material.name}</h3>
            {mode && <p>{state.settings.exams.find((e) => e.id === w.material.examId)?.name}</p>}
            <p>
              {w.material.total}問 × {w.material.rounds.length}周 · {w.material.order}番目
            </p>
            {w.material.rounds.map((r, i) => (
              <p key={i}>
                {i + 1}周目：初期完了 {r.completed}問 · 1問 {r.minutes}分
              </p>
            ))}
          </div>
          <div className="wizard-options">
            {mode ? (
              <button
                data-submit
                className="primary"
                disabled={savingItem}
                onClick={() => saveAndGo('material', 'addition.saved')}
              >
                教材を登録する
              </button>
            ) : (
              <>
                <button
                  data-submit
                  className="primary"
                  onClick={() => saveAndGo('material', 'buffer')}
                >
                  保存して、最後の質問へ
                  <ArrowRight size={17} />
                </button>
                <button
                  onClick={() =>
                    saveAndGo('material', 'material.exam', {
                      material: newMaterial(w.material.examId),
                      roundIndex: 0,
                    })
                  }
                >
                  <Plus size={17} />
                  別の教材も追加する
                </button>
              </>
            )}
          </div>
          {mode && (
            <p className="hint">
              登録内容を保存します。カレンダーへの反映は計画案の承認後です。
              {state.proposal && '承認待ちの案は作り直します。'}
            </p>
          )}
        </>
      );
      break;

    default:
      return undefined;
  }
  return { title, content, valid };
}
