import { AppState, Envelope, initialState } from './domain/model';
import { lanBase } from './lan';

const keyName = 'studyplan-lan-access-key-v1';
let memoryKey = '';
export function getLanKey(): string {
  const incoming = new URLSearchParams(window.location.hash.slice(1)).get('key');
  if (incoming && /^[a-f0-9]{64}$/i.test(incoming)) {
    setLanKey(incoming);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  if (memoryKey) return memoryKey;
  try { memoryKey = localStorage.getItem(keyName) ?? ''; }
  catch { /* Connection metadata is optional; study data stays in SQLite. */ }
  return memoryKey;
}
export function setLanKey(key: string): void {
  if (!/^[a-f0-9]{64}$/i.test(key.trim())) throw new Error('接続キーを確認してください。');
  memoryKey = key.trim();
  try { localStorage.setItem(keyName, memoryKey); }
  catch { /* A storage-restricted browser can still connect for this session. */ }
}
export class LanError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
export async function lanCall<T>(command: string, args: object = {}): Promise<T> {
  const key = getLanKey();
  if (!key) throw new LanError('Windowsで表示された接続リンクを開くか、接続キーを入力してください。', 'auth');
  // A transport retry reuses the exact body, including the same requestId.
  const body = JSON.stringify(args);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${lanBase}api/${command}`, {
        method: 'POST', cache: 'no-store', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body, signal: controller.signal,
      });
      const packet = await response.json() as { ok: boolean; value?: T; error?: string };
      if (!response.ok || packet.ok !== true)
        throw new LanError(packet.error || 'Windowsの保存処理を確認できません。',
          response.status === 409 ? 'conflict' : response.status === 401 ? 'auth' : 'server');
      return packet.value as T;
    } catch (error) {
      if (error instanceof LanError) throw error;
      if (attempt === 1)
        throw new LanError('Windowsに接続できません。配信PCとWi-Fiを確認してください。保存は未確認です。', 'connection');
    } finally { clearTimeout(timer); }
  }
  throw new LanError('Windowsに接続できません。', 'connection');
}

export function checkedEnvelope(value: Envelope | null): Envelope {
  if (value === null) return { revision: 0, data: initialState() };
  // Match native reads: legacy data remains editable; full schema/semantic checks run at the shared Rust write boundary.
  if (!Number.isSafeInteger(value?.revision) || value.revision < 0 || !value.data?.settings || !Array.isArray(value.data.records))
    throw new Error('Windowsから読み込んだデータの形式を確認できません。初期化せず停止しました。');
  return value;
}
export const loadLanState = async () => checkedEnvelope(await lanCall<Envelope | null>('load_state'));
export const saveLanState = async (data: AppState, expected: number, requestId: string) =>
  checkedEnvelope(await lanCall<Envelope>('commit_state', { data, expected, requestId }));
