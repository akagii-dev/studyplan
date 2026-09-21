import { ArrowRight, Check, Plus } from 'lucide-react';
import { ReactNode } from 'react';
import { examColors } from '../../domain/appearance';
import { addDays, today } from '../../domain/model';
import { Field } from '../common';
import { newExam } from './model';
import { QuestionView, StepContext } from './types';

export function ExamSteps(ctx: StepContext): QuestionView | undefined {
  const { w, state, mode, exam, go, choice, saveAndGo, savingItem } = ctx;
  let title: string,
    content: ReactNode,
    valid = true;
  switch (w.step) {
    case 'exam.name':
      title = '何の試験を受けますか？';
      content = (
        <Field label="試験名">
          <input
            autoFocus
            placeholder="例：基本情報技術者試験"
            value={w.exam.name}
            onChange={(e) => exam({ name: e.target.value })}
          />
        </Field>
      );
      valid = !!w.exam.name.trim();
      break;
    case 'exam.target':
      title = 'いつまでの合格を目指しますか？';
      content = (
        <Field label="目標日">
          <input
            type="date"
            value={w.exam.target}
            onChange={(e) => exam({ target: e.target.value })}
          />
        </Field>
      );
      valid = !!w.exam.target;
      break;
    case 'exam.start':
      title = 'いつから計画を始めますか？';
      content = (
        <>
          <div className="choices">
            {choice('今日から', w.exam.start === today(), () => exam({ start: today() }))}
          </div>
          <Field label="計画開始日">
            <input
              type="date"
              max={w.exam.target}
              value={w.exam.start}
              onChange={(e) => exam({ start: e.target.value })}
            />
          </Field>
        </>
      );
      valid = !!w.exam.start && w.exam.start <= w.exam.target;
      break;
    case 'exam.priority':
      title = 'この試験の優先度は？';
      content = (
        <div className="wizard-options">
          {[
            [3, '高い'],
            [2, 'ふつう'],
            [1, '低い'],
          ].map(([n, label]) =>
            choice(String(label), w.exam.priority === n, () => exam({ priority: Number(n) })),
          )}
        </div>
      );
      break;
    case 'exam.color':
      title = 'この試験の色を選んでください。';
      content = (
        <div className="wizard-options color-options">
          {examColors.map(({ value: color, name }) => (
            <button
              key={color}
              aria-label={`表示色 ${color}`}
              aria-pressed={w.exam.color === color}
              className={w.exam.color === color ? 'selected' : ''}
              onClick={() => exam({ color })}
            >
              <i style={{ background: color }} />
              {name}
              {w.exam.color === color && <Check size={16} />}
            </button>
          ))}
        </div>
      );
      break;
    case 'exam.review':
      title = '最後に復習する期間を取りますか？';
      content = (
        <div className="wizard-options">
          {choice('復習期間を設定する', w.exam.reviewDays > 0, () => go('exam.reviewDays'))}
          {choice('今回は設定しない', w.exam.reviewDays === 0, () =>
            go('exam.done', { exam: { ...w.exam, reviewDays: 0 } }),
          )}
        </div>
      );
      break;
    case 'exam.reviewDays':
      title = '復習に何日間、取っておきますか？';
      content = (
        <>
          <div className="choices">
            {[7, 14, 21].map((n) =>
              choice(`${n}日`, w.exam.reviewDays === n, () => exam({ reviewDays: n })),
            )}
          </div>
          <Field label="復習期間（日）">
            <input
              type="number"
              min="1"
              value={w.exam.reviewDays}
              onChange={(e) => exam({ reviewDays: +e.target.value })}
            />
          </Field>
        </>
      );
      valid =
        Number.isInteger(w.exam.reviewDays) &&
        w.exam.reviewDays > 0 &&
        addDays(w.exam.start, w.exam.reviewDays) <= w.exam.target;
      break;
    case 'exam.done':
      title = '目標はこれでよいですか？';
      content = (
        <>
          <div className="answer-summary">
            <h3>{w.exam.name}</h3>
            <p>
              {w.exam.start} → {w.exam.target}
            </p>
            <p>
              優先度：{['', '低い', 'ふつう', '高い'][w.exam.priority]} · 復習 {w.exam.reviewDays}日
            </p>
          </div>
          <div className="wizard-options">
            {mode ? (
              <button
                data-submit
                className="primary"
                disabled={savingItem}
                onClick={() => saveAndGo('exam', 'addition.saved')}
              >
                試験を登録する
              </button>
            ) : (
              <>
                <button
                  data-submit
                  className="primary"
                  onClick={() => saveAndGo('exam', 'window.period')}
                >
                  {w.editScope ? '保存して修正を終了' : '保存して、勉強できる時間へ'}
                  <ArrowRight size={17} />
                </button>
                {!w.editScope && (
                  <button onClick={() => saveAndGo('exam', 'exam.name', { exam: newExam() })}>
                    <Plus size={17} />
                    別の試験も追加する
                  </button>
                )}
              </>
            )}
          </div>
          {mode && (
            <p className="hint">
              {state.proposal
                ? '登録後、承認待ちの計画案は作り直します。'
                : '登録後に教材を追加できます。'}
              計画への反映は、計画案の承認後です。
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
