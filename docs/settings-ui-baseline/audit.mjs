import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const targets = [
  '初期設定', '試験・目標', '教材', '時間枠・時間割', '連続時間・余裕率', '通学時間',
  '今日の時間内訳', '計画案の確認', '週間レポート', '警告の管理', '使い方',
];
for (const width of [390, 1280]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 800 },
    isMobile: width === 390, hasTouch: width === 390,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4181/', { waitUntil: 'networkidle' });
  console.log('FIRST_BODY', width, (await page.locator('body').innerText()).replaceAll('\n', ' / '));
  await page.screenshot({ path: `docs/settings-ui-baseline/first-${width}.png`, fullPage: false });
  console.log('HOME', width, (await page.locator('main').innerText()).replaceAll('\n', ' / '));
  await page.getByRole('button', { name: '設定', exact: true }).click();
  console.log('SETTINGS', width, (await page.locator('main').innerText()).replaceAll('\n', ' / '));
  const metrics = await page.evaluate(() => {
    const r = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), width: +rect.width.toFixed(1), height: +rect.height.toFixed(1), bottom: +rect.bottom.toFixed(1) };
    };
    const main = document.querySelector('main');
    const exact = (text) => [...main.querySelectorAll('button')].find((button) => button.textContent.trim() === text);
    const headings = [...main.querySelectorAll('h1,h2,h3')].map((heading) => ({ text: heading.textContent.trim(), rect: r(heading) }));
    return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
      mainTextChars: main.innerText.length, mainButtonCount: main.querySelectorAll('button').length,
      mainSectionCount: main.querySelectorAll('section').length,
      settingsHeading: r(main.querySelector('h1')),
      firstSetting: r(exact('初期設定')),
      ignoredButtons: [...main.querySelectorAll('button')].filter((b) => b.textContent.trim() === '無視する').map(r),
      headings,
      footerTop: document.querySelector('.sidebar').getBoundingClientRect().top };
  });
  console.log('METRICS', width, JSON.stringify(metrics));
  await page.screenshot({ path: `docs/settings-ui-baseline/settings-${width}-viewport.png`, fullPage: false });
  await page.screenshot({ path: `docs/settings-ui-baseline/settings-${width}-full.png`, fullPage: true });
  for (const name of targets) {
    const button = page.getByRole('button', { name, exact: true });
    const count = await button.count();
    if (!count) { console.log('LINK', width, name, 'missing'); continue; }
    await button.click();
    console.log('LINK', width, name, 'heading=' + await page.locator('h1').innerText());
    await page.getByRole('button', { name: '設定', exact: true }).click();
  }
  const ignore = page.getByRole('button', { name: '無視する', exact: true });
  console.log('IGNORE_COUNT', width, await ignore.count());
  if (await ignore.count()) {
    await ignore.first().click();
    console.log('AFTER_IGNORE', width, (await page.locator('main').innerText()).replaceAll('\n', ' / '));
    await page.screenshot({ path: `docs/settings-ui-baseline/settings-${width}-ignored.png`, fullPage: false });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '設定', exact: true }).click();
    console.log('IGNORE_COUNT_AFTER_RELOAD', width, await page.getByRole('button', { name: '無視する', exact: true }).count());
  }
  await context.close();
}
await browser.close();
