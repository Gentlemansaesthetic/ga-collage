// Gentleman's Aesthetic - collage maker. Screens, storage and the add / export flows.
import { W, H, CATEGORIES, TEMPLATES, guessCategory, applyLayout, placeLoose } from './layouts.js';
import { Editor, renderLook } from './editor.js';
import * as db from './db.js';
import { makeCanvas, canvasToBlob, loadImage, toSourceCanvas, existingAlphaMask, autoMask, plainMask, fullMask, borderUniformity, composeCut, maskCoverage, preloadModel, tightenMask } from './cutout.js';
import { openTouchup } from './touchup.js';
import { testGithub, uploadLook } from './github.js';
import { initToday, renderToday, robotSources, saveSources, robotStatus, runRobot, shareWithRobot, repoName } from './today.js';

const MODEL = 'isnet_fp16';
const BUILTIN_BG = [['brown', 'Brown'], ['tan', 'Tan'], ['espresso', 'Espresso']];
const $ = (s, r = document) => r.querySelector(s);

// ---------- small helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  layout: '<rect x="4" y="4" width="7" height="9" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="11" width="7" height="9" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/>',
  bg: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 16l5-5 4 4 3-3 4 4"/>',
  tag: '<path d="M4 12V5a1 1 0 011-1h7l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  logo: '<path d="M5 20h14M8 16l4-11 4 11M9.5 12.5h5"/>',
  undo: '<path d="M8 5L4 9l4 4M4 9h10a5.5 5.5 0 010 11h-3"/>',
  list: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  brush: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  flip: '<path d="M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z"/>',
  shadow: '<circle cx="10" cy="10" r="6"/><path d="M17 9.5a6 6 0 01-7.5 9"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};
const tool = (icon, label, onclick, cls = '') => h('button', { class: 'tool ' + cls, onclick, html: `<svg viewBox="0 0 24 24">${ICON[icon]}</svg><span>${label}</span>` });

const toBin = async (blob) => ({ buf: await blob.arrayBuffer(), type: blob.type || 'image/png' });
const binBlob = (bin) => new Blob([bin.buf], { type: bin.type });
const pad = (n) => String(n).padStart(2, '0');
function newId() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 5)}`;
}
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function busy(text) {
  $('#busy').classList.remove('hidden');
  $('#busy-text').textContent = text;
  $('#busy-bar').style.width = '0%';
  const done = () => $('#busy').classList.add('hidden');
  done.text = (t) => { $('#busy-text').textContent = t; };
  done.bar = (p) => { $('#busy-bar').style.width = Math.round(p * 100) + '%'; };
  done.progress = (stage, p) => {
    if (stage === 'download') { done.text(`Downloading the cutout engine (first time only)… ${Math.round(p * 100)}%`); done.bar(p); }
    else if (stage === 'start') { done.text('Starting the cutout engine…'); done.bar(1); }
    else if (stage === 'cut') done.text(text);
  };
  return done;
}

// ---------- bottom sheet ----------
let sheetNow = null;
function openSheet(o) {
  if (sheetNow) dismissSheet();
  sheetNow = o;
  $('#sheet-title').textContent = o.title || '';
  const L = $('#sheet-left'), R = $('#sheet-right');
  L.textContent = o.left === undefined ? 'Close' : o.left;
  R.textContent = o.right || '';
  L.onclick = () => (o.onLeft ? o.onLeft() : dismissSheet());
  R.onclick = () => o.onRight && o.onRight();
  const body = $('#sheet-body');
  body.replaceChildren(...[].concat(o.body).filter(Boolean));
  body.scrollTop = 0;
  $('#sheet-wrap').classList.remove('hidden');
}
function dismissSheet() {
  const o = sheetNow;
  sheetNow = null;
  $('#sheet-wrap').classList.add('hidden');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (o && o.onClose) o.onClose();
}
$('#sheet-dim').addEventListener('click', dismissSheet);

function menuSheet(title, entries) {
  openSheet({
    title,
    body: h('div', { class: 'menu' }, entries.filter(Boolean).map(([label, fn, cls]) => h('button', { class: cls || '', onclick: () => { dismissSheet(); fn(); } }, label))),
  });
}

// ---------- state ----------
const state = { look: null, settings: {}, assets: { bg: null, logo: null }, undo: [], customBgs: [], bgCache: new Map(), tab: 'today' };
const editor = new Editor($('#pin'), {
  onSelect: () => renderTools(),
  onBefore: () => pushUndo(),
  onChange: () => saveSoon(),
});

function blankLook() {
  const now = Date.now();
  return { id: newId(), title: '', createdAt: now, updatedAt: now, bg: state.settings.lastBg || 'brown', template: 0, labels: false, logo: true, items: [] };
}

async function hydrate(it) {
  const img = await loadImage(binBlob(it.cut));
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  if (img.close) img.close();
  const oldW = it.w;
  it.w = c.width; it.h = c.height;
  if (oldW && it.s) it.s = (it.s * it.w) / oldW; // keep the same zoom if the cutout edge changed
  it._img = c;
  const mips = [c];
  let m = c;
  while (m.width > 180) {
    const n = makeCanvas(m.width / 2, m.height / 2);
    const x = n.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(m, 0, 0, n.width, n.height);
    mips.push(n);
    m = n;
  }
  it._mips = mips;
  const hw = Math.min(96, c.width), hh = Math.max(1, Math.round((c.height * hw) / c.width));
  const hc = makeCanvas(hw, hh);
  const hx = hc.getContext('2d');
  hx.drawImage(c, 0, 0, hw, hh);
  const d = hx.getImageData(0, 0, hw, hh).data;
  const a = new Uint8Array(hw * hh);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  it._hit = { a, w: hw, h: hh };
}
const strip = (it) => { const o = {}; for (const k in it) if (k[0] !== '_') o[k] = it[k]; return o; };

async function bgImage(id) {
  if (state.bgCache.has(id)) return state.bgCache.get(id);
  let img = null;
  try {
    if (id.startsWith('custom:')) {
      const bin = await db.kvGet('bg:' + id.slice(7));
      if (bin) img = await loadImage(binBlob(bin));
    } else {
      img = await loadImage(await (await fetch(`assets/bg-${id}.jpg`)).blob());
    }
  } catch (e) { /* fall back below */ }
  if (img) state.bgCache.set(id, img);
  return img;
}
async function loadBg() {
  let img = await bgImage(state.look.bg);
  if (!img) { state.look.bg = 'brown'; img = await bgImage('brown'); }
  state.assets.bg = img;
  editor.assets = state.assets;
  editor.draw();
}

async function setLook(look) {
  state.look = look;
  state.undo = [];
  for (const it of look.items) await hydrate(it);
  $('#look-title').value = look.title || '';
  editor.set(look, state.assets);
  await loadBg();
  renderTools();
  refreshEmpty();
  db.kvSet('current', look.id);
}
function refreshEmpty() { $('#empty').classList.toggle('hidden', state.look.items.length > 0); }

let saveTimer = 0;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 500); }
async function saveNow() {
  clearTimeout(saveTimer);
  const look = state.look;
  if (!look) return;
  if (!look.items.length && !look.saved) return; // do not fill the library with blank looks
  look.updatedAt = Date.now();
  look.saved = true;
  try {
    const full = makeCanvas(W, H);
    renderLook(full.getContext('2d'), look, state.assets, {});
    const t = makeCanvas(300, 450);
    const tx = t.getContext('2d');
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(full, 0, 0, 300, 450);
    look.thumb = await toBin(await canvasToBlob(t, 'image/jpeg', 0.82));
    await db.putLook({ ...look, items: look.items.map(strip) });
  } catch (e) {
    console.error(e);
    toast('Could not save on this phone: ' + (e.message || e), 5000);
  }
}

function pushUndo() {
  const l = state.look;
  state.undo.push({ bg: l.bg, template: l.template, labels: l.labels, logo: l.logo, items: l.items.map((i) => ({ ...i })) });
  if (state.undo.length > 30) state.undo.shift();
}
async function undo() {
  const s = state.undo.pop();
  if (!s) return;
  const l = state.look;
  Object.assign(l, { bg: s.bg, template: s.template, labels: s.labels, logo: s.logo, items: s.items });
  editor.selected = null;
  await loadBg();
  changed();
}
function changed() { editor.draw(); renderTools(); refreshEmpty(); saveSoon(); }

// ---------- toolbar ----------
function renderTools() {
  const l = state.look, sel = editor.selected, bar = $('#tools');
  if (!l) return;
  if (sel) {
    bar.replaceChildren(
      tool('list', 'Details', () => detailsSheet(sel, false)),
      tool('brush', 'Touch up', () => touchUp(sel).then((ok) => ok && changed())),
      tool('up', 'Forward', () => reorder(sel, 1)),
      tool('down', 'Back', () => reorder(sel, -1)),
      tool('flip', 'Flip', () => { pushUndo(); sel.flip = !sel.flip; changed(); }),
      tool('shadow', 'Shadow', () => { pushUndo(); sel.shadow = sel.shadow === false; changed(); }, sel.shadow !== false ? 'on' : ''),
      tool('copy', 'Copy', () => duplicateItem(sel)),
      tool('trash', 'Remove', () => { pushUndo(); l.items = l.items.filter((i) => i !== sel); editor.selected = null; changed(); }, 'danger'),
      h('span', { class: 'sep' }),
      tool('check', 'Done', () => { editor.select(null); }, 'on'),
    );
  } else {
    const u = tool('undo', 'Undo', undo);
    u.disabled = !state.undo.length;
    bar.replaceChildren(
      tool('plus', 'Add item', addItemSheet, 'primary'),
      tool('layout', 'Layout', nextLayout),
      tool('bg', 'Backdrop', backgroundSheet),
      tool('tag', 'Brands', () => { pushUndo(); l.labels = !l.labels; changed(); }, l.labels ? 'on' : ''),
      tool('logo', 'Logo', () => { pushUndo(); l.logo = l.logo === false; changed(); }, l.logo !== false ? 'on' : ''),
      u,
    );
  }
}
function nextLayout() {
  const l = state.look;
  if (!l.items.length) return toast('Add an item first');
  pushUndo();
  const fresh = l.items.some((i) => i.manual) && !l.cycled;
  l.template = fresh ? l.template : (l.template + 1) % TEMPLATES.length;
  l.cycled = true;
  const name = applyLayout(l.items, l.template);
  toast(`Layout ${l.template + 1} of ${TEMPLATES.length}: ${name}`, 1600);
  changed();
}
function reorder(it, dir) {
  const l = state.look;
  const sorted = l.items.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  const i = sorted.indexOf(it), j = i + dir;
  if (j < 0 || j >= sorted.length) return toast(dir > 0 ? 'Already on top' : 'Already at the back', 1400);
  pushUndo();
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  sorted.forEach((x, k) => { x.z = k; });
  changed();
}
function duplicateItem(it) {
  pushUndo();
  const c = { ...it, id: newId(), x: Math.min(W - 40, it.x + 60), y: Math.min(H - 40, it.y + 60), z: Math.max(...state.look.items.map((i) => i.z || 0)) + 1, manual: true };
  state.look.items.push(c);
  editor.select(c);
  changed();
}

// ---------- cutting out ----------
async function cutAuto(src, onProgress) {
  if (state.settings.engine === 'simple') {
    if (borderUniformity(src) >= 0.6) return { mask: tightenMask(plainMask(src)) };
    return { mask: fullMask(src.width, src.height), warn: 'Simple mode only cuts plain backgrounds. Use Touch up, or switch the engine to Smart in Settings.' };
  }
  await db.kvSet('cutting', Date.now()); // if the phone closes the app mid-way we notice next time
  try {
    const r = await autoMask(src, MODEL, onProgress);
    return { mask: tightenMask(r.mask) }; // shave the pale fringe product photos leave on dark backdrops
  } catch (e) {
    console.error(e);
    return { mask: fullMask(src.width, src.height), warn: 'The automatic cutout did not work for this photo. Use Touch up to fix it.' };
  } finally {
    await db.kvDel('cutting');
  }
}

// photo (Blob) -> new item. Shows the details form; resolves true if the item was added.
async function processPhoto(blob, meta = {}, count = '') {
  const done = busy('Cutting out…' + (count ? ` (${count})` : ''));
  let item;
  try {
    const src = await toSourceCanvas(blob);
    let mask = existingAlphaMask(src), warn = '';
    const hadAlpha = !!mask;
    if (!mask) ({ mask, warn = '' } = await cutAuto(src, done.progress));
    let cut = composeCut(src, mask);
    if (!cut || maskCoverage(mask) < 0.01) {
      mask = fullMask(src.width, src.height);
      cut = composeCut(src, mask);
      warn = 'Could not find the product automatically. Use Touch up to cut it out.';
    }
    const keepOriginal = blob.size <= 4e6 && /image\/(jpeg|png|webp)/.test(blob.type);
    const srcBlob = keepOriginal ? blob : await canvasToBlob(src, hadAlpha ? 'image/png' : 'image/jpeg', 0.93);
    const name = meta.name || '';
    item = {
      id: newId(), name, brand: meta.brand || '', url: meta.url || '', price: meta.price || '', notes: '',
      category: guessCategory(name + ' ' + (meta.url || '')),
      src: await toBin(srcBlob), mask: await toBin(await canvasToBlob(mask)), cut: await toBin(await canvasToBlob(cut)),
      flip: false, shadow: true,
    };
    await hydrate(item);
    if (warn) setTimeout(() => toast(warn, 5000), 300);
  } catch (e) {
    console.error(e);
    done();
    toast('That photo could not be opened: ' + (e.message || e), 4500);
    return false;
  }
  done();
  return detailsSheet(item, true, count);
}

async function touchUp(it) {
  const done = busy('Opening…');
  let src, mask;
  try {
    src = await toSourceCanvas(binBlob(it.src));
    const m = await loadImage(binBlob(it.mask));
    mask = makeCanvas(src.width, src.height);
    mask.getContext('2d').drawImage(m, 0, 0, src.width, src.height);
  } finally { done(); }
  const out = await openTouchup({ src, mask, bg: state.assets.bg, model: MODEL, busy });
  if (!out) return false;
  const cut = composeCut(src, out);
  if (!cut) { toast('Nothing was left of the photo, so the change was not kept.', 3500); return false; }
  if (state.look.items.includes(it)) pushUndo();
  it.mask = await toBin(await canvasToBlob(out));
  it.cut = await toBin(await canvasToBlob(cut));
  await hydrate(it);
  return true;
}

// ---------- item details ----------
function detailsSheet(it, isNew, count = '') {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const img = h('img', { alt: '' });
    let url = '';
    const show = () => { if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(binBlob(it.cut)); img.src = url; };
    show();
    const f = {
      name: h('input', { value: it.name || '', placeholder: 'Cashmere half-zip sweater', autocomplete: 'off' }),
      brand: h('input', { value: it.brand || '', placeholder: 'Loro Piana', autocomplete: 'off' }),
      url: h('input', { value: it.url || '', placeholder: 'https://…', type: 'url', inputMode: 'url', autocomplete: 'off', autocapitalize: 'off' }),
      price: h('input', { value: it.price || '', placeholder: '$450', autocomplete: 'off' }),
      category: h('select', {}, CATEGORIES.map((c) => h('option', { value: c.id, selected: c.id === it.category }, c.label))),
      notes: h('textarea', { value: it.notes || '', placeholder: 'Optional. Colour, size advice, affiliate code…' }),
    };
    f.name.addEventListener('change', () => { if (isNew && f.category.value === 'other') f.category.value = guessCategory(f.name.value); });
    const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
    const save = () => {
      const typeChanged = it.category !== f.category.value;
      if (!isNew) pushUndo();
      Object.assign(it, { name: f.name.value.trim(), brand: f.brand.value.trim(), url: f.url.value.trim(), price: f.price.value.trim(), category: f.category.value, notes: f.notes.value.trim() });
      const l = state.look;
      if (isNew) {
        pushUndo();
        l.items.push(it);
        shareWithRobot(it).catch((e) => console.warn('robot pool', e));
        if (l.items.every((i) => i === it || !i.manual)) applyLayout(l.items, l.template); else placeLoose(it, l.items);
      } else if (typeChanged && l.items.every((i) => !i.manual)) applyLayout(l.items, l.template);
      finish(true);
      dismissSheet();
      changed();
    };
    openSheet({
      title: isNew ? 'New item' + (count ? ` (${count})` : '') : 'Item details',
      left: 'Cancel', right: isNew ? 'Add' : 'Save', onRight: save,
      onClose: () => { if (url) URL.revokeObjectURL(url); finish(false); },
      body: h('div', { class: 'stack' },
        h('div', { class: 'cut-preview' }, img, h('button', { onclick: async () => { if (await touchUp(it)) { show(); if (!isNew) changed(); } } }, 'Touch up cutout')),
        field('Type (decides where it sits in the layout)', f.category),
        field('Name', f.name), field('Brand', f.brand), field('Link to the product', f.url), field('Price', f.price), field('Notes', f.notes),
        h('button', { class: 'btn primary', onclick: save }, isNew ? 'Add to look' : 'Save'),
      ),
    });
  });
}

// ---------- add item ----------
const helperReady = () => !!(state.settings.helperUrl && state.settings.helperKey);
const helperUrl = (path, params) => `${state.settings.helperUrl}${path}?key=${encodeURIComponent(state.settings.helperKey)}&${new URLSearchParams(params)}`;
const looksLikeLink = (s) => /^https?:\/\/\S+\.\S+/i.test(String(s || '').trim());
const MONEY = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', JPY: '¥', CHF: 'CHF ' };
const money = (p, c) => ((p = String(p || '').replace(/\.00$/, '')) ? (MONEY[c] !== undefined ? MONEY[c] + p : c ? `${p} ${c}` : String(p)) : '');

function addItemSheet() {
  const input = h('input', { class: 'input', placeholder: 'https://shop.com/product…', type: 'url', inputMode: 'url', autocapitalize: 'off', autocomplete: 'off', enterKeyHint: 'go' });
  const msg = h('p', { class: 'note' });
  const go = () => {
    const v = input.value.trim();
    if (!looksLikeLink(v)) { msg.className = 'note warn'; msg.textContent = 'Paste the full link of a product page (it starts with https://).'; return; }
    fromLink(v);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const paste = async () => {
    try {
      if (navigator.clipboard.read) {
        for (const ci of await navigator.clipboard.read()) {
          const t = ci.types.find((x) => x.startsWith('image/'));
          if (t) { dismissSheet(); return processPhoto(await ci.getType(t)); }
          if (ci.types.includes('text/plain')) {
            const txt = (await (await ci.getType('text/plain')).text()).trim();
            if (looksLikeLink(txt)) { input.value = txt; return go(); }
          }
        }
      } else {
        const txt = (await navigator.clipboard.readText()).trim();
        if (looksLikeLink(txt)) { input.value = txt; return go(); }
      }
      msg.className = 'note warn';
      msg.textContent = 'Nothing to paste yet. In Safari, copy a product page link (Share, then Copy) or hold a photo and tap Copy, then come back.';
    } catch (e) {
      msg.className = 'note';
      msg.textContent = 'Hold your finger on the box below and choose Paste.';
      input.focus();
    }
  };
  if (!helperReady()) msg.innerHTML = 'Links need the free link helper. Set it up once in <b>Settings</b>. Until then, copy a photo in Safari and tap Paste, or pick from Photos.';
  openSheet({
    title: 'Add item',
    body: h('div', { class: 'stack' },
      h('button', { class: 'btn primary', onclick: paste }, 'Paste link or copied photo'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, input), h('button', { class: 'btn auto', onclick: go }, 'Find')),
      msg,
      h('div', { class: 'or' }, 'or'),
      h('button', { class: 'btn', onclick: () => $('#file-photos').click() }, 'Choose from Photos'),
      h('p', { class: 'note' }, 'Product photos on a plain background give the cleanest cutouts.'),
    ),
  });
}

$('#file-photos').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  dismissSheet();
  for (let i = 0; i < files.length; i++) await processPhoto(files[i], {}, files.length > 1 ? `${i + 1} of ${files.length}` : '');
});

async function fromLink(link) {
  if (!helperReady()) {
    return openSheet({ title: 'Link helper needed', body: h('div', { class: 'stack' },
      h('p', { class: 'note' }, 'To read product pages, the app needs its free link helper. It takes about five minutes to set up, once.'),
      h('button', { class: 'btn primary', onclick: () => { dismissSheet(); showTab('settings'); } }, 'Open Settings')) });
  }
  const done = busy('Reading the product page…');
  try {
    if (/\.(jpe?g|png|webp|avif)(\?|#|$)/i.test(link)) {
      const blob = await fetchPhoto(link, link);
      done(); dismissSheet();
      return processPhoto(blob, {});
    }
    const r = await fetch(helperUrl('/', { url: link }));
    const j = await r.json();
    done();
    if (!j.ok) return linkProblem(j.error || 'The page could not be read.');
    pickPhotoSheet(j, link);
  } catch (e) {
    done();
    linkProblem('The link helper did not answer. Check your signal, or the helper address in Settings.');
  }
}
function linkProblem(text) {
  openSheet({ title: 'Could not get photos', body: h('div', { class: 'stack' },
    h('p', { class: 'note warn' }, text),
    h('p', { class: 'note' }, 'Plan B: open the product in Safari, hold your finger on the photo, tap Copy, then use Paste here. Or save the photo and choose it from Photos.'),
    h('button', { class: 'btn primary', onclick: addItemSheet }, 'Back')) });
}
async function fetchPhoto(src, ref) {
  const r = await fetch(helperUrl('/img', { url: src, ref }));
  if (!r.ok) throw new Error('The shop did not hand over that photo');
  return r.blob();
}
function pickPhotoSheet(info, link) {
  const meta = { name: info.title || '', brand: info.brand || '', price: money(info.price, info.currency), url: link };
  const grid = h('div', { class: 'photo-grid' }, info.images.map((src) => {
    const b = h('button', { onclick: async () => {
      const done = busy('Getting the photo…');
      try {
        const blob = await fetchPhoto(src, link);
        done(); dismissSheet();
        await processPhoto(blob, meta);
      } catch (e) { done(); toast(e.message || 'That photo could not be loaded', 3500); }
    } });
    const im = h('img', { loading: 'lazy', alt: '', src: helperUrl('/img', { url: src, ref: link }) });
    im.onerror = () => b.classList.add('bad');
    im.onload = () => { if (im.naturalWidth < 180 || im.naturalHeight < 180) b.classList.add('bad'); };
    b.append(im);
    return b;
  }));
  openSheet({
    title: 'Choose the photo', left: 'Back', onLeft: addItemSheet,
    body: h('div', { class: 'stack' },
      h('p', { class: 'note' }, h('b', {}, meta.name || info.site || ''), meta.brand ? ' · ' + meta.brand : '', meta.price ? ' · ' + meta.price : ''),
      h('p', { class: 'note' }, 'Tap the photo that shows the product alone on a plain background.'),
      grid),
  });
}

// ---------- background ----------
function backgroundSheet() {
  const l = state.look;
  const pick = async (id) => {
    pushUndo();
    l.bg = id;
    state.settings.lastBg = id;
    db.kvSet('settings', state.settings);
    await loadBg();
    changed();
    dismissSheet();
  };
  const tiles = BUILTIN_BG.map(([id, label]) => h('button', { class: l.bg === id ? 'on' : '', title: label, style: `background-image:url(assets/bg-${id}.jpg)`, onclick: () => pick(id) }));
  for (const id of state.customBgs) {
    const key = 'custom:' + id;
    const b = h('button', { class: l.bg === key ? 'on' : '', onclick: () => pick(key) });
    db.kvGet('bg:' + id).then((bin) => { if (bin) b.style.backgroundImage = `url(${URL.createObjectURL(binBlob(bin))})`; });
    tiles.push(b);
  }
  tiles.push(h('button', { class: 'add', onclick: () => { bgAfter = backgroundSheet; $('#file-bg').click(); } }, '+'));
  openSheet({ title: 'Backdrop', body: h('div', { class: 'stack' }, h('div', { class: 'bg-grid' }, tiles), h('p', { class: 'note' }, 'Tap + to add your own backdrop photo. Remove your own backdrops in Settings.')) });
}
let bgAfter = null;
$('#file-bg').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const img = await loadImage(file);
    const c = makeCanvas(W, H);
    const k = Math.max(W / img.width, H / img.height);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
    const id = newId();
    await db.kvSet('bg:' + id, await toBin(await canvasToBlob(c, 'image/jpeg', 0.9)));
    state.customBgs.push(id);
    await db.kvSet('bgs', state.customBgs);
    toast('Backdrop added');
  } catch (err) { toast('That image could not be opened'); }
  if (bgAfter) bgAfter();
  if (state.tab === 'settings') renderSettings();
});

// ---------- export ----------
function lookData(look) {
  return {
    id: look.id, title: look.title || 'Untitled look', createdAt: new Date(look.createdAt).toISOString(), updatedAt: new Date(look.updatedAt).toISOString(), image: 'pin.jpg',
    items: look.items.map((i, n) => ({ name: i.name || '', brand: i.brand || '', category: i.category, price: i.price || '', url: i.url || '', notes: i.notes || '', image: `items/${n + 1}.png` })),
  };
}
function listText(look) {
  const lines = [look.title || 'Untitled look', ''];
  look.items.forEach((i, n) => {
    lines.push(`${n + 1}. ${[i.brand, i.name || CATEGORIES.find((c) => c.id === i.category).label, i.price].filter(Boolean).join(' - ')}`);
    if (i.url) lines.push('   ' + i.url);
  });
  return lines.join('\n');
}
async function shareFiles(files, text) {
  try {
    if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, ...(text ? { text } : {}) }); return true; }
  } catch (e) {
    if (e.name === 'AbortError') return false;
  }
  for (const f of files) {
    const a = h('a', { href: URL.createObjectURL(f), download: f.name });
    document.body.append(a); a.click(); a.remove();
  }
  return true;
}
// Address of the look's "Shop this look" page (served by GitHub Pages from the same repository).
function lookLink(look) {
  const repo = state.settings.ghRepo || '';
  const [owner, name] = repo.split('/');
  const base = location.hostname.endsWith('.github.io') ? location.origin + '/' + location.pathname.split('/')[1] : `https://${(owner || '').toLowerCase()}.github.io/${name || ''}`;
  return `${base}/site/#${look.id}`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}

async function exportSheet() {
  const look = state.look;
  if (!look.items.length) return toast('Add an item first');
  editor.select(null);
  await saveNow();
  const done = busy('Preparing your pin…');
  let png;
  const c = makeCanvas(W, H);
  try {
    renderLook(c.getContext('2d'), look, state.assets, {});
    png = await canvasToBlob(c, 'image/png');
  } finally { done(); }
  const name = slug(look.title) || look.id;
  const file = new File([png], name + '.png', { type: 'image/png' });
  const url = URL.createObjectURL(png);
  const text = listText(look);
  const missing = look.items.filter((i) => !i.url).length;
  const gh = state.settings.ghRepo && state.settings.ghToken;
  const ghMsg = h('p', { class: 'note' }, gh ? (look.syncedAt ? 'Published ' + fmtDate(look.syncedAt) + '. Link for the pin: ' + lookLink(look) : 'Puts this look on your "Shop this look" page and copies its link for Pinterest.') : 'Tip: connect GitHub in Settings to put looks on your "Shop this look" page.');
  const ghBtn = gh && h('button', { class: 'btn', onclick: async () => {
    const d = busy('Backing up…');
    try {
      const jpg = await canvasToBlob(c, 'image/jpeg', 0.92);
      const imgs = [];
      for (let n = 0; n < look.items.length; n++) {
        const it = look.items[n], k = Math.min(1, 700 / Math.max(it.w, it.h));
        const s = makeCanvas(it.w * k, it.h * k);
        const sx = s.getContext('2d');
        sx.imageSmoothingQuality = 'high';
        sx.drawImage(it._img, 0, 0, s.width, s.height);
        imgs.push({ path: `items/${n + 1}.png`, blob: await canvasToBlob(s) });
      }
      await uploadLook({ repo: state.settings.ghRepo, token: state.settings.ghToken, branch: state.settings.ghBranch }, lookData(look), jpg, imgs, (label, p) => { d.text('Backing up… ' + label); d.bar(p); });
      look.syncedAt = Date.now();
      await saveNow();
      ghMsg.className = 'note ok';
      ghMsg.textContent = 'Published. Link for the pin: ' + lookLink(look);
      if (await copyText(lookLink(look))) toast('Pin link copied');
    } catch (e) {
      ghMsg.className = 'note warn';
      ghMsg.textContent = e.message || String(e);
    } finally { d(); }
  } }, 'Publish to Shop this look');
  openSheet({
    title: 'Export',
    onClose: () => URL.revokeObjectURL(url),
    body: h('div', { class: 'stack' },
      h('img', { class: 'export-img', src: url, alt: 'Your pin' }),
      h('button', { class: 'btn primary', onclick: async () => { if (await shareFiles([file])) toast('In the share menu, choose Save Image', 3200); } }, 'Save or share the pin'),
      h('p', { class: 'note' }, 'Pin size 1000 × 1500. It is also kept in your Library.'),
      h('div', { class: 'or' }, 'Item list'),
      h('pre', { class: 'list-text' }, text),
      missing ? h('p', { class: 'note warn' }, `${missing} item${missing > 1 ? 's have' : ' has'} no link yet. Tap an item, then Details, to add it.`) : null,
      h('button', { class: 'btn', onclick: async () => toast((await copyText(text)) ? 'Item list copied' : 'Hold the list to copy it') }, 'Copy item list'),
      ghBtn, ghMsg,
    ),
  });
}

// ---------- library ----------
const thumbUrls = [];
async function renderLibrary() {
  thumbUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const box = $('#library');
  const looks = await db.allLooks();
  if (!looks.length) {
    box.replaceChildren(h('div', { class: 'blank' }, h('div', { class: 'empty-mark' }, 'GA'), h('p', {}, 'Your finished looks will appear here, with their item lists.')));
    return;
  }
  box.replaceChildren(h('div', { class: 'lib-grid' }, looks.map((l) => {
    let pic = h('div', { class: 'ph' });
    if (l.thumb) { const u = URL.createObjectURL(binBlob(l.thumb)); thumbUrls.push(u); pic = h('img', { src: u, alt: '' }); }
    return h('button', { class: 'lib-card', onclick: () => lookMenu(l) }, pic, h('b', {}, l.title || 'Untitled look'),
      h('small', {}, `${l.items.length} item${l.items.length === 1 ? '' : 's'} · ${fmtDate(l.updatedAt)}`, l.syncedAt ? h('i', {}, ' · backed up') : null));
  })));
}
async function openLook(l) {
  await saveNow();
  const d = busy('Opening…');
  try { await setLook(l); } finally { d(); }
  showTab('create');
}
function lookMenu(l) {
  menuSheet(l.title || 'Untitled look', [
    ['Open', () => openLook(l)],
    ['Make a copy', async () => {
      const now = Date.now();
      await db.putLook({ ...l, id: newId(), title: (l.title || 'Untitled look') + ' copy', createdAt: now, updatedAt: now, syncedAt: null, items: l.items.map((i) => ({ ...i, id: newId() })) });
      renderLibrary();
    }],
    ['Copy item list', async () => toast((await copyText(listText(l))) ? 'Item list copied' : 'Could not copy')],
    ['Delete', async () => {
      if (!confirm(`Delete "${l.title || 'Untitled look'}" from this phone?`)) return;
      await db.deleteLook(l.id);
      if (state.look.id === l.id) await setLook(blankLook());
      renderLibrary();
    }, 'danger'],
  ]);
}
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
async function exportAll() {
  await saveNow();
  const looks = await db.allLooks();
  if (!looks.length) return toast('Nothing to export yet');
  const rows = [['look_id', 'look_title', 'date', 'item_name', 'brand', 'type', 'price', 'link', 'notes']];
  for (const l of looks) for (const i of l.items) rows.push([l.id, l.title || '', new Date(l.updatedAt).toISOString().slice(0, 10), i.name, i.brand, i.category, i.price, i.url, i.notes]);
  const csv = new File(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], 'ga-looks.csv', { type: 'text/csv' });
  const json = new File([JSON.stringify(looks.map(lookData), null, 2)], 'ga-looks.json', { type: 'application/json' });
  menuSheet('Export all item lists', [
    ['Spreadsheet (opens in Numbers, Excel, Google Sheets)', () => shareFiles([csv])],
    ['Data file for a website (JSON)', () => shareFiles([json])],
  ]);
}

// ---------- settings ----------
let workerCode = '';
function helperCode() { return workerCode.replace("'__KEY__'", `'${state.settings.helperKey}'`); }
async function saveSettings() { await db.kvSet('settings', state.settings); }
const cleanUrl = (v) => { v = v.trim().replace(/\/+$/, ''); if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v; return v; };

// "Daily outfits" settings: the shops the robot visits, how many outfits, run it now.
function dailyCard() {
  const s = state.settings;
  const connected = !!(s.ghRepo && s.ghToken && s.ghOk);
  const list = h('div', { class: 'shop-list' }, h('p', { class: 'note' }, 'Loading…'));
  const msg = h('p', { class: 'note' });
  const perDay = h('select', {}, [3, 5, 10, 15, 20].map((n) => h('option', { value: n }, n + ' a day')));
  const addIn = h('input', { placeholder: 'https://shopname.com', type: 'url', inputMode: 'url', autocapitalize: 'off', autocomplete: 'off' });
  let src = null;
  const lastRun = h('p', { class: 'note' });
  const save = async (text) => {
    msg.className = 'note'; msg.textContent = 'Saving…';
    try { await saveSources(src); msg.className = 'note ok'; msg.textContent = text || 'Saved. The robot uses it from its next run.'; }
    catch (e) { msg.className = 'note warn'; msg.textContent = e.message || String(e); }
  };
  const draw = (st) => {
    const by = new Map(((st && st.sources) || []).map((x) => [x.name, x]));
    list.replaceChildren(...src.shops.map((shop) => {
      const r = by.get(shop.name);
      const info = !shop.on ? 'Paused' : !r ? 'Not visited yet' : r.ok ? `${r.usable} pieces found${r.new ? `, ${r.new} new last run` : ''}` : r.error;
      return h('div', { class: 'shop' + (r && !r.ok && shop.on ? ' bad' : '') },
        h('div', { class: 'grow' }, h('b', {}, shop.name), h('small', {}, info)),
        connected ? h('button', { class: 'link', onclick: async () => { shop.on = !shop.on; draw(st); await save(); } }, shop.on ? 'Pause' : 'Resume') : null,
        connected ? h('button', { class: 'link danger', onclick: async () => { if (!confirm(`Stop visiting ${shop.name}?`)) return; src.shops = src.shops.filter((x) => x !== shop); draw(st); await save(); } }, 'Remove') : null);
    }));
    perDay.value = String(src.outfits_per_day || 10);
  };
  (async () => {
    const [{ data }, st] = await Promise.all([robotSources(), robotStatus()]);
    if (!data) { list.replaceChildren(h('p', { class: 'note warn' }, 'Could not load the shop list. Check your signal.')); return; }
    src = data;
    draw(st);
    if (st) {
      const total = Object.values(st.pool || {}).reduce((a, b) => a + b, 0);
      lastRun.textContent = `Last run ${fmtDate(st.ran_at * 1000)}: ${st.outfits} outfits from ${total} pieces.` + (st.notes && st.notes.length ? ' ' + st.notes.join(' ') : '');
    } else lastRun.textContent = 'The robot has not run yet.';
  })();
  perDay.onchange = async () => { if (!src) return; src.outfits_per_day = +perDay.value; await save('Saved. Tomorrow brings ' + perDay.value + ' outfits.'); };
  return h('div', { class: 'card stack' },
    h('h3', {}, 'Daily outfits'),
    h('p', { class: 'note' }, 'Every morning a free robot on GitHub visits these shops, cuts out new pieces and puts together outfits for the Today tab.'),
    lastRun,
    h('label', { class: 'field' }, h('span', {}, 'How many outfits'), perDay),
    h('div', { class: 'or' }, 'Shops the robot visits'),
    list,
    connected ? h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'Add a shop (its web address)'), addIn),
      h('button', { class: 'btn', onclick: async () => {
        const url = cleanUrl(addIn.value);
        if (!src || !/^https:\/\/[^/]+\.[^/]+/.test(url)) return toast('Paste the shop’s web address');
        const host = new URL(url).hostname.replace(/^www\./, '');
        const name = host.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        if (src.shops.some((x) => x.url.replace(/^https?:\/\/(www\.)?/, '') === url.replace(/^https?:\/\/(www\.)?/, ''))) return toast('Already on the list');
        src.shops.push({ name, url: new URL(url).origin, type: 'shopify', currency: 'USD', on: true });
        addIn.value = '';
        draw(null);
        await save('Added. The robot checks it in a few minutes and shows here whether it works.');
      } }, 'Add shop'),
      h('button', { class: 'btn primary', onclick: async () => {
        msg.className = 'note'; msg.textContent = 'Starting…';
        try { await runRobot(); msg.className = 'note ok'; msg.textContent = 'Started. New outfits arrive in Today in about 10 to 30 minutes.'; }
        catch (e) { msg.className = 'note warn'; msg.textContent = e.message || String(e); }
      } }, 'Make new outfits now'))
      : h('p', { class: 'note' }, 'To change the list or run the robot now, connect GitHub below.'),
    msg);
}

function renderSettings() {
  const s = state.settings;
  const box = $('#settings');
  const cards = [];
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!standalone) {
    cards.push(h('div', { class: 'card' }, h('h3', {}, 'Put it on your Home Screen'),
      h('ol', { html: '<li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>.</li>' }),
      h('p', { class: 'note' }, 'It then opens full screen like any other app, and your looks stay saved on this phone.')));
  }

  cards.push(dailyCard());

  // Link helper
  const hUrl = h('input', { value: s.helperUrl || '', placeholder: 'https://ga-helper.yourname.workers.dev', type: 'url', inputMode: 'url', autocapitalize: 'off', autocomplete: 'off' });
  const hMsg = h('p', { class: 'note' });
  const codeBox = h('textarea', { class: 'input hidden', readOnly: true, rows: 5 });
  const testHelper = async () => {
    s.helperUrl = cleanUrl(hUrl.value);
    hUrl.value = s.helperUrl;
    await saveSettings();
    if (!s.helperUrl) { s.helperOk = false; await saveSettings(); return renderSettings(); }
    hMsg.className = 'note'; hMsg.textContent = 'Checking…';
    try {
      const j = await (await fetch(helperUrl('/ping', {}))).json();
      s.helperOk = !!j.ok;
      hMsg.className = j.ok ? 'note ok' : 'note warn';
      hMsg.textContent = j.ok ? 'Connected. You can now paste product links.' : (j.error || 'The helper answered, but something is off.');
    } catch (e) {
      s.helperOk = false;
      hMsg.className = 'note warn';
      hMsg.textContent = 'No answer from that address. Check it is copied in full and that the helper was deployed.';
    }
    await saveSettings();
    $('#helper-badge').className = s.helperOk ? 'ok' : '';
    $('#helper-badge').textContent = s.helperOk ? 'Connected' : 'Not set up';
  };
  cards.push(h('div', { class: 'card stack' },
    h('h3', {}, 'Link helper', h('em', { id: 'helper-badge', class: s.helperOk ? 'ok' : '' }, s.helperOk ? 'Connected' : 'Optional')),
    h('p', { class: 'note' }, 'Only needed for adding pieces by hand: paste a product link and choose from the photos on that page. It is a tiny free program that runs on your own Cloudflare account. One-time setup:'),
    h('ol', { html: '<li>Create a free account at <b>dash.cloudflare.com</b> (no card needed).</li><li>Go to <b>Workers &amp; Pages</b>, then <b>Create</b>, then <b>Start with Hello World</b>. Name it <b>ga-helper</b> and tap <b>Deploy</b>.</li><li>Tap <b>Edit code</b>, delete everything in the editor, and paste the helper code from the button below. Tap <b>Deploy</b>.</li><li>Copy the address shown (it ends in <b>workers.dev</b>) and paste it here.</li>' }),
    h('button', { class: 'btn', onclick: async () => {
      if (!workerCode) { try { workerCode = await (await fetch('worker/worker.js')).text(); } catch (e) {} }
      if (!workerCode) return toast('Needs a connection. Try again in a moment.');
      const ok = await copyText(helperCode());
      if (ok) return toast('Helper code copied');
      codeBox.value = helperCode(); codeBox.classList.remove('hidden'); codeBox.focus(); codeBox.select();
      toast('Select all of the text in the box and copy it', 4000);
    } }, 'Copy helper code'),
    codeBox,
    h('label', { class: 'field' }, h('span', {}, 'Helper address'), hUrl),
    h('button', { class: 'btn primary', onclick: testHelper }, 'Save and test'),
    hMsg));

  // GitHub connection
  const gRepo = h('input', { value: s.ghRepo || repoName(), placeholder: 'yourname/ga-collage', autocapitalize: 'off', autocomplete: 'off' });
  const gTok = h('input', { value: s.ghToken || '', placeholder: 'github_pat_…', type: 'password', autocapitalize: 'off', autocomplete: 'off' });
  const gMsg = h('p', { class: 'note' });
  cards.push(h('div', { class: 'card stack' },
    h('h3', {}, 'Connect GitHub', h('em', { class: s.ghOk ? 'ok' : '' }, s.ghOk ? 'Connected' : 'Not set up')),
    h('p', { class: 'note' }, 'Lets the app tell the robot which outfits you kept or skipped (so it learns your taste), change the shop list, reuse items you add by hand, and keep a copy of every exported look for your future "Shop this look" website.'),
    h('ol', { html: '<li>On github.com tap your picture, then <b>Settings</b>, <b>Developer settings</b>, <b>Personal access tokens</b>, <b>Fine-grained tokens</b>, <b>Generate new token</b>.</li><li>Name it <b>GA app</b>. Expiration: <b>No expiration</b> (or a year).</li><li>Repository access: <b>Only select repositories</b> → <b>ga-collage</b>.</li><li>Permissions → Repository permissions: <b>Contents</b>: Read and write, and <b>Actions</b>: Read and write.</li><li>Tap <b>Generate token</b>, copy it, and paste it here.</li>' }),
    h('label', { class: 'field' }, h('span', {}, 'Repository'), gRepo),
    h('label', { class: 'field' }, h('span', {}, 'Token (stays on this phone)'), gTok),
    h('button', { class: 'btn primary', onclick: async () => {
      s.ghRepo = gRepo.value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$|\/+$/g, '');
      s.ghToken = gTok.value.trim();
      gRepo.value = s.ghRepo;
      s.ghOk = false;
      if (s.ghRepo && s.ghToken) {
        gMsg.className = 'note'; gMsg.textContent = 'Checking…';
        try {
          s.ghBranch = await testGithub({ repo: s.ghRepo, token: s.ghToken });
          s.ghOk = true;
          gMsg.className = 'note ok'; gMsg.textContent = 'Connected.';
        } catch (e) { gMsg.className = 'note warn'; gMsg.textContent = e.message || String(e); }
      } else { gMsg.textContent = 'Not connected.'; }
      await saveSettings();
      if (s.ghOk) renderSettings();
    } }, 'Save and test'),
    gMsg));

  // Cutout engine
  const eMsg = h('p', { class: 'note' });
  const seg = (v, label) => h('button', { class: (s.engine || 'smart') === v ? 'on' : '', onclick: async () => { s.engine = v; await saveSettings(); renderSettings(); } }, label);
  cards.push(h('div', { class: 'card stack' },
    h('h3', {}, 'Cutout engine'),
    h('p', { class: 'note' }, 'Smart finds the product in any photo. It runs on the phone itself, so nothing is uploaded and nothing is redrawn. It needs a one-time 88 MB download. Simple only removes plain white or grey backgrounds, but is instant and light.'),
    h('div', {}, h('div', { class: 'seg' }, seg('smart', 'Smart'), seg('simple', 'Simple'))),
    (s.engine || 'smart') === 'smart' ? h('button', { class: 'btn', onclick: async () => {
      const d = busy('Getting the cutout engine ready…');
      try { await preloadModel(MODEL, d.progress); eMsg.className = 'note ok'; eMsg.textContent = 'Ready. Cutouts now also work without signal.'; }
      catch (e) { eMsg.className = 'note warn'; eMsg.textContent = 'Could not load it: ' + (e.message || e); }
      finally { d(); }
    } }, 'Download now (use Wi-Fi)') : null,
    eMsg));

  // Custom backdrops
  if (state.customBgs.length) {
    const tiles = state.customBgs.map((id) => {
      const b = h('button', {}, h('span', { class: 'x' }, '×'));
      db.kvGet('bg:' + id).then((bin) => { if (bin) b.style.backgroundImage = `url(${URL.createObjectURL(binBlob(bin))})`; });
      b.onclick = async () => {
        if (!confirm('Remove this backdrop?')) return;
        state.customBgs = state.customBgs.filter((x) => x !== id);
        await db.kvSet('bgs', state.customBgs);
        await db.kvDel('bg:' + id);
        if (state.look.bg === 'custom:' + id) { state.look.bg = 'brown'; await loadBg(); saveSoon(); }
        renderSettings();
      };
      return b;
    });
    cards.push(h('div', { class: 'card stack' }, h('h3', {}, 'Your backdrops'), h('div', { class: 'bg-grid' }, tiles), h('p', { class: 'note' }, 'Tap one to remove it.')));
  }
  cards.push(h('p', { class: 'note', style: 'text-align:center' }, 'Gentleman’s Aesthetic · Collage maker'));
  box.replaceChildren(...cards);
  if (!workerCode) fetch('worker/worker.js').then((r) => (r.ok ? r.text() : '')).then((t) => { workerCode = t; }).catch(() => {});
}

// ---------- tabs + start ----------
function showTab(name) {
  state.tab = name;
  for (const v of ['today', 'create', 'library', 'settings']) $('#view-' + v).classList.toggle('hidden', v !== name);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'library') { saveNow().then(renderLibrary); }
  if (name === 'settings') renderSettings();
  if (name === 'create') editor.draw();
  if (name === 'today') renderToday();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#btn-export').addEventListener('click', exportSheet);
$('#btn-export-all').addEventListener('click', exportAll);
$('#empty-add').addEventListener('click', addItemSheet);
$('#btn-new').addEventListener('click', async () => {
  if (!state.look.items.length) return toast('This look is already empty');
  await saveNow();
  await setLook(blankLook());
  toast('Saved to Library. Started a new look.');
});
$('#look-title').addEventListener('input', (e) => { state.look.title = e.target.value.trim(); saveSoon(); });
$('#look-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
window.addEventListener('pagehide', () => { saveNow(); });
document.addEventListener('gesturestart', (e) => e.preventDefault());

async function start() {
  db.persist();
  state.settings = (await db.kvGet('settings')) || {};
  if (!state.settings.helperKey) {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    state.settings.helperKey = [...a].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 28);
    await saveSettings();
  }
  state.customBgs = (await db.kvGet('bgs')) || [];
  try { state.assets.logo = await loadImage(await (await fetch('assets/logo.png')).blob()); } catch (e) {}
  let look = null;
  try { const id = await db.kvGet('current'); if (id) look = await db.getLook(id); } catch (e) {}
  await setLook(look || blankLook());
  if (await db.kvGet('cutting')) {
    await db.kvDel('cutting');
    if ((state.settings.engine || 'smart') === 'smart') {
      openSheet({ title: 'Cutout stopped', body: h('div', { class: 'stack' },
        h('p', { class: 'note' }, 'It looks like the app closed while cutting out a photo. On some iPhones the Smart engine needs more memory than the phone allows.'),
        h('button', { class: 'btn primary', onclick: async () => { state.settings.engine = 'simple'; await saveSettings(); dismissSheet(); toast('Switched to Simple cutouts'); } }, 'Switch to Simple cutouts'),
        h('button', { class: 'btn', onclick: dismissSheet }, 'Keep Smart and try again')) });
    }
  }
  showTab('today');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
initToday({ state, db, h, toast, busy, openSheet, dismissSheet, setLook, saveNow, blankLook, newId, money, bgImage, openLook, exportSheet });
window.ga = { state, editor, processPhoto, saveNow, setLook, blankLook, showTab, renderToday };
start().catch((e) => { console.error(e); toast('Something went wrong while starting: ' + (e.message || e), 8000); });
