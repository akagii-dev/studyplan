import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DailyTime } from '../src/components/DailyTime';
import { initialState } from '../src/domain/model';
import { studentFixture } from './fixtures/student';

const date = '2030-10-07';
it('未設定の日も0分を示し、詳細は閉じておき、入力状態を変更しない', () => {
  const settings = initialState().settings;
  const before = structuredClone(settings);
  const html = renderToStaticMarkup(createElement(DailyTime, { settings, date }));
  expect(html).toContain('<dt>学習可能</dt><dd>0分</dd>');
  expect(html).toContain('<details class="daily-time-details">');
  expect(html).not.toContain(' open=');
  expect(html).not.toContain('role="img"');
  expect(html.match(/<circle /g)).toHaveLength(1);
  expect(html).toContain('stroke-dasharray="1440 0"');
  expect(html).toContain('data-kind="outside"');
  expect(html).not.toContain('title=');
  expect(settings).toEqual(before);
});

it('設定の不備・出発未確認・食事と通学の重複は詳細の外に表示する', () => {
  const settings = studentFixture(date).settings;
  settings.commute!.returnStart = 750;
  delete settings.commute!.departureTimesConfirmed;
  const html = renderToStaticMarkup(createElement(DailyTime, { settings, date }));
  const overview = html.split('<details')[0];
  expect(overview).toContain('通学の出発時刻を確認してください');
  expect(overview).toContain('通学の出発時刻または食事時間を修正してください');
  const invalid = renderToStaticMarkup(
    createElement(DailyTime, { settings: { ...settings, block: 0 }, date }),
  );
  expect(invalid).toContain('時間の設定を確認してください');
  expect(invalid).not.toContain('<details');
});

it('同じページに複数表示しても見出しのIDと領域名が重複しない', () => {
  const settings = initialState().settings;
  const html = renderToStaticMarkup(
    createElement(
      Fragment,
      {},
      createElement(DailyTime, { settings, date }),
      createElement(DailyTime, { settings, date }),
    ),
  );
  const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) expect(html).toContain(`aria-labelledby="${id}"`);
});
