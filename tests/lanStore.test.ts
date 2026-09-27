import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkedEnvelope, getLanKey, lanCall, setLanKey } from '../src/lanStore';
import { initialState } from '../src/domain/model';

afterEach(() => vi.unstubAllGlobals());
function browser() {
  const items = new Map<string, string>();
  const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) };
  vi.stubGlobal('localStorage', storage);
  const replaceState = vi.fn();
  vi.stubGlobal('window', { location: { hash: '', pathname: '/studyplan-lan/', search: '' }, history: { replaceState } });
  setLanKey('a'.repeat(64));
  return { items, replaceState };
}
describe('LAN transport preserves SQLite contracts', () => {
  it('removes the invitation key from the URL and stores only connection metadata', () => {
    const { items, replaceState } = browser();
    window.location.hash = `#key=${'b'.repeat(64)}`;
    expect(getLanKey()).toBe('b'.repeat(64));
    expect(replaceState).toHaveBeenCalledWith(null, '', '/studyplan-lan/');
    expect([...items.values()]).toEqual(['b'.repeat(64)]);
  });
  it('retries an interrupted response with identical requestId and payload', async () => {
    browser();
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('cut')).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, value: { revision: 2 } })));
    vi.stubGlobal('fetch', fetcher);
    await expect(lanCall('commit_state', { expected: 1, requestId: 'operation', data: initialState() })).resolves.toEqual({ revision: 2 });
    const first = fetcher.mock.calls[0][1] as RequestInit;
    const second = fetcher.mock.calls[1][1] as RequestInit;
    expect(first.body).toBe(second.body);
    expect(first.cache).toBe('no-store');
    expect(first.credentials).toBe('omit');
    expect(first.headers).toHaveProperty('Authorization', `Bearer ${'a'.repeat(64)}`);
  });
  it('does not retry conflicts or return success after connection failure', async () => {
    browser();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: '別の操作でデータが更新されました。' }), { status: 409 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(lanCall('commit_state')).rejects.toMatchObject({ code: 'conflict' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockReset().mockRejectedValue(new TypeError('offline'));
    await expect(lanCall('load_state')).rejects.toMatchObject({ code: 'connection' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not initialize malformed data; permits native-readable legacy values', () => {
    expect(() => checkedEnvelope({ revision: -1, data: initialState() })).toThrow();
    expect(() => checkedEnvelope({ revision: 1, data: {} } as never)).toThrow();
    expect(checkedEnvelope(null)).toEqual({ revision: 0, data: initialState() });
  });
  it('can connect without persistent browser storage, without pretending to store study data locally', async () => {
    browser();
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    });
    window.location.hash = `#key=${'d'.repeat(64)}`;
    expect(getLanKey()).toBe('d'.repeat(64));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, value: 2 })));
    vi.stubGlobal('fetch', fetcher);
    expect(await lanCall('revision')).toBe(2);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${'d'.repeat(64)}`);
  });
});
