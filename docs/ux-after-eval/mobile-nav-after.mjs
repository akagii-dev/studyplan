import { chromium } from '@playwright/test';
import { dailyFlowFixture } from '../../scripts/daily-flow-fixture.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const { state } = dailyFlowFixture({ secondBook: true });
const rect = (element) => {
  const r = element.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
};
for (const width of [320, 375, 390]) {
  const context = await browser.newContext({
    viewport: { width, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  });
  await context.addInitScript(({ value }) => {
    if (!localStorage.getItem('studyplan-demo-state-v1')) localStorage.setItem('studyplan-demo-state-v1', value);
  }, { value: JSON.stringify({ revision: 1, data: state }) });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4175/studyplan/', { waitUntil: 'networkidle' });
  const measure = await page.evaluate(() => {
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    };
    const aside = document.querySelector('.sidebar');
    const nav = aside.querySelector('nav');
    const cells = [...nav.querySelectorAll('button')].map((button) => {
      const b = rect(button), i = rect(button.querySelector('svg')), l = rect(button.querySelector('.nav-label'));
      return { name: button.getAttribute('aria-label'), selected: button.getAttribute('aria-current'),
        button: b, icon: i, label: l,
        iconDeltaX: +(i.cx - b.cx).toFixed(2), labelDeltaX: +(l.cx - b.cx).toFixed(2) };
    });
    return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      sidebar: rect(aside), nav: rect(nav), cells,
      bottom: getComputedStyle(aside).bottom, paddingBottom: getComputedStyle(aside).paddingBottom };
  });
  console.log('MEASURE', width, JSON.stringify(measure));
  await page.screenshot({ path: `docs/ux-after-eval/mobile-nav-after-${width}-today.png`, fullPage: false });
  await page.locator('h1').focus();
  await page.keyboard.press('Shift+Tab');
  console.log('FOCUS', width, await page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return { name: element.getAttribute('aria-label'), visible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
  }));
  await page.screenshot({ path: `docs/ux-after-eval/mobile-nav-after-${width}-focus.png`, fullPage: false });
  for (const name of ['今後の予定', '記録履歴', '設定', '今日']) {
    await page.getByRole('button', { name, exact: true }).tap();
    const selected = await page.locator('.sidebar nav button[aria-current="page"]').getAttribute('aria-label');
    const heading = await page.locator('h1').innerText();
    console.log('TAP', width, name, selected, heading);
  }
  await page.getByRole('button', { name: '設定', exact: true }).tap();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const occlusion = await page.evaluate(() => {
    const footer = document.querySelector('.sidebar').getBoundingClientRect();
    const main = document.querySelector('main').getBoundingClientRect();
    const controls = [...document.querySelectorAll('main button, main input, main select')];
    const last = controls.at(-1);
    const target = last.getBoundingClientRect();
    const hit = document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2);
    return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      scrollY, scrollHeight: document.documentElement.scrollHeight,
      footerTop: footer.top, mainBottom: main.bottom,
      lastControl: { tag: last.tagName, text: last.textContent?.trim().slice(0, 30), y: target.y, bottom: target.bottom },
      lastControlTopmost: last === hit || last.contains(hit) };
  });
  console.log('BOTTOM', width, JSON.stringify(occlusion));
  await page.screenshot({ path: `docs/ux-after-eval/mobile-nav-after-${width}-settings-bottom.png`, fullPage: false });
  if (width === 320) {
    // Emulate env(safe-area-inset-bottom)=24px in the current formulas. This is
    // a geometry check only; the browser still reports a real inset of zero.
    await page.addStyleTag({ content: '@media(max-width:700px){.app-shell .sidebar{padding-bottom:28px!important}.app-shell main{padding-bottom:96px!important}}' });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    console.log('SAFE_AREA_24_SIM', await page.evaluate(() => {
      const footer = document.querySelector('.sidebar').getBoundingClientRect();
      const last = [...document.querySelectorAll('main button, main input, main select')].at(-1).getBoundingClientRect();
      return { footerTop: footer.top, footerHeight: footer.height, lastControlBottom: last.bottom,
        gap: footer.top - last.bottom, scrollWidth: document.documentElement.scrollWidth };
    }));
    await page.screenshot({ path: 'docs/ux-after-eval/mobile-nav-after-320-safe-area-24-sim.png', fullPage: false });
  }
  await context.close();
}
await browser.close();
