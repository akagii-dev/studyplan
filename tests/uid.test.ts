import { afterEach, expect, it, vi } from 'vitest';
import { uid } from '../src/domain/model';

afterEach(() => vi.unstubAllGlobals());

it('HTTP LANでrandomUUIDが使えなくても暗号乱数からUUID v4を作る', () => {
  let next = 0;
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = next++;
      return bytes;
    },
  });
  const first = uid();
  const second = uid();
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).not.toBe(first);
});
