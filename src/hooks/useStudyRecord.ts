import { createContext, useContext, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { remaining, today, uid, type AppState } from '../domain/model';
import { materialUnit } from '../domain/calendarQuantity';
import { parseNumberInput } from '../domain/numeric';
import { recordAndAdjust } from '../domain/planning';
import type { Update } from '../components/common';
import type { StudyRecordFields } from '../components/StudyRecordForm';

// Session memory lives above reloadEpoch; it is never a second persistence store.
export interface RecordMemory {
  values: Map<string, unknown>;
  requests: Map<string, { key: string; id: string }>;
  sending: Set<string>;
  revisions: Map<string, number>;
  version: number;
  listeners: Set<() => void>;
  confirmed?: (id: string) => void;
}
export const StudyRecordMemory = createContext<RecordMemory | null>(null);
export function createRecordMemory(): RecordMemory {
  return { values: new Map(), requests: new Map(), sending: new Set(), revisions: new Map(), version: 0, listeners: new Set() };
}
export function notifyRecordMemory(memory: RecordMemory) {
  memory.version += 1;
  memory.listeners.forEach((listener) => listener());
}
export function deleteRecordInput(memory: RecordMemory, key: string) {
  memory.values.delete(key);
  memory.revisions.set(key, (memory.revisions.get(key) ?? 0) + 1);
  notifyRecordMemory(memory);
}
export function clearRecordMemory(memory: RecordMemory) {
  for (const key of memory.values.keys()) memory.revisions.set(key, (memory.revisions.get(key) ?? 0) + 1);
  memory.values.clear();
  memory.requests.clear();
  notifyRecordMemory(memory);
}
function useMemoryVersion(memory: RecordMemory | null) {
  useSyncExternalStore((listener) => {
    memory?.listeners.add(listener);
    return () => { memory?.listeners.delete(listener); };
  }, () => memory?.version ?? 0, () => memory?.version ?? 0);
}
export function useRecordInput<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>, Dispatch<SetStateAction<T>>] {
  const shared = useContext(StudyRecordMemory);
  const fallback = useRef(createRecordMemory());
  const memory = shared ?? fallback.current;
  useMemoryVersion(memory);
  const revision = memory.revisions.get(key) ?? 0;
  const value = memory.values.has(key) ? memory.values.get(key) as T : initial;
  const setValue: Dispatch<SetStateAction<T>> = (next) => {
    const previous = memory.values.has(key) ? memory.values.get(key) as T : initial;
    memory.values.set(key, typeof next === 'function' ? (next as (value: T) => T)(previous) : next);
    memory.revisions.set(key, (memory.revisions.get(key) ?? 0) + 1);
    notifyRecordMemory(memory);
  };
  // A completion from an unmounted form must never overwrite a newer input or target.
  const setIfUnchanged: Dispatch<SetStateAction<T>> = (next) => {
    if ((memory.revisions.get(key) ?? 0) === revision) setValue(next);
  };
  return [value, setValue, setIfUnchanged];
}

export function useConfirmedRecordRetry(state: AppState, value: StudyRecordFields) {
  const memory = useContext(StudyRecordMemory);
  useMemoryVersion(memory);
  const key = JSON.stringify(value);
  return !!memory && [...memory.requests.values()].some((request) => request.key === key &&
    state.records.some((entry) => entry.id === request.id && !entry.cancelled && entry.date === value.date &&
      entry.materialId === value.materialId && entry.round === value.round && entry.count === Number(value.text)));
}

export function useStudyRecord(update: Update, scope: string) {
  const shared = useContext(StudyRecordMemory);
  const fallback = useRef(createRecordMemory());
  const memory = shared ?? fallback.current;
  useMemoryVersion(memory);
  const busy = memory.sending.size > 0;
  async function save(value: StudyRecordFields, finish?: (state: AppState) => AppState) {
    if (memory.sending.size) return null;
    memory.sending.add(scope);
    notifyRecordMemory(memory);
    const key = JSON.stringify(value);
    const requestKey = key;
    if (!memory.requests.has(requestKey)) memory.requests.set(requestKey, { key, id: uid() });
    const id = memory.requests.get(requestKey)!.id;
    let result = { id, count: 0, unit: '問' };
    try {
      await update((current) => {
        const material = current.settings.materials.find((item) => item.id === value.materialId);
        if (!material?.rounds[value.round]) throw new Error('教材と周回を選択してください。');
        const date = new Date(`${value.date}T12:00:00`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(date.getTime()) ||
          date.getFullYear() !== Number(value.date.slice(0, 4)) || date.getMonth() + 1 !== Number(value.date.slice(5, 7)) ||
          date.getDate() !== Number(value.date.slice(8)) || value.date > today())
          throw new Error('記録日は今日以前の有効な日付を指定してください。');
        const existing = current.records.find((item) => item.id === id);
        if (existing) {
          if (existing.date !== value.date || existing.materialId !== value.materialId || existing.round !== value.round ||
            existing.cancelled || existing.count !== Number(value.text))
            throw new Error('保存後に記録が変更されています。記録履歴を確認してください。');
          result = { id, count: existing.count, unit: materialUnit(material.unit) };
          return finish ? finish(current) : current;
        }
        const count = parseNumberInput(value.text, 0, remaining(current, material.id, value.round), 1);
        const now = new Date().toISOString();
        const next = recordAndAdjust(current, { id, date: value.date, materialId: material.id, round: value.round,
          count, cancelled: false, createdAt: now, updatedAt: now });
        result = { id, count, unit: materialUnit(material.unit) };
        return finish ? finish(next) : next;
      });
      memory.requests.delete(requestKey);
      memory.confirmed?.(id);
      return result;
    } finally {
      memory.sending.delete(scope);
      notifyRecordMemory(memory);
    }
  }
  return { busy, save };
}
