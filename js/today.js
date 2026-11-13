// "Today": the outfits the nightly robot made. Keep the best, skip the rest, swap single pieces.
import { W, H, applyLayout } from './layouts.js';
import { renderLook } from './editor.js';
import { makeCanvas, canvasToBlob, loadImage } from './cutout.js';
import { readJson, writeJson, runWorkflow } from './github.js';

let app = null; // helpers handed over by app.js
const pool = new Map(); // pool item id -> Promise<{ bin, img, w, h }>
let day = null; // daily/latest.json
let status = null; // daily/status.json
let loading = null;

export function initToday(deps) { app = deps; }

// Where the robot publishes: the "data" branch of the app's own repository.
export function repoName() {
  const s = app.state.settings;
  if (s.ghRepo) return s.ghRepo;
  if (location.hostname.endsWith('.github.io')) return `${location.hostname.split('.')[0]}/${location.pathname.split('/')[1]}`;
  return '';
}
function dataBase() {
  const s = app.state.settings;
  if (s.dataUrl) return s.dataUrl.replace(/\/?$/, '/');
  const repo = repoName();
  return repo ? `https://raw.githubusercontent.com/${repo}/data/` : '';
}
const ghCfg = () => { const s = app.state.settings; return s.ghRepo && s.ghToken ? { repo: s.ghRepo, token: s.ghToken, branch: s.ghBranch || 'main' } : null; };

async function getJson(path) {
  const r = await fetch(dataBase() + path + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status === 404 ? 'none-yet' : 'HTTP ' + r.status);
  return r.json();
}

function poolItem(id) {
  if (!pool.has(id)) {
    const it = day.items[id];
    pool.set(id, (async () => {
      const r = await fetch(dataBase() + it.img);
      if (!r.ok) throw new Error('A product photo could not be loaded');
      const blob = new Blob([await r.arrayBuffer()], { type: 'image/webp' });
      const img = await loadImage(blob);
      const c = makeCanvas(img.width, img.height);
      c.getContext('2d').drawImage(img, 0, 0);
      if (img.close) img.close();
      return { bin: { buf: await blob.arrayBuffer(), type: 'image/webp' }, img: c, w: c.width, h: c.height };
    })());
    pool.get(id).catch(() => pool.delete(id));
  }
  return pool.get(id);
}

// ---------- feedback (what was kept / skipped), stored on the phone and shared with the robot ----------
async function feedback() { return (await app.db.kvGet('feedback')) || { kept: [], skipped: [], hidden: [] }; }
async function remember(kind, outfit) {
  const fb = await feedback();
  fb[kind] = fb[kind].filter((e) => e.outfit !== outfit.id);
  fb[kind].unshift({ date: day.date, outfit: outfit.id, items: outfit.items.map((id) => ({ id, brand: day.items[id].brand, colour: (day.items[id].colour || {}).name })) });
  fb[kind] = fb[kind].slice(0, 300);
  const other = kind === 'kept' ? 'skipped' : 'kept';
  fb[other] = fb[other].filter((e) => e.outfit !== outfit.id);
  await app.db.kvSet('feedback', fb);
  syncSoon();
}
let syncTimer = 0;
function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 15000); }
export async function sync() {
  clearTimeout(syncTimer);
  const cfg = ghCfg();
  if (!cfg || !(await app.db.kvGet('feedbackDirty'))) return;
  try {
    await writeJson(cfg, 'robot/feedback.json', await feedback(), 'Picks from the app');
    await app.db.kvDel('feedbackDirty');
  } catch (e) { console.warn('feedback sync', e); }
}
async function dirty() { await app.db.kvSet('feedbackDirty', 1); }

// ---------- outfit -> look ----------
async function buildItems(outfit) {
  const out = [];
  for (const id of outfit.items) {
    const p = day.items[id];
    const got = await poolItem(id);
    out.push({
      poolId: id, name: p.name, brand: p.brand, category: p.category, url: p.buy_url || p.url,
      price: app.money(p.price, p.currency), notes: '', flip: false, shadow: true,
      w: got.w, h: got.h, _img: got.img, _bin: got.bin,
    });
  }
  applyLayout(out, outfit.template || 0);
  return out;
}

async function preview(outfit) {
  const items = await buildItems(outfit);
  const bg = await app.bgImage(app.state.settings.lastBg || 'brown');
  const c = makeCanvas(W, H);
  renderLook(c.getContext('2d'), { items, labels: false, logo: true }, { bg, logo: app.state.assets.logo }, {});
  const s = makeCanvas(600, 900);
  const sx = s.getContext('2d');
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(c, 0, 0, 600, 900);
  return URL.createObjectURL(await canvasToBlob(s, 'image/jpeg', 0.86));
}

async function maskOf(img) {
  const m = makeCanvas(img.width, img.height);
  const x = m.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, m.width, m.height);
  return { buf: await (await canvasToBlob(m)).arrayBuffer(), type: 'image/png' };
}

async function keep(outfit) {
  const items = await buildItems(outfit);
  const look = app.blankLook();
  look.title = outfit.title || '';
  look.template = outfit.template || 0;
  look.daily = outfit.id;
  for (const it of items) {
    it.id = app.newId();
    it.cut = it._bin; it.src = it._bin; it.mask = await maskOf(it._img);
    delete it._img; delete it._bin;
  }
  look.items = items;
  await app.saveNow();
  await app.setLook(look);
  applyLayout(look.items, look.template);
  await app.saveNow();
  await remember('kept', outfit);
  await dirty();
  const kept = (await app.db.kvGet('keptToday')) || {};
  kept[outfit.id] = look.id;
  await app.db.kvSet('keptToday', kept);
  return look;
}

// ---------- screen ----------
export async function renderToday(force = false) {
  const box = document.querySelector('#today');
  const h = app.h;
  if (!dataBase()) {
    box.replaceChildren(blank('Daily outfits appear here once the app runs from its GitHub address.'));
    return;
  }
  if (force || !day) {
    if (!loading) {
      loading = (async () => {
        try {
          const [d, st] = await Promise.all([getJson('daily/latest.json'), getJson('daily/status.json').catch(() => null)]);
          if (!day || d.date !== day.date || d.made !== day.made) { day = d; pool.clear(); }
          status = st;
        } finally { loading = null; }
      })();
    }
    if (!day) box.replaceChildren(h('div', { class: 'blank' }, h('div', { class: 'spinner', style: 'margin:0 auto 14px' }), h('p', {}, 'Getting today’s outfits…')));
    try { await loading; } catch (e) {
      if (!day) {
        box.replaceChildren(blank(e.message === 'none-yet'
          ? 'The robot has not made any outfits yet. It runs every morning, or start it now from Settings → Daily outfits.'
          : 'Could not get today’s outfits. Check your signal and pull to try again.', true));
        return;
      }
    }
  }
  sync();
  const fb = await feedback();
  const kept = (await app.db.kvGet('keptToday')) || {};
  const skipped = new Set(fb.skipped.map((e) => e.outfit));
  const when = new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const shops = status ? status.sources.filter((s) => s.ok).length : 0;
  const total = status && status.pool ? Object.values(status.pool).reduce((a, b) => a + b, 0) : 0;
  const head = h('div', { class: 'today-head' },
    h('h2', {}, when),
    h('p', { class: 'note' }, `${day.outfits.length} outfits${total ? ` from ${total} pieces in ${shops} shop${shops === 1 ? '' : 's'}` : ''}. Keep the ones you like.`),
    status && status.notes && status.notes.length ? h('p', { class: 'note warn' }, status.notes.join(' ')) : null);
  const cards = day.outfits.map((o) => card(o, kept[o.id], skipped.has(o.id)));
  box.replaceChildren(head, ...cards, h('button', { class: 'btn ghost', style: 'margin-top:8px', onclick: () => renderToday(true) }, 'Check for new outfits'));
  // draw previews one at a time so the phone stays smooth
  for (const c of cards) { if (!box.contains(c)) break; await c.draw(); }
}

function blank(text, retry) {
  const h = app.h;
  return h('div', { class: 'blank' }, h('div', { class: 'empty-mark' }, 'GA'), h('p', {}, text),
    retry ? h('button', { class: 'btn auto', onclick: () => renderToday(true) }, 'Try again') : null);
}

// Title from the colours of the main piece and the trousers, like the robot does.
function titleOf(outfit) {
  const pick = (cats) => { for (const c of cats) { const id = outfit.items.find((i) => day.items[i].category === c); if (id) return day.items[id]; } return null; };
  const name = (it) => (it && it.colour && it.colour.name) || '';
  const a = name(pick(['outer', 'top', 'base'])), b = name(pick(['pants']));
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  return a && b && a !== b ? `${cap(a)} & ${b}` : cap(a || b || 'Daily') + ' tones';
}

function card(outfit, keptId, wasSkipped) {
  const h = app.h;
  const img = h('img', { alt: outfit.title || 'Outfit', class: 'today-img' });
  const title = h('b', {}, outfit.title || 'Outfit');
  const brands = h('small', {});
  const actions = h('div', { class: 'today-actions' });
  const el = h('article', { class: 'today-card' + (wasSkipped ? ' skipped' : '') },
    h('div', { class: 'today-pic' }, img),
    h('div', { class: 'today-text' }, title, brands),
    actions);
  let url = '';
  el.draw = async () => {
    brands.textContent = [...new Set(outfit.items.map((id) => day.items[id].brand).filter(Boolean))].join(' · ');
    title.textContent = outfit.title || 'Outfit';
    try {
      const u = await preview(outfit);
      if (url) URL.revokeObjectURL(url);
      url = u; img.src = u;
    } catch (e) { img.alt = 'Could not load this outfit'; el.classList.add('broken'); }
  };
  const setButtons = (state) => {
    if (state === 'kept') {
      actions.replaceChildren(
        h('span', { class: 'kept' }, 'Kept'),
        h('button', { class: 'pill', onclick: () => openKept(outfit) }, 'Edit'),
        h('button', { class: 'pill gold', onclick: () => openKept(outfit, true) }, 'Export'));
    } else {
      actions.replaceChildren(
        h('button', { class: 'pill', onclick: async () => {
          el.classList.add('skipped'); setButtons('skipped'); await remember('skipped', outfit); await dirty();
        } }, state === 'skipped' ? 'Skipped' : 'Skip'),
        h('button', { class: 'pill', onclick: () => swapSheet(outfit, el) }, 'Swap'),
        h('button', { class: 'pill gold', onclick: async () => {
          const d = app.busy('Keeping it…');
          try { await keep(outfit); el.classList.remove('skipped'); setButtons('kept'); app.toast('Kept. It is in your Library.'); }
          catch (e) { app.toast('Could not keep it: ' + (e.message || e), 4000); }
          finally { d(); }
        } }, 'Keep'));
    }
  };
  setButtons(keptId ? 'kept' : wasSkipped ? 'skipped' : '');
  return el;
}

async function openKept(outfit, exportNow) {
  const kept = (await app.db.kvGet('keptToday')) || {};
  const look = kept[outfit.id] && (await app.db.getLook(kept[outfit.id]));
  if (!look) return app.toast('It is no longer in your Library');
  await app.openLook(look);
  if (exportNow) app.exportSheet();
}

function swapSheet(outfit, el) {
  const h = app.h;
  const thumb = (id) => {
    const im = h('img', { alt: '' });
    poolItem(id).then((p) => { im.src = p.img.toDataURL('image/png'); }).catch(() => {});
    return im;
  };
  const rows = outfit.items.map((id, n) => {
    const p = day.items[id];
    const alts = (outfit.alts && outfit.alts[id]) || [];
    return h('div', { class: 'swap-row' },
      h('div', { class: 'swap-cur' }, thumb(id), h('div', {}, h('b', {}, p.name), h('small', {}, [p.brand, app.money(p.price, p.currency)].filter(Boolean).join(' · ')))),
      alts.length ? h('div', { class: 'swap-alts' }, alts.filter((a) => day.items[a]).map((a) => h('button', { onclick: () => {
        outfit.items[n] = a;
        outfit.alts[a] = [id, ...alts.filter((x) => x !== a)];
        delete outfit.alts[id];
        outfit.title = titleOf(outfit);
        app.dismissSheet();
        el.draw();
      } }, thumb(a)))) : h('p', { class: 'note' }, 'No other choices for this piece yet.'),
      h('button', { class: 'link small', onclick: async () => {
        if (!confirm(`Never use "${p.name}" again?`)) return;
        const fb = await feedback();
        fb.hidden = [...new Set([id, ...fb.hidden])];
        await app.db.kvSet('feedback', fb); await dirty(); syncSoon();
        if (alts[0] && day.items[alts[0]]) { outfit.items[n] = alts[0]; outfit.alts[alts[0]] = alts.slice(1); outfit.title = titleOf(outfit); el.draw(); }
        app.dismissSheet();
        app.toast('Got it. The robot will stop using it.');
      } }, 'Don’t use this piece again'));
  });
  app.openSheet({ title: 'Swap a piece', right: 'Done', onRight: app.dismissSheet, body: h('div', { class: 'stack' }, h('p', { class: 'note' }, 'Tap a choice to swap it in.'), ...rows) });
}

// ---------- robot settings (shops, outfits per day, run now) ----------
export async function robotSources() {
  const cfg = ghCfg();
  if (cfg) { try { const j = await readJson(cfg, 'robot/sources.json'); if (j) return { data: j, live: true }; } catch (e) { /* fall back */ } }
  try { return { data: await (await fetch('robot/sources.json', { cache: 'no-store' })).json(), live: false }; } catch (e) { return { data: null, live: false }; }
}
export async function saveSources(data) {
  const cfg = ghCfg();
  if (!cfg) throw new Error('Connect GitHub first (below).');
  await writeJson(cfg, 'robot/sources.json', data, 'Shop list from the app');
}
export async function robotStatus() { try { return await getJson('daily/status.json'); } catch (e) { return null; } }
export async function runRobot() {
  const cfg = ghCfg();
  if (!cfg) throw new Error('Connect GitHub first (below).');
  await runWorkflow(cfg, 'daily.yml', { restyle: 'true' });
}

// ---------- items pasted in the app join the robot's pool ----------
export async function shareWithRobot(it) {
  const cfg = ghCfg();
  if (!cfg || !it.name || !it._img) return;
  const { putFile, blobToBase64 } = await import('./github.js');
  const k = Math.min(1, 900 / Math.max(it.w, it.h));
  const s = makeCanvas(Math.round(it.w * k), Math.round(it.h * k));
  const sx = s.getContext('2d');
  sx.imageSmoothingQuality = 'high';
  sx.drawImage(it._img, 0, 0, s.width, s.height);
  const id = 'm-' + it.id.replace(/[^a-z0-9-]/gi, '').toLowerCase();
  await putFile(cfg, `pool/manual/${id}.png`, await blobToBase64(await canvasToBlob(s)), 'Item added in the app');
  const list = (await readJson(cfg, 'pool/manual.json')) || { items: [] };
  list.items = list.items.filter((x) => x.id !== id);
  list.items.push({ id, name: it.name, brand: it.brand || '', category: it.category, price: it.price || '', url: it.url || '', img: `pool/manual/${id}.png`, added: Math.round(Date.now() / 1000) });
  await writeJson(cfg, 'pool/manual.json', list, 'Item added in the app');
}
