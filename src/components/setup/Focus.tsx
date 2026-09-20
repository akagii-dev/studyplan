import { sessionPolicy } from '../../domain/sessionPolicy';
import { Field, Props } from '../common';
export function Focus({ state, update }: Props) {
  const s = state.settings;
  const patch = (key: string, value: number) =>
    void update((x) => ({ ...x, settings: { ...x.settings, [key]: value }, proposal: null }));
  return (
    <section className="card narrow">
      <div className="eyebrow">STEP 03 · YOUR PACE</div>
      <h2>最長でどのくらい続けて勉強できますか？</h2>
      <Field label="連続で勉強できる最長時間（分）">
        <input
          type="number"
          min="1"
          max={1440}
          value={s.block}
          onChange={(e) => patch('block', +e.target.value)}
        />
      </Field>
      <p className="note">
        {s.block}分まで勉強 → {s.rest}分休憩 → {s.block}分まで勉強
      </p>
      <Field label="ブロック間の休憩（分）">
        <input
          type="number"
          min="1"
          max="1440"
          value={s.rest}
          onChange={(e) => patch('rest', +e.target.value)}
        />
      </Field>
      <Field label="授業前後の移動・準備（各・分）" hint="各授業の前後に空ける時間です。">
        <input
          type="number"
          min="0"
          max="180"
          value={s.classTransition ?? 0}
          onChange={(e) => patch('classTransition', +e.target.value)}
        />
      </Field>
      <details>
        <summary>予定のまとまりを調整する</summary>
        <Field
          label="予定の下限（分）"
          hint="教材の完了時や期限上必要な場合だけ、短い予定を許可します。"
        >
          <input
            type="number"
            min="1"
            max={sessionPolicy(s).preferred}
            value={sessionPolicy(s).minimum}
            onChange={(e) => patch('minimumSessionMinutes', +e.target.value)}
          />
        </Field>
        <Field
          label="まとまりの目安（分）"
          hint="空き枠と連続学習の上限の中で、この長さを目指します。"
        >
          <input
            type="number"
            min={sessionPolicy(s).minimum}
            max="1440"
            value={sessionPolicy(s).preferred}
            onChange={(e) => patch('preferredSessionMinutes', +e.target.value)}
          />
        </Field>
      </details>
    </section>
  );
}
