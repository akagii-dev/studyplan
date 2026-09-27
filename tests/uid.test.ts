import { afterEach, expect, it, vi } from 'vitest';
import { uid } from '../src/domain/model';

afterEach(() => vi.unstubAllGlobals());

it('利用可能な環境では既存のrandomUUIDを使う', () => {
  const native = vi.fn(() => '01af4425-d4ea-4f9a-8ad3-10a388da9da1');
  const random = vi.fn();
  vi.stubGlobal('crypto', { randomUUID: native, getRandomValues: random });
  expect(uid()).toBe('01af4425-d4ea-4f9a-8ad3-10a388da9da1');
  expect(native).toHaveBeenCalledOnce();
  expect(random).not.toHaveBeenCalled();
});

it('HTTP LANでrandomUUIDがなくても暗号乱数からUUID v4を作る', () => {
  let next = 0;
  const random = vi.fn((bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = next++;
    return bytes;
  });
  vi.stubGlobal('crypto', { getRandomValues: random });
  const first = uid();
  const second = uid();
  expect(first).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  expect(second).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).not.toBe(first);
  expect(random).toHaveBeenCalledTimes(2);
});

it('暗号乱数の取得失敗を時刻や弱い乱数で隠さない', () => {
  vi.stubGlobal('crypto', {
    getRandomValues: () => {
      throw new Error('乱数取得失敗');
    },
  });
  expect(uid).toThrow('乱数取得失敗');
});
