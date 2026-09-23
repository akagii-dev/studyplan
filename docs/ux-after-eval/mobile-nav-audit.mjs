import { chromium } from '@playwright/test';
import { dailyFlowFixture } from '../../scripts/daily-flow-fixture.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const { state } = dailyFlowFixture({ secondBook: true });
for (const width of [320, 375, 390]) {
  const context = await browser.newContext({
    viewport: { width, height: 812 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  await context.addInitScript(({ value }) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', value);
  }, { value: JSON.stringify({ revision: 1, data: state }) });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/studyplan/', { waitUntil: 'networkidle' });
  console.log(`WIDTH ${width}`);
  const measure = async () => page.evaluate(() => {
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    };
    const aside = document.querySelector('.sidebar');
    const nav = aside?.querySelector('nav');
    const cells = [...(nav?.querySelectorAll('button') ?? [])].map((button) => {
      const icon = button.querySelector('svg');
      const label = button.querySelector('.nav-label');
      const b = rect(button), i = rect(icon), l = rect(label);
      return {
        name: button.getAttribute('aria-label'), selected: button.getAttribute('aria-current'),
        button: b, icon: i, label: l,
        iconDeltaX: +(i.cx - b.cx).toFixed(2), labelDeltaX: +(l.cx - b.cx).toFixed(2),
        iconDeltaY: +(i.cy - b.cy).toFixed(2), labelDeltaY: +(l.cy - b.cy).toFixed(2),
      };
    });
    return {
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      sidebar: rect(aside), nav: rect(nav), cells,
      safeAreaBottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom'),
      bottom: getComputedStyle(aside).bottom,
      paddingBottom: getComputedStyle(aside).paddingBottom,
    };
  });
  console.log(JSON.stringify(await measure()));
  await page.screenshot({ path: `docs/ux-after-eval/mobile-nav-${width}-today.png`, fullPage: false });
  for (const name of ['今後の予定', '記録履歴', '設定', '今日']) {
    await page.getByRole('button', { name, exact: true }).tap();
    const selected = await page.locator('.sidebar nav button[aria-current="page"]').getAttribute('aria-label');
    const heading = await page.locator('h1').innerText();
    console.log(`TAP ${width} ${name} selected=${selected} heading=${heading}`);
  }
  await page.getByRole('button', { name: '設定', exact: true }).tap();
  await page.screenshot({ path: `docs/ux-after-eval/mobile-nav-${width}-settings.png`, fullPage: false });
  console.log('SCROLL', width, await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth })));
  await context.close();
}
await browser.close();
