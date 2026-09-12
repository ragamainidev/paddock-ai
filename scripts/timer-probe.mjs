import { chromium } from 'playwright-core';
const id = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(`http://localhost:3000/salvage/${id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const sample = () =>
  page.evaluate(() => {
    const texts = [...document.querySelectorAll('span, p')].map((e) => e.textContent ?? '');
    const header = texts.find((t) => /running · \d/.test(t)) ?? '';
    const cursor = texts.find((t) => /· \d+s$/.test(t)) ?? '';
    const rail = [...document.querySelectorAll('nav li')].map((li) => li.textContent).join(' | ');
    return { header, cursor, rail: rail.slice(0, 120) };
  });
for (let i = 0; i < 7; i++) {
  const s = await sample();
  console.log(`t+${i}s`, JSON.stringify(s));
  await page.waitForTimeout(1000);
}
await browser.close();
