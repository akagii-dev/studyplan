import { ArrowRight, Plus } from 'lucide-react';
import { ReactNode } from 'react';
import { clock, minutes, today, uid } from '../../domain/model';
import { scheduleCount } from '../../domain/setupIssues';
import { ClassNames } from '../ClassNames';
import { Field, weekdays } from '../common';
import { SkipImpact } from '../SetupImpact';
import { TimetablePreview } from '../TimetablePreview';
import { newWindow } from './model';
import { QuestionView, StepContext } from './types';

export function AvailabilitySteps(ctx: StepContext): QuestionView | undefined {
  const {
    w,
    state,
    update,
    win,
    patch,
    go,
    choice,
    saveAndGo,
    answerAndGo,
    editTimes,
    setEditTimes,
  } = ctx;
  let title: string,
    content: ReactNode,
    valid = true;
  switch (w.step) {
    case 'window.period':
    case 'busy.period':
      title =
        w.step === 'window.period'
          ? 'この時間の設定を、いつまで使いますか？'
          : 'この定期予定の期間は？';
      content = (
        <div className="two">
          <Field label="適用開始日">
            <input
              type="date"
              value={w.window.from}
              onChange={(e) => win({ from: e.target.value })}
            />
          </Field>
          <Field label="適用終了日">
            <input
              type="date"
              min={w.window.from}
              value={w.window.to}
              onChange={(e) => win({ to: e.target.value })}
            />
          </Field>
        </div>
      );
      valid = !!w.window.from && w.window.from <= w.window.to;
      break;
    case 'window.days':
    case 'busy.days':
      title = w.step === 'window.days' ? 'どの曜日に勉強できますか？' : '何曜日の予定ですか？';
      content = (
        <div className="choices weekday-choices">
          {weekdays.map((label, i) =>
            choice(label, w.window.weekdays.includes(i), () =>
              win({
                weekdays: w.window.weekdays.includes(i)
                  ? w.window.weekdays.filter((d) => d !== i)
                  : [...w.window.weekdays, i],
              }),
            ),
          )}
        </div>
      );
      valid = w.window.weekdays.length > 0;
      break;
    case 'window.time':
    case 'busy.time':
      title =
        w.step === 'window.time'
          ? '何時から何時まで勉強できますか？'
          : '予定は何時から何時までですか？';
      content = (
        <div className="two">
          <Field
            label={w.step === 'window.time' ? '勉強できる開始時刻' : '予定の開始時刻'}
            hint={
              w.step === 'window.time'
                ? 'これより前には学習を入れません。'
                : 'ここから学習不可です。'
            }
          >
            <input
              type="time"
              value={clock(w.window.start)}
              onChange={(e) => win({ start: minutes(e.target.value) })}
            />
          </Field>
          <Field
            label={w.step === 'window.time' ? '勉強できる終了時刻' : '予定の終了時刻'}
            hint={
              w.step === 'window.time'
                ? 'これより後には学習を入れません。'
                : 'ここまで学習不可です。'
            }
          >
            <input
              type="time"
              value={clock(w.window.end)}
              onChange={(e) => win({ end: minutes(e.target.value) })}
            />
          </Field>
        </div>
      );
      valid = w.window.start >= 0 && w.window.end > w.window.start && w.window.end <= 1440;
      break;
    case 'window.done':
    case 'busy.done':
      title = 'ほかの時間帯も追加しますか？';
      content = (
        <>
          <div className="answer-summary">
            <h3>{w.window.name}</h3>
            <p>
              {w.window.weekdays.map((d) => weekdays[d]).join('・')}　{clock(w.window.start)}〜
              {clock(w.window.end)}
            </p>
            <p>
              {w.window.from}〜{w.window.to}
            </p>
          </div>
          <div className="wizard-options">
            <button
              data-submit
              className="primary"
              onClick={() =>
                saveAndGo('window', w.step === 'window.done' ? 'class.ask' : 'exception.ask')
              }
            >
              保存して次へ
              <ArrowRight size={17} />
            </button>
            <button
              onClick={() =>
                saveAndGo('window', w.step === 'window.done' ? 'window.period' : 'busy.name', {
                  window: newWindow(w.window.kind),
                })
              }
            >
              <Plus size={17} />
              もう一つ追加する
            </button>
          </div>
        </>
      );
      break;
    case 'class.ask':
      title = '大学の授業を登録しますか？';
      content = (
        <div className="wizard-options">
          <button data-submit className="primary" onClick={() => go('class.period')}>
            時間割を登録する
          </button>
          <button
            onClick={() =>
              answerAndGo(
                'class',
                scheduleCount(state.settings, 'class') ? 'registered' : 'none',
                'busy.ask',
              )
            }
          >
            {scheduleCount(state.settings, 'class') ? '登録済みの授業で進める' : '授業はない'}
          </button>
          <SkipImpact kind="class" />
          <button onClick={() => answerAndGo('class', 'deferred', 'busy.ask')}>
            あとで設定する
          </button>
        </div>
      );
      break;
    case 'class.period':
      title = 'この時間割は、いつの期間ですか？';
      content = (
        <div className="two">
          <Field label="時間割の適用開始">
            <input
              type="date"
              value={w.classFrom}
              onChange={(e) => patch({ classFrom: e.target.value })}
            />
          </Field>
          <Field label="時間割の適用終了">
            <input
              type="date"
              min={w.classFrom}
              value={w.classTo}
              onChange={(e) => patch({ classTo: e.target.value })}
            />
          </Field>
        </div>
      );
      valid = !!w.classFrom && w.classFrom <= w.classTo;
      break;
    case 'class.times':
      title = '授業の開始時刻は合っていますか？';
      content = (
        <>
          <div className="answer-summary">
            {state.settings.periods.map((t, i) => (
              <div className="row" key={i}>
                <span>{i + 1}限</span>
                {editTimes ? (
                  <input
                    aria-label={`${i + 1}限の開始`}
                    type="time"
                    value={clock(t)}
                    onChange={(e) => {
                      const v = minutes(e.target.value);
                      if (v >= 0 && v + 100 <= 1440)
                        void update((s) => ({
                          ...s,
                          settings: {
                            ...s.settings,
                            periods: s.settings.periods.map((a, j) => (j === i ? v : a)),
                            windows: s.settings.windows.map((rule) =>
                              rule.kind === 'class' &&
                              rule.start === t &&
                              rule.from === w.classFrom &&
                              rule.to === w.classTo
                                ? { ...rule, start: v, end: v + 100 }
                                : rule,
                            ),
                          },
                          proposal: null,
                        }));
                    }}
                  />
                ) : (
                  <b>
                    {clock(t)}〜{clock(t + 100)}
                  </b>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setEditTimes(!editTimes)}>
            {editTimes ? '時刻の編集を終了' : '開始時刻を変更する'}
          </button>
        </>
      );
      break;
    case 'class.grid':
      title = '授業があるコマを押してください。';
      content = (
        <>
          <div className="timetable wizard-timetable">
            <div>時限</div>
            {[1, 2, 3, 4, 5].map((d) => (
              <b key={d}>{weekdays[d]}</b>
            ))}
            {state.settings.periods.map((t, i) => (
              <div className="timetable-row" key={i}>
                <span>
                  {i + 1}限 <small>{clock(t)}</small>
                </span>
                {[1, 2, 3, 4, 5].map((day) => {
                  const found = state.settings.windows.find(
                    (x) =>
                      x.kind === 'class' &&
                      x.start === t &&
                      x.weekdays[0] === day &&
                      x.from === w.classFrom &&
                      x.to === w.classTo,
                  );
                  return (
                    <button
                      key={day}
                      className={found ? 'class-selected' : ''}
                      aria-label={`${weekdays[day]}曜${i + 1}限`}
                      aria-pressed={!!found}
                      onClick={() =>
                        void update((s) => ({
                          ...s,
                          settings: {
                            ...s.settings,
                            windows: found
                              ? s.settings.windows.filter((x) => x.id !== found.id)
                              : [
                                  ...s.settings.windows,
                                  {
                                    id: uid(),
                                    kind: 'class',
                                    name: '大学の授業',
                                    from: w.classFrom,
                                    to: w.classTo,
                                    weekdays: [day],
                                    start: t,
                                    end: t + 100,
                                  },
                                ],
                          },
                          proposal: null,
                        }))
                      }
                    >
                      {found ? (
                        <span>
                          授業<small>学習不可</small>
                        </span>
                      ) : (
                        <Plus size={14} />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <ClassNames state={state} update={update} from={w.classFrom} to={w.classTo} />
          <TimetablePreview settings={state.settings} from={w.classFrom} to={w.classTo} />
        </>
      );
      break;
    case 'busy.ask':
      title = '授業以外に、毎週の予定はありますか？';
      content = (
        <div className="wizard-options">
          <button onClick={() => go('busy.name', { window: newWindow('busy') })}>
            定期予定を登録する
          </button>
          <button
            data-submit
            className="primary"
            onClick={() =>
              answerAndGo(
                'busy',
                scheduleCount(state.settings, 'busy') ? 'registered' : 'none',
                'exception.ask',
              )
            }
          >
            {scheduleCount(state.settings, 'busy')
              ? '登録済みの定期予定で進める'
              : '定期予定はない'}
            <ArrowRight size={17} />
          </button>
          <SkipImpact kind="busy" />
          <button onClick={() => answerAndGo('busy', 'deferred', 'exception.ask')}>
            あとで設定する
          </button>
        </div>
      );
      break;
    case 'busy.name':
      title = 'どんな定期予定ですか？';
      content = (
        <Field label="予定の名前">
          <input
            value={w.window.name}
            onChange={(e) => win({ name: e.target.value })}
            placeholder="例：アルバイト"
          />
        </Field>
      );
      valid = !!w.window.name.trim();
      break;
    case 'exception.ask':
      title = '勉強できない特定の日はありますか？';
      content = (
        <div className="wizard-options">
          <button
            onClick={() =>
              go('exception.date', {
                exception: {
                  id: uid(),
                  name: '勉強できない予定',
                  date: today(),
                  start: 0,
                  end: 1440,
                },
              })
            }
          >
            勉強できない予定を追加
          </button>
          <button
            data-submit
            className="primary"
            onClick={() =>
              answerAndGo(
                'exception',
                scheduleCount(state.settings, 'exception') ? 'registered' : 'none',
                'meals',
              )
            }
          >
            {scheduleCount(state.settings, 'exception')
              ? '登録済みの単発予定で進める'
              : '勉強できない日はない'}
            <ArrowRight size={17} />
          </button>
          <SkipImpact kind="exception" />
          <button onClick={() => answerAndGo('exception', 'deferred', 'meals')}>
            あとで設定する
          </button>
        </div>
      );
      break;
    case 'exception.date':
      title = '勉強できないのは、いつですか？';
      content = (
        <Field label="予定日">
          <input
            type="date"
            value={w.exception.date}
            onChange={(e) => patch({ exception: { ...w.exception, date: e.target.value } })}
          />
        </Field>
      );
      valid = !!w.exception.date;
      break;
    case 'exception.kind':
      title = '一日中、それとも一部の時間ですか？';
      content = (
        <div className="wizard-options">
          <button
            onClick={() =>
              go('exception.done', { exception: { ...w.exception, start: 0, end: 1440 } })
            }
          >
            終日、勉強できない
          </button>
          <button
            onClick={() =>
              go('exception.time', { exception: { ...w.exception, start: 600, end: 720 } })
            }
          >
            時間帯だけ指定する
          </button>
        </div>
      );
      break;
    case 'exception.time':
      title = '何時から何時まで予定がありますか？';
      content = (
        <div className="two">
          <Field label="予定の開始時刻">
            <input
              type="time"
              value={clock(w.exception.start)}
              onChange={(e) =>
                patch({ exception: { ...w.exception, start: minutes(e.target.value) } })
              }
            />
          </Field>
          <Field label="予定の終了時刻">
            <input
              type="time"
              value={clock(w.exception.end)}
              onChange={(e) =>
                patch({ exception: { ...w.exception, end: minutes(e.target.value) } })
              }
            />
          </Field>
        </div>
      );
      valid = w.exception.start >= 0 && w.exception.end > w.exception.start;
      break;
    case 'exception.done':
      title = 'この予定を登録します。';
      content = (
        <>
          <div className="answer-summary">
            <b>{w.exception.date}</b>
            <p>
              {w.exception.end === 1440 && w.exception.start === 0
                ? '終日'
                : `${clock(w.exception.start)}〜${clock(w.exception.end)}`}
            </p>
          </div>
          <div className="wizard-options">
            <button data-submit className="primary" onClick={() => saveAndGo('exception', 'meals')}>
              保存して次へ
            </button>
            <button onClick={() => saveAndGo('exception', 'exception.ask')}>
              ほかの予定も追加する
            </button>
          </div>
        </>
      );
      break;

    default:
      return undefined;
  }
  return { title, content, valid };
}
