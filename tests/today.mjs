import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('dialog', (d) => d.accept());
await p.goto('http://localhost:8080/index.html');
await p.waitForFunction(() => window.ga && window.ga.state.look);
await p.waitForTimeout(500);
await p.screenshot({ path: new URL('./shots/today-nodata.png', import.meta.url).pathname });
await p.evaluate(() => { window.ga.state.settings.dataUrl = 'http://localhost:8080/_d/'; return window.ga.renderToday(true); });
await p.waitForTimeout(1500);
await p.screenshot({ path: new URL('./shots/today-today.png', import.meta.url).pathname });
console.log('cards:', await p.locator('.today-card').count(), 'drawn:', await p.locator('.today-img[src]').count());
// swap
await p.locator('.today-card').first().locator('button:has-text("Swap")').tap();
await p.waitForTimeout(800);
await p.screenshot({ path: new URL('./shots/today-swap.png', import.meta.url).pathname });
const before = await p.locator('.today-card .today-text small').first().textContent();
await p.locator('.swap-alts button').first().tap();
await p.waitForTimeout(1200);
console.log('swap brands before/after:', before, '|', await p.locator('.today-card .today-text small').first().textContent());
// keep first, skip second
await p.locator('.today-card').first().locator('button:has-text("Keep")').tap();
await p.waitForSelector('.today-card .kept');
await p.locator('.today-card').nth(1).locator('button:has-text("Skip")').tap();
await p.waitForTimeout(400);
await p.screenshot({ path: new URL('./shots/today-kept.png', import.meta.url).pathname });
const fb = await p.evaluate(async () => { const r = indexedDB.open('ga-collage'); return null; });
console.log('look:', await p.evaluate(() => [window.ga.state.look.title, window.ga.state.look.items.map((i) => [i.category, i.brand, i.price, !!i.mask, !!i.src, Math.round(i.s)])]));
// export from today
await p.locator('.today-card').first().locator('button:has-text("Export")').tap();
await p.waitForSelector('.export-img'); await p.waitForTimeout(600);
await p.screenshot({ path: new URL('./shots/today-export.png', import.meta.url).pathname });
console.log('list:\n' + await p.locator('.list-text').textContent());
await p.tap('#sheet-left');
// touch up on a kept item works
await p.waitForTimeout(400);
await p.tap('#tabs button[data-tab=library]'); await p.waitForSelector('.lib-card'); console.log('library cards:', await p.locator('.lib-card').count());
await p.tap('#tabs button[data-tab=settings]'); await p.waitForTimeout(800);
await p.screenshot({ path: new URL('./shots/today-settings.png', import.meta.url).pathname, fullPage: true });
await b.close();
