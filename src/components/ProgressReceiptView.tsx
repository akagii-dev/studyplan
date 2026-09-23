import { AppState, clock } from '../domain/model';
import { ProgressReceipt } from '../domain/progressReceipt';
import { duration } from './common';

const actionNames = { record: '記録', correct: '訂正', cancel: '取消' } as const;
const statusNames = {
  applied: '明日以降を調整',
  unchanged: '予定の変更なし',
  unplaced: '未配置あり',
  review: '計画案の確認が必要',
  failed: '予定調整に失敗',
  recorded: '予定は未作成',
} as const;

export function receiptLabel(receipt: ProgressReceipt) {
  return `${actionNames[receipt.action]} · ${statusNames[receipt.status]}${['review', 'failed'].includes(receipt.status) ? '（操作時）' : ''}`;
}
export function receiptOutcome(receipt: ProgressReceipt) {
  if (receipt.status === 'unplaced') {
    const minutes = receipt.shortfalls.reduce((sum, item) => sum + item.minutes, 0);
    const quantity = receipt.shortfalls.length === 1
      ? `${receipt.shortfalls[0].count}問`
      : `${receipt.shortfalls.length}項目`;
    return `未配置 ${quantity}・${duration(minutes)}`;
  }
  return `${statusNames[receipt.status]}${receipt.status === 'applied' ? ` ${receipt.changes.length}件` : ''}`;
}
export function receiptDetailLabel(receipt: ProgressReceipt) {
  if (receipt.status === 'failed') return '失敗の理由を見る';
  if (receipt.status === 'review') return '確認内容を見る';
  if (receipt.status === 'unplaced') return '未配置の内訳を見る';
  return receipt.changes.length ? '予定の変更を見る' : '結果を見る';
}

export function ProgressReceiptView({ state, receipt }: { state: AppState; receipt: ProgressReceipt }) {
  const materialName = (id: string) => state.settings.materials.find((item) => item.id === id)?.name ?? id;
  const slots = (values: string[]) => values.length ? values.map((value) => {
    const [start, end] = value.split('-').map(Number);
    return `${clock(start)}–${clock(end)}`;
  }).join('、') : 'なし';
  return (
    <div className="progress-receipt">
      <strong>{receiptLabel(receipt)}</strong>
      {receipt.changes.length > 0 && (
        <ul>
          {receipt.changes.map((item, index) => (
            <li key={`${item.date}/${item.materialId}/${item.round}/${item.kind}/${item.fixed}/${index}`}>
              {item.date} · {item.kind === 'review' ? '復習' : `${materialName(item.materialId)} · ${item.round + 1}周目`}
              {' '}{item.kind === 'review'
                ? `${duration(item.beforeMinutes)} → ${duration(item.afterMinutes)}`
                : `${item.beforeCount} → ${item.afterCount}問`}
              {item.fixed ? ' · 固定' : ''}
              {item.timeChanged && <small className="block">時間 {slots(item.beforeSlots)} → {slots(item.afterSlots)}</small>}
            </li>
          ))}
        </ul>
      )}
      {receipt.status === 'unplaced' && (
        <ul>
          {receipt.shortfalls.map((item, index) => (
            <li key={`${item.materialId}/${item.round}/${index}`}>
              未配置 {materialName(item.materialId)} · {item.round + 1}周目 {item.count}問・{duration(item.minutes)}
            </li>
          ))}
        </ul>
      )}
      {receipt.detail && <small className={receipt.status === 'failed' ? 'error' : ''}>{receipt.detail}</small>}
    </div>
  );
}
