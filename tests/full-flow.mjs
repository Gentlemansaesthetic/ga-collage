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
const gh = [];
await ctx.route('**/helper/**', async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.endsWith('/ping')) return route.fulfill({ json: { ok: true } });
  if (u.pathname.endsWith('/img')) { const f = u.searchParams.get('url').split('/').pop(); return route.fulfill({ body: fs.readFileSync(new URL('./fixtures/studio/' + f, import.meta.url)), contentType: 'image/jpeg' }); }
  return route.fulfill({ json: { ok: true, title: 'Suede bomber jacket', brand: 'Brunello Cucinelli', price: '4995.00', currency: 'USD', site: 'Shop', images: ['jacket', 'tee', 'sneaker', 'rolex', 'fragrance', 'pants'].map((f) => `https://cdn.shop.com/${f}.jpg`) } });
});
await ctx.route('https://api.github.com/**', async (route) => {
  const r = route.request(); gh.push(r.method() + ' ' + new URL(r.url()).pathname);
  if (r.method() === 'PUT') return route.fulfill({ json: { content: {} } });
  if (/\/repos\/[^/]+\/[^/]+$/.test(new URL(r.url()).pathname)) return route.fulfill({ json: { default_branch: 'main', permissions: { push: true } } });
  return route.fulfill({ status: 404, json: { message: 'Not Found' } });
});
const shot = (n) => p.screenshot({ path: new URL(`./shots/flow-${n}.png`, import.meta.url).pathname });
await p.goto('http://localhost:8080/index.html');
await p.waitForFunction(() => window.ga && window.ga.state.look);
// settings: helper + github
await p.tap('#tabs button[data-tab=settings]');
await p.fill('input[placeholder^="https://ga-helper"]', 'localhost:8080/helper');
await p.evaluate(() => { window.ga.state.settings.helperUrl = ''; });
await p.locator('.card:has-text("Link helper") .btn.primary').tap();
await p.waitForTimeout(500);
console.log('helper:', await p.locator('#helper-badge').textContent(), '|', await p.evaluate(() => window.ga.state.settings.helperUrl));
// the app forces https:// on bare hosts; for the local test point it back at http
await p.evaluate(() => { window.ga.state.settings.helperUrl = 'http://localhost:8080/helper'; });
await p.fill('input[placeholder^="yourname/"]', 'https://github.com/me/ga-looks');
await p.fill('input[type=password]', 'github_pat_x');
await p.locator('.card:has-text("Website backup") .btn.primary').tap();
await p.waitForTimeout(500);
console.log('github:', await p.locator('.card:has-text("Website backup") .note').last().textContent());
// copy helper code
await p.locator('text=Copy helper code').tap(); await p.waitForTimeout(400);
const code = await p.evaluate(() => navigator.clipboard.readText());
console.log('helper code copied:', code.length, 'has placeholder:', code.includes('__KEY__'), 'key ok:', code.includes(await p.evaluate(() => window.ga.state.settings.helperKey)));
// add from link via clipboard
await p.tap('#tabs button[data-tab=create]');
await p.evaluate(() => navigator.clipboard.writeText('https://www.shop.com/products/suede-bomber'));
await p.tap('#empty-add');
await p.locator('text=Paste link or copied photo').tap();
await p.waitForFunction(() => document.querySelector('#sheet-title').textContent === 'Choose the photo');
await p.waitForTimeout(800); await shot('pick');
await p.locator('.photo-grid button').first().tap();
await p.waitForFunction(() => document.querySelector('#sheet-title').textContent.startsWith('New item'), null, { timeout: 90000 });
await p.waitForTimeout(400); await shot('details');
console.log('prefill:', await p.evaluate(() => [...document.querySelectorAll('#sheet-body input, #sheet-body select')].map((e) => e.value).join(' | ')));
await p.tap('#sheet-right');
// two more through the fast path
for (const [f, name, brand] of [['pants_white', 'Pleated trousers', 'Loro Piana'], ['sneaker', 'Suede sneakers', 'Zegna'], ['watch', 'Drive watch', 'Cartier']]) {
  await p.evaluate(async ([f, name, brand]) => { const blob = await (await fetch(`/_t/out/${f}.isnet_fp16.png`)).blob(); window.__p = window.ga.processPhoto(blob, { name, brand, url: 'https://shop.com/' + f }); }, [f, name, brand]);
  await p.waitForFunction(() => document.querySelector('#sheet-title').textContent.startsWith('New item') && !document.querySelector('#sheet-wrap').classList.contains('hidden'));
  await p.tap('#sheet-right'); await p.evaluate(() => window.__p);
}
await p.fill('#look-title', 'Tan suede weekend'); await p.keyboard.press('Enter');
// select + drag the jacket
const box = await p.locator('#pin').boundingBox();
const it = await p.evaluate(() => { const i = window.ga.state.look.items[0]; return { x: i.x, y: i.y }; });
const sx = box.x + (it.x / 1000) * box.width, sy = box.y + (it.y / 1500) * box.height;
await p.mouse.move(sx, sy); await p.mouse.down(); await p.mouse.move(sx + 30, sy + 20, { steps: 5 }); await p.mouse.up();
await p.waitForTimeout(300); await shot('selected');
console.log('moved:', await p.evaluate(() => { const i = window.ga.state.look.items[0]; return [Math.round(i.x), Math.round(i.y), i.manual, window.ga.state.undo.length]; }));
console.log('tools:', await p.locator('#tools .tool span').allTextContents());
// touch up screen
await p.locator('#tools .tool:has-text("Touch up")').tap();
await p.waitForSelector('#touchup:not(.hidden)'); await p.waitForTimeout(400); await shot('touchup');
const tb = await p.locator('#tu-canvas').boundingBox();
await p.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await p.mouse.down(); await p.mouse.move(tb.x + tb.width / 2 + 40, tb.y + tb.height / 2, { steps: 4 }); await p.mouse.up();
await p.tap('#tu-undo'); await p.tap('#tu-cancel');
await p.locator('#tools .tool:has-text("Done")').tap();
// labels on, export
await p.locator('#tools .tool:has-text("Brands")').tap();
await p.tap('#btn-export');
await p.waitForSelector('.export-img'); await p.waitForTimeout(500); await shot('export');
console.log('list:\n' + await p.locator('.list-text').textContent());
await p.locator('#sheet-body button:has-text("Back up to GitHub")').tap();
await p.waitForFunction(() => /Backed up|GitHub/.test(document.querySelector('#sheet-body .note:last-child').textContent) && document.querySelector('#busy').classList.contains('hidden'), null, { timeout: 20000 });
console.log('backup:', await p.locator('#sheet-body .note').last().textContent(), '| PUTs:', gh.filter((x) => x.startsWith('PUT')).map((x) => x.split('/contents/')[1]).join(', '));
const png = await p.evaluate(async () => { const r = await fetch(document.querySelector('.export-img').src); return Array.from(new Uint8Array(await r.arrayBuffer())); });
fs.writeFileSync(new URL('./shots/flow-pin.png', import.meta.url), Buffer.from(png));
await p.tap('#sheet-left');
// library + reload persistence
await p.tap('#tabs button[data-tab=library]'); await p.waitForSelector('.lib-card'); await p.waitForTimeout(300); await shot('library');
await p.reload(); await p.waitForFunction(() => window.ga && window.ga.state.look && window.ga.state.look.items.length);
console.log('after reload:', await p.evaluate(() => [window.ga.state.look.title, window.ga.state.look.items.length, !!window.ga.state.look.syncedAt]));
await p.waitForTimeout(600); await shot('reloaded');
await b.close();
