import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('dialog', (d) => d.accept());
await p.goto('http://localhost:8080/index.html');
await p.waitForFunction(() => window.ga && window.ga.state.look);
// simple engine with a studio photo
await p.evaluate(() => { window.ga.state.settings.engine = 'simple'; });
for (const [f, name, brand] of [['jacket', 'Jacket', 'A'], ['pants', 'Trousers', 'B'], ['sneaker', 'Sneakers', 'C']]) {
  await p.evaluate(async ([f, name, brand]) => { const blob = await (await fetch(`/_t/studio/${f}.jpg`)).blob(); window.__p = window.ga.processPhoto(blob, { name, brand, url: 'https://shop.com/' + f }); }, [f, name, brand]);
  await p.waitForFunction(() => document.querySelector('#sheet-title').textContent.startsWith('New item') && !document.querySelector('#sheet-wrap').classList.contains('hidden'));
  await p.tap('#sheet-right'); await p.evaluate(() => window.__p);
}
await p.fill('#look-title', 'Simple test, "quoted"'); await p.keyboard.press('Enter');
await p.waitForTimeout(600);
await p.screenshot({ path: new URL('./shots/simple.png', import.meta.url).pathname });
await p.tap('#tabs button[data-tab=library]'); await p.waitForSelector('.lib-card');
// export all
const [dl] = await Promise.all([p.waitForEvent('download'), (async () => { await p.tap('text=Export all'); await p.tap('#sheet-body button:has-text("Spreadsheet")'); })()]);
console.log('csv:\n' + fs.readFileSync(await dl.path(), 'utf8'));
await p.waitForTimeout(400);
if (await p.locator('#sheet-wrap:not(.hidden)').count()) await p.tap('#sheet-left').catch(() => {});
// menu: copy, delete
await p.tap('.lib-card'); await p.tap('#sheet-body button:has-text("Make a copy")'); await p.waitForTimeout(500);
console.log('cards after copy:', await p.locator('.lib-card').count());
await p.locator('.lib-card').first().tap(); await p.tap('#sheet-body button:has-text("Delete")'); await p.waitForTimeout(500);
console.log('cards after delete:', await p.locator('.lib-card').count());
await p.locator('.lib-card').first().tap(); await p.tap('#sheet-body button:has-text("Open")'); await p.waitForTimeout(3000);
console.log('opened:', await p.evaluate(() => [window.ga.state.tab, window.ga.state.look.title, window.ga.state.look.items.length]));
await b.close();
