import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { contractDay, progressContractFixture } from '../fixtures/progressContract';

const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('studyplan-demo-state-v1')!).data.uiStyle);
const styleSelect = (page: Page) => page.getByLabel('画面のスタイル');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(`${contractDay}T12:00:00+09:00`) });
  await page.addInitScript((state) => {
    if (!localStorage.getItem('studyplan-demo-state-v1'))
      localStorage.setItem('studyplan-demo-state-v1', JSON.stringify({ revision: 1, data: state }));
  }, progressContractFixture());
  await page.goto('./');
});

test('画面のスタイルはロード画面を挟んで切り替えて保存し、ゲーム機能はゲームUIだけに出す', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '主な画面' });
  // Fresh UI is the default: no rewards, plain tab labels.
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'fresh');
  await expect(page.getByRole('heading', { name: 'ログインボーナス' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '今日のミッション' })).toHaveCount(0);
  await nav.getByRole('button', { name: '設定' }).click();
  await expect(page.getByRole('heading', { name: 'スクリーンタイム' })).toHaveCount(0);

  await styleSelect(page).focus();
  await styleSelect(page).selectOption('game');
  const curtain = page.getByRole('status', { name: '表示を切り替えています' });
  await expect(curtain).toBeVisible();
  await expect(curtain).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'game');
  expect(await stored(page)).toBe('game');
  // The choice stays focused for keyboard users, and the settings show the game-only section.
  expect(await styleSelect(page).evaluate((select) => select === document.activeElement)).toBe(true);
  await expect(page.getByRole('heading', { name: 'スクリーンタイム' })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'game');
  await expect(nav.getByRole('button', { name: '今日' })).toHaveText('TODAY');
  await expect(page.getByRole('heading', { level: 1, name: '今日' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ログインボーナス' })).toBeVisible();
  await expect(page.getByRole('region', { name: '今日のミッション' })).toBeVisible();
  await expect(page.locator('.page-transition:visible')).toHaveCSS('opacity', '1');
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);

  await nav.getByRole('button', { name: '設定' }).click();
  await styleSelect(page).selectOption('fresh');
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'fresh');
  await expect(curtain).toBeHidden();
  expect(await stored(page)).toBe('fresh');
  await nav.getByRole('button', { name: '今日' }).click();
  await expect(page.getByRole('heading', { name: 'ログインボーナス' })).toHaveCount(0);
});

test('視覚効果を減らす設定ではロード画面を動かさずに切り替える', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('navigation', { name: '主な画面' }).getByRole('button', { name: '設定' }).click();
  const animations: string[] = [];
  await page.exposeFunction('noteCurtain', (name: string) => animations.push(name));
  await page.evaluate(() => {
    new MutationObserver(() => {
      const curtain = document.querySelector('.ui-switch-curtain');
      if (curtain) (window as unknown as { noteCurtain: (name: string) => void }).noteCurtain(getComputedStyle(curtain).animationName);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await styleSelect(page).selectOption('game');
  await expect(page.locator('html')).toHaveAttribute('data-ui', 'game');
  await expect(page.locator('.ui-switch-curtain')).toHaveCount(0);
  expect(animations.length).toBeGreaterThan(0);
  expect(new Set(animations)).toEqual(new Set(['none']));
});
