import { AppState, Settings, completed, clock, uid, mealKeys, mealNames, today } from './model';
import { sameSettings } from './planAudit';
import { sessionPolicy } from './sessionPolicy';

export type RevisionTopic =
  'exam' | 'material' | 'study' | 'class' | 'busy' | 'exception' | 'focus' | 'meal' | 'commute';
export interface RevisionDraft {
  id: string;
  base: Settings;
  settings: Settings;
  stage: 'choose' | 'item' | 'question' | 'review';
  topic: RevisionTopic;
  itemId: string;
  index: number;
}
export function beginRevision(state: AppState): AppState {
  return {
    ...state,
    draft: {
      ...state.draft,
      revision: {
        id: uid(),
        base: structuredClone(state.settings),
        settings: structuredClone(state.settings),
        stage: 'choose',
        topic: 'focus',
        itemId: '',
        index: 0,
      } satisfies RevisionDraft,
    },
  };
}
export function minimumRetainedRounds(
  state: AppState,
  materialId: string,
  from = today(),
  notBefore?: number,
) {
  const minute =
    notBefore ?? (from === today() ? new Date().getHours() * 60 + new Date().getMinutes() : 0);
  const material = state.settings.materials.find((m) => m.id === materialId);
  const required = [
    0,
    ...(material?.rounds.flatMap((r, i) => (r.completed > 0 ? [i] : [])) ?? []),
    ...state.records.filter((r) => r.materialId === materialId).map((r) => r.round),
    ...(state.plan?.sessions
      .filter(
        (s) =>
          s.materialId === materialId &&
          s.kind === 'study' &&
          (s.fixed || s.date < from || (s.date === from && s.start < minute)),
      )
      .map((s) => s.round) ?? []),
  ];
  return required.reduce((max, round) => Math.max(max, round), 0) + 1;
}
export function validateRevisedSettings(
  state: AppState,
  candidate: Settings,
  from = today(),
  notBefore?: number,
) {
  for (const exam of state.settings.exams)
    if (!candidate.exams.some((e) => e.id === exam.id))
      throw new Error('登録済み試験は再計画から削除できません。');
  for (const old of state.settings.materials) {
    const material = candidate.materials.find((m) => m.id === old.id);
    if (!material) throw new Error('登録済み教材は再計画から削除できません。');
    if (material.rounds.length < minimumRetainedRounds(state, old.id, from, notBefore))
      throw new Error('完了数・記録・開始済み予定・固定予定のある周回は減らせません。');
    for (let i = 0; i < Math.min(old.rounds.length, material.rounds.length); i++) {
      if (material.rounds[i].completed !== old.rounds[i].completed)
        throw new Error('再計画では完了数を変更できません。訂正は記録履歴で行ってください。');
      if (material.total < completed(state, old.id, i))
        throw new Error(`${old.name}：総問題数が完了数を下回っています。`);
    }
  }
}
export function revisionIsStale(draft: RevisionDraft, settings: Settings) {
  return !sameRevisionBase(draft.base, settings);
}
export function sameRevisionBase(a: Settings, b: Settings) {
  return (
    sameSettings(a, b) &&
    JSON.stringify(a.scheduleAnswers ?? {}) === JSON.stringify(b.scheduleAnswers ?? {})
  );
}
export function settingChanges(before: Settings, after: Settings): string[] {
  const changes: string[] = [];
  if (JSON.stringify(before.commute) !== JSON.stringify(after.commute)) {
    const c = after.commute;
    changes.push(
      c?.enabled
        ? `通学：${c.from}〜${c.to}、${c.mode === 'classDays' ? '授業日のみ' : '曜日 ' + c.weekdays.map((d) => ['日', '月', '火', '水', '木', '金', '土'][d]).join('・')}、往路${c.outboundMinutes}分・復路${c.returnMinutes}分（出発 ${clock(c.outboundStart)} / ${clock(c.returnStart)}）`
        : '通学：設定なし',
    );
  }
  const add = (label: string, a: unknown, b: unknown) => {
    if (a !== b) changes.push(`${label}：${a} → ${b}`);
  };
  for (const [key, label] of [
    ['block', '連続で勉強できる最長時間'],
    ['rest', 'ブロック間の休憩'],
  ] as const)
    add(label, `${before[key]}分`, `${after[key]}分`);
  for (const [key, label] of [
    ['minimum', '予定の下限'],
    ['preferred', 'まとまりの目安'],
  ] as const)
    add(label, `${sessionPolicy(before)[key]}分`, `${sessionPolicy(after)[key]}分`);
  add(
    '授業前後の移動・準備',
    `${before.classTransition ?? 0}分`,
    `${after.classTransition ?? 0}分`,
  );
  for (const key of mealKeys) {
    const format = (s: Settings) => {
      const m = s.meals?.[key];
      return m ? clock(m.start) + 'から' + m.duration + '分' : '未設定';
    };
    add(mealNames[key], format(before), format(after));
  }
  add('余裕率', `${Math.round(before.buffer * 100)}%`, `${Math.round(after.buffer * 100)}%`);
  for (const e of after.exams) {
    const old = before.exams.find((x) => x.id === e.id);
    if (!old) {
      changes.push(`試験を追加：${e.name}`);
      continue;
    }
    for (const [k, label] of [
      ['start', '計画開始日'],
      ['target', '目標日'],
      ['priority', '優先度'],
      ['reviewDays', '別枠の復習日数'],
    ] as const)
      add(`${old.name} / ${label}`, old[k], e[k]);
  }
  for (const m of after.materials) {
    const old = before.materials.find((x) => x.id === m.id);
    if (!old) {
      changes.push(`教材を追加：${m.name}`);
      continue;
    }
    add(`${m.name} / 総問題数`, old.total, m.total);
    add(`${m.name} / 順序`, old.order, m.order);
    add(`${m.name} / 周回数`, old.rounds.length, m.rounds.length);
    m.rounds.forEach((r, i) => {
      if (old.rounds[i]) {
        add(
          `${m.name} ${i + 1}周目 / 初期完了数`,
          `${old.rounds[i].completed}問`,
          `${r.completed}問`,
        );
        add(
          `${m.name} ${i + 1}周目 / 1問の推定時間`,
          `${old.rounds[i].minutes}分`,
          `${r.minutes}分`,
        );
      }
    });
  }
  const windowText = (w: Settings['windows'][number]) =>
    `${w.name} ${w.from}〜${w.to} ${w.weekdays.map((d) => '日月火水木金土'[d]).join('・')} ${clock(w.start)}〜${clock(w.end)}`;
  for (const w of before.windows)
    if (!after.windows.some((x) => x.id === w.id)) changes.push(`時間枠を削除：${windowText(w)}`);
  for (const w of after.windows) {
    const old = before.windows.find((x) => x.id === w.id);
    if (!old) changes.push(`時間枠を追加：${windowText(w)}`);
    else {
      const { name: _oldName, ...oldCondition } = old;
      const { name: _newName, ...newCondition } = w;
      if (JSON.stringify(oldCondition) !== JSON.stringify(newCondition))
        changes.push(`時間枠：${windowText(old)} → ${windowText(w)}`);
    }
  }
  const eventText = (e: Settings['exceptions'][number]) =>
    `${e.name} ${e.date} ${clock(e.start)}〜${clock(e.end)}`;
  for (const e of before.exceptions)
    if (!after.exceptions.some((x) => x.id === e.id)) changes.push(`予定を削除：${eventText(e)}`);
  for (const e of after.exceptions) {
    const old = before.exceptions.find((x) => x.id === e.id);
    if (!old) changes.push(`予定を追加：${eventText(e)}`);
    else {
      const { name: _oldName, ...oldCondition } = old;
      const { name: _newName, ...newCondition } = e;
      if (JSON.stringify(oldCondition) !== JSON.stringify(newCondition))
        changes.push(`予定：${eventText(old)} → ${eventText(e)}`);
    }
  }
  return changes;
}
