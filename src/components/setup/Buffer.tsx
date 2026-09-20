import { useState } from 'react';
import { Field, Props } from '../common';
export function Buffer({ state, update }: Props) {
  const s = state.settings;
  const [other, setOther] = useState(![0.1, 0.2, 0.3].includes(s.buffer));
  return (
    <section className="card narrow">
      <div className="eyebrow">STEP 05 · ROOM TO BREATHE</div>
      <h2>どのくらい余裕を残しますか？</h2>
      <p>
        週全体（月〜日）の学習可能時間から、計画に割り当てずに残す割合です。曜日ごとの余裕時間は予約しません。
      </p>
      <div className="choices large">
        {[0.1, 0.2, 0.3].map((b) => (
          <button
            key={b}
            className={!other && s.buffer === b ? 'selected' : ''}
            onClick={() => {
              setOther(false);
              void update((x) => ({
                ...x,
                settings: { ...x.settings, buffer: b },
                proposal: null,
              }));
            }}
          >
            {Math.round(b * 100)}%{b === 0.2 && <small>初期値</small>}
          </button>
        ))}
        <button className={other ? 'selected' : ''} onClick={() => setOther(true)}>
          その他
        </button>
      </div>
      {other && (
        <Field label="余裕率（%）">
          <input
            type="number"
            min="0"
            max="99"
            value={Math.round(s.buffer * 100)}
            onChange={(e) =>
              void update((x) => ({
                ...x,
                settings: { ...x.settings, buffer: +e.target.value / 100 },
                proposal: null,
              }))
            }
          />
        </Field>
      )}
      <div className="note">20%は初期値です。自由に変更できます。</div>
    </section>
  );
}
