import { clock } from '../domain/model';
import { sortedClasses } from '../domain/timetable';
import { Field, Props, weekdays } from './common';
export function ClassNames({ state, update, from, to }: Props & { from?: string; to?: string }) {
  const classes = sortedClasses(state.settings.windows, from, to);
  if (!classes.length) return null;
  return (
    <div className="class-names">
      <h3>授業名を付けますか？（任意）</h3>
      {classes.map((w) => (
        <Field
          key={w.id}
          label={`${w.weekdays.map((d) => weekdays[d]).join('・')} ${clock(w.start)}〜${clock(w.end)}の授業名（任意）`}
        >
          <input
            value={w.name === '大学の授業' ? '' : w.name}
            placeholder="例：経済学"
            onChange={(e) =>
              void update((s) => ({
                ...s,
                settings: {
                  ...s.settings,
                  windows: s.settings.windows.map((x) =>
                    x.id === w.id ? { ...x, name: e.target.value } : x,
                  ),
                },
              }))
            }
          />
        </Field>
      ))}
    </div>
  );
}
