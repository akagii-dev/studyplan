import { ReactNode } from 'react';
import { Field } from '../common';
import { MealSetup } from '../Meals';
import { QuestionView, StepContext } from './types';

export function FocusSteps(ctx: StepContext): QuestionView | undefined {
  const { w, state, update, go, skip, choice, setting } = ctx;
  let title: string,
    content: ReactNode,
    valid = true;
  switch (w.step) {
    case 'focus.total': // Continue older in-progress setup at the new meal questions.
    case 'meals':
      title = '食事の時間も確保しましょう';
      content = (
        <MealSetup
          state={state}
          update={update}
          onDone={() => go('focus.block')}
          onSkipRemaining={state.settings.exams.length ? skip : undefined}
        />
      );
      break;
    case 'focus.block':
      title = '最長で何分続けて勉強できますか？';
      content = (
        <>
          <div className="choices">
            {[25, 50, 60].map((n) =>
              choice(`${n}分`, state.settings.block === n, () => setting('block', n)),
            )}
          </div>
          <Field label="連続で勉強できる最長時間（分）">
            <input
              type="number"
              min="1"
              max={1440}
              value={state.settings.block}
              onChange={(e) => setting('block', +e.target.value)}
            />
          </Field>
        </>
      );
      valid = state.settings.block > 0 && state.settings.block <= 1440;
      break;
    case 'focus.rest':
      title = '間に何分、休憩しますか？';
      content = (
        <>
          <div className="choices">
            {[5, 10, 15].map((n) =>
              choice(`${n}分`, state.settings.rest === n, () => setting('rest', n)),
            )}
          </div>
          <Field label="ブロック間の休憩（分）">
            <input
              type="number"
              min="1"
              max="1440"
              value={state.settings.rest}
              onChange={(e) => setting('rest', +e.target.value)}
            />
          </Field>
        </>
      );
      valid = state.settings.rest >= 1 && state.settings.rest <= 1440;
      break;

    default:
      return undefined;
  }
  return { title, content, valid };
}
