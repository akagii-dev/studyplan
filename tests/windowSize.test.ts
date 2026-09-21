import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_SIZE, fitWindowSize } from '../src/domain/windowSize';

describe('ウィンドウサイズ', () => {
  it('保存値がなければ既存の初期サイズを使う', () => {
    expect(fitWindowSize(undefined)).toEqual(DEFAULT_WINDOW_SIZE);
  });

  it('表示領域内の保存値は変更しない', () => {
    expect(fitWindowSize({ width: 910, height: 680 }, { width: 1200, height: 800 })).toEqual({
      width: 910,
      height: 680,
    });
  });

  it('表示領域を超える寸法だけを縮める', () => {
    expect(fitWindowSize({ width: 1500, height: 680 }, { width: 1200, height: 800 })).toEqual({
      width: 1200,
      height: 680,
    });
    expect(fitWindowSize(undefined, { width: 1000, height: 700 })).toEqual({
      width: 1000,
      height: 700,
    });
  });
});
