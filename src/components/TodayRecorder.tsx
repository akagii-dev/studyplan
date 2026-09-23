import { FormEvent, useRef, useState } from 'react';
import { Props } from './common';
import { remaining, today, uid } from '../domain/model';
import { parseNumberInput } from '../domain/numeric';
import { recordAndAdjust } from '../domain/planning';
import { todayStudyRows } from '../domain/todayProgress';
import { currentProgressAdjustment } from '../domain/progressAdjustment';

export function TodayRecorder({ state, update }: Props) {
  const rows = todayStudyRows(state);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [outsideMaterial, setOutsideMaterial] = useState(state.settings.materials[0]?.id ?? '');
  const [outsideRound, setOutsideRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const request = useRef(uid());
  const date = today();
  const key = (materialId: string, round: number) => JSON.stringify([materialId, round]);
  const outside = state.settings.materials.find((material) => material.id === outsideMaterial);

  async function save(event: FormEvent, materialId: string, round: number) {
    event.preventDefault();
    if (sending.current) return;
    const id = key(materialId, round);
    let count: number;
    try {
      count = parseNumberInput(drafts[id] ?? '', 0, remaining(state, materialId, round), 1);
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: (error as Error).message }));
      return;
    }
    sending.current = true;
    setBusy(true);
    setErrors((current) => ({ ...current, [id]: '' }));
    setMessage('');
    const recordId = request.current;
    const now = new Date().toISOString();
    let adjustment = 'recorded';
    try {
      await update((current) => {
        const next = recordAndAdjust(current, {
          id: recordId,
          date,
          materialId,
          round,
          count,
          cancelled: false,
          createdAt: now,
          updatedAt: now,
        });
        adjustment = currentProgressAdjustment(next)?.status ?? 'recorded';
        return next;
      });
      request.current = uid();
      setDrafts((current) => ({ ...current, [id]: '' }));
      setMessage(`${count}問を記録${adjustment === 'applied' ? 'し、明日以降を調整しました。' : adjustment === 'review' ? 'しました。予定の確認が必要です。' : 'しました。'}`);
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: String(error) }));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {rows.length ? (
        <div className="daily-record-list" role="list">
          {rows.map((row) => {
            const id = key(row.materialId, row.round);
            return (
              <div className="daily-record-row" role="listitem" key={id}>
                <div className="daily-record-name">
                  <strong>{row.materialName}</strong>
                  <span>{row.round + 1}周目</span>
                </div>
                <div className="daily-record-amounts">
                  <span>{row.planned ? `予定 ${row.planned}問` : '予定なし'}</span>
                  <span>{row.reported ? `実績 ${row.actual}問` : '実績 未入力'}</span>
                </div>
                <form className="daily-record-form" onSubmit={(event) => void save(event, row.materialId, row.round)}>
                  <label>
                    {row.reported ? '追加分' : '実績'}
                    <input
                      type="text"
                      inputMode="numeric"
                      value={drafts[id] ?? ''}
                      aria-label={`${row.materialName} ${row.round + 1}周目の${row.reported ? '追加分' : '実績'}（問）`}
                      onChange={(event) => {
                        setDrafts((current) => ({ ...current, [id]: event.target.value }));
                        setErrors((current) => ({ ...current, [id]: '' }));
                      }}
                    />
                  </label>
                  <span>問</span>
                  <button data-submit className="primary" type="submit" disabled={busy}>
                    記録
                  </button>
                </form>
                {errors[id] && <p className="daily-record-error" role="alert">{errors[id]}</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <p>今日の学習予定はありません。</p>
      )}
      <details className="outside-record">
        <summary>予定外の学習を記録</summary>
        {state.settings.materials.length ? (
          <form onSubmit={(event) => void save(event, outsideMaterial, outsideRound)}>
            <label>
              問題集
              <select
                value={outsideMaterial}
                onChange={(event) => {
                  setOutsideMaterial(event.target.value);
                  setOutsideRound(0);
                }}
              >
                {state.settings.materials.map((material) => (
                  <option key={material.id} value={material.id}>{material.name}</option>
                ))}
              </select>
            </label>
            <label>
              周回
              <select value={outsideRound} onChange={(event) => setOutsideRound(Number(event.target.value))}>
                {outside?.rounds.map((_, round) => <option key={round} value={round}>{round + 1}周目</option>)}
              </select>
            </label>
            <label>
              追加問数
              <input
                type="text"
                inputMode="numeric"
                value={drafts[key(outsideMaterial, outsideRound)] ?? ''}
                onChange={(event) => setDrafts((current) => ({ ...current, [key(outsideMaterial, outsideRound)]: event.target.value }))}
              />
            </label>
            <button data-submit className="primary" type="submit" disabled={busy}>記録</button>
            {errors[key(outsideMaterial, outsideRound)] && (
              <p className="daily-record-error" role="alert">{errors[key(outsideMaterial, outsideRound)]}</p>
            )}
          </form>
        ) : (
          <p>先に問題集を登録してください。</p>
        )}
      </details>
      {message && <p className="daily-record-saved" role="status">{message}</p>}
    </>
  );
}
