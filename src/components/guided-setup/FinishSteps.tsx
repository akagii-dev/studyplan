import { ArrowRight } from 'lucide-react';
import { ReactNode } from 'react';
import { setupIssues } from '../../domain/setupIssues';
import { Field } from '../common';
import { RegistrationStatus } from '../RegistrationStatus';
import { SetupImpact } from '../SetupImpact';
import { newWindow } from './model';
import { QuestionView, StepContext } from './types';

export function FinishSteps(ctx: StepContext): QuestionView | undefined {
  const {
    w,
    state,
    mode,
    go,
    choice,
    setting,
    otherBuffer,
    setOtherBuffer,
    materialDraftPending,
    onGenerate,
    onClose,
    onAddMaterial,
    onReview,
    onConfigure,
  } = ctx;
  let title: string,
    content: ReactNode,
    valid = true;
  switch (w.step) {
    case 'addition.saved':
      title = `${mode === 'addExam' ? w.exam.name : w.material.name}を登録しました`;
      content = (
        <>
          {mode === 'addExam' && (
            <div className="actions">
              <button className="primary" onClick={() => onAddMaterial?.(w.exam.id)}>
                {materialDraftPending ? '入力途中の教材の追加を再開' : 'この試験の教材を追加'}
              </button>
            </div>
          )}
          {mode === 'addExam' && !state.settings.materials.some((m) => m.examId === w.exam.id) && (
            <p className="hint">この試験の学習予定は、教材を追加してから作成できます。</p>
          )}
          <RegistrationStatus
            state={state}
            onGenerate={onGenerate}
            onReview={onReview!}
            onConfigure={onConfigure!}
          />
          <button onClick={onClose}>一覧へ戻る</button>
        </>
      );
      break;
    case 'buffer':
      title = 'どのくらい余裕を残しますか？';
      content = (
        <>
          <p>週全体（月〜日）の割当上限に適用します。日ごとの余裕時間は予約しません。</p>
          <div className="choices large">
            {[0.1, 0.2, 0.3].map((b) =>
              choice(
                `${b * 100}%${b === 0.2 ? '（初期値）' : ''}`,
                !otherBuffer && state.settings.buffer === b,
                () => {
                  setOtherBuffer(false);
                  setting('buffer', b);
                },
              ),
            )}
            {choice('その他', otherBuffer, () => setOtherBuffer(true))}
          </div>
          {otherBuffer && (
            <Field label="余裕率（%）">
              <input
                type="number"
                min="0"
                max="99"
                value={Math.round(state.settings.buffer * 100)}
                onChange={(e) => setting('buffer', +e.target.value / 100)}
              />
            </Field>
          )}
          <p className="hint">20%は初期値です。自由に変更できます。</p>
        </>
      );
      valid = state.settings.buffer >= 0 && state.settings.buffer < 1;
      break;
    case 'finish':
      title = '設定の確認';
      content = (
        <>
          <div className="answer-summary">
            <p>
              試験 <b>{state.settings.exams.length}件</b> · 教材{' '}
              <b>{state.settings.materials.length}件</b>
            </p>
            <p>
              連続で最長 {state.settings.block}分 → 休憩 {state.settings.rest}分 → 勉強 · 余裕率{' '}
              {Math.round(state.settings.buffer * 100)}%
            </p>
          </div>
          <SetupImpact
            settings={state.settings}
            onConfigureStudy={(gap) =>
              go('window.period', {
                window: { ...newWindow(), from: gap.from, to: gap.to },
              })
            }
            onConfigure={(kind) =>
              go(kind === 'class' ? 'class.ask' : kind === 'busy' ? 'busy.ask' : 'exception.ask')
            }
          />
          <button
            data-submit
            className="primary wide"
            onClick={onGenerate}
            disabled={setupIssues(state.settings).some((i) => i.severity === 'error')}
          >
            計画案を作成する
            <ArrowRight size={17} />
          </button>
        </>
      );
      break;
    default:
      return undefined;
  }
  return { title, content, valid };
}
