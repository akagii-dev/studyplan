import { useRef, useState } from 'react';
import { ClassCancellation, today, uid } from '../../domain/model';
import { classCancellationErrors, classCancellationLabel, classLabel } from '../../domain/classCancellations';
import { Field, Props, useDraft } from '../common';

interface CancellationDraft {
  id: string;
  from: string;
  to: string;
  range: boolean;
  scope: 'all' | 'selected';
  classIds: string[];
}

export function ClassCancellations({ state, update }: Props) {
  const blank: CancellationDraft = { id: '', from: today(), to: today(), range: false, scope: 'all', classIds: [] };
  const [form, setForm] = useDraft(state, update, 'classCancellation', blank);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const classes = state.settings.windows.filter((item) => item.kind === 'class');

  async function save() {
    if (pending.current) return;
    const item: ClassCancellation = {
      id: form.id || uid(), from: form.from, to: form.range ? form.to : form.from,
      ...(form.scope === 'selected' ? { classIds: form.classIds } : {}),
    };
    const error = classCancellationErrors({ ...state.settings, classCancellations: [item] })[0];
    if (error) { setError(error); return; }
    pending.current = true;
    setSaving(true);
    try {
      await update((s) => {
        if (form.id && !s.settings.classCancellations?.some((old) => old.id === form.id))
          throw new Error('この休講はすでに取り消されています。一覧を確認してください。');
        const settings = { ...s.settings, classCancellations: [
          ...(s.settings.classCancellations ?? []).filter((old) => old.id !== item.id), item,
        ] };
        const error = classCancellationErrors(settings)[0];
        if (error) throw new Error(error);
        return { ...s, settings, draft: { ...s.draft, classCancellation: blank } };
      });
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '休講を保存できませんでした。');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await update((s) => ({
        ...s,
        settings: { ...s.settings, classCancellations: (s.settings.classCancellations ?? []).filter((item) => item.id !== id) },
        draft: { ...s.draft, ...(form.id === id ? { classCancellation: blank } : {}) },
      }));
      setRemoving(null);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '休講を取り消せませんでした。');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return <section className="card" aria-labelledby="class-cancellations-heading">
    <h2 id="class-cancellations-heading">休講・大学の休み</h2>
    <p>休講になった授業の時間を、登録済みの「勉強できる時間」の範囲で使えます。授業日のみの通学は、その日の授業がすべて休講なら外れます。</p>
    <Field label="休講の期間">
      <select value={form.range ? 'range' : 'single'} disabled={saving}
        onChange={(e) => setForm({ ...form, range: e.target.value === 'range' })}>
        <option value="single">1日だけ</option><option value="range">開始日から終了日まで</option>
      </select>
    </Field>
    <div className="two">
      <Field label={form.range ? '休講の開始日' : '休講日'}>
        <input type="date" value={form.from} disabled={saving} onChange={(e) => setForm({ ...form, from: e.target.value })} />
      </Field>
      {form.range && <Field label="休講の終了日（この日を含む）">
        <input type="date" min={form.from} value={form.to} disabled={saving} onChange={(e) => setForm({ ...form, to: e.target.value })} />
      </Field>}
    </div>
    <Field label="休講にする授業">
      <select value={form.scope} disabled={saving} onChange={(e) => setForm({ ...form, scope: e.target.value as CancellationDraft['scope'] })}>
        <option value="all">全授業</option><option value="selected">授業コマを選ぶ</option>
      </select>
    </Field>
    {form.scope === 'selected' && <fieldset disabled={saving}>
      <legend>対象の授業コマ</legend>
      {!classes.length && <p>授業が登録されていません。</p>}
      {classes.map((item) => <label className="check" key={item.id}>
        <input type="checkbox" checked={form.classIds.includes(item.id)} onChange={(e) => setForm({
          ...form, classIds: e.target.checked ? [...form.classIds, item.id] : form.classIds.filter((id) => id !== item.id),
        })} />{classLabel(item)}
      </label>)}
      {form.classIds.filter((id) => !classes.some((item) => item.id === id)).map((id) => <label className="check" key={id}>
        <input type="checkbox" checked onChange={() => setForm({ ...form, classIds: form.classIds.filter((old) => old !== id) })} />削除済みの授業
      </label>)}
    </fieldset>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="row actions">
      <button className="primary" disabled={saving} onClick={() => void save()}>{form.id ? '休講を更新する' : '休講を追加する'}</button>
      {form.id && <button disabled={saving} onClick={() => { setForm(blank); setError(''); }}>編集をやめる</button>}
    </div>
    {(state.settings.classCancellations ?? []).map((item) => <div className="history-row" key={item.id}>
      <p>{classCancellationLabel(state.settings, item)}</p>
      <div className="row actions">
        <button disabled={saving} aria-label={`${item.from}の休講を編集`} onClick={() => {
          setForm({ ...item, range: item.from !== item.to, scope: item.classIds === undefined ? 'all' : 'selected', classIds: item.classIds ?? [] });
          setError('');
        }}>編集</button>
        {removing === item.id ? <div className="delete-confirm" role="group" aria-label={`${item.from}の休講取消確認`}>
          <span>この休講を取り消して、授業を戻しますか？</span>
          <button disabled={saving} onClick={() => void remove(item.id)}>休講を取り消す</button>
          <button disabled={saving} onClick={() => setRemoving(null)}>やめる</button>
        </div> : <button disabled={saving} aria-label={`${item.from}の休講を取消`} onClick={() => setRemoving(item.id)}>取消</button>}
      </div>
    </div>)}
  </section>;
}
