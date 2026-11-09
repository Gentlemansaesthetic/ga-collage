// Cutting products out of their photos.
// Everything here only decides which pixels of the ORIGINAL photo stay visible.
// Product pixels are never redrawn, recoloured or generated.

const SIZE = 1024;
export const MAX_SIDE = 1600;

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./seg-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') { p.onProgress && p.onProgress(m.stage, m.p); return; }
    pending.delete(m.id);
    if (m.type === 'error') p.reject(new Error(m.message));
    else p.resolve(m.mask);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'The cutout engine stopped unexpectedly'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function callWorker(msg, transfer, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, ...msg }, transfer || []);
  });
}

export function resetWorker() {
  if (worker) worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('Cancelled'));
  pending.clear();
}

export function preloadModel(model, onProgress) {
  return callWorker({ type: 'preload', model }, [], onProgress);
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function canvasToBlob(canvas, type = 'image/png', q) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not save image'))), type, q));
}

export async function loadImage(blob) {
  if (self.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch (e) { /* fall through */ }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('This file is not an image the phone can open')); };
    img.src = url;
  });
}

// Photo -> working canvas (shrunk only if it is bigger than needed for a 1000x1500 pin).
export async function toSourceCanvas(blob, max = MAX_SIDE) {
  const img = await loadImage(blob);
  const w = img.width, h = img.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = makeCanvas(w * k, h * k);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  return c;
}

// Does the photo already have a transparent background (a ready-made PNG cutout)?
export function existingAlphaMask(src) {
  const { width: w, height: h } = src;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) clear++;
  if (clear / (w * h) < 0.03) return null;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return alphaToMask(a, w, h);
}

export function alphaToMask(a, w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0; i < a.length; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
    d[i * 4 + 3] = a[i];
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

export function maskToAlpha(mask) {
  const { width: w, height: h } = mask;
  const d = mask.getContext('2d').getImageData(0, 0, w, h).data;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return a;
}

export function fullMask(w, h) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  return c;
}

// --- Method 1: on-device model -------------------------------------------------
export async function aiMask(src, model, onProgress) {
  const { width: w, height: h } = src;
  const small = makeCanvas(SIZE, SIZE);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, SIZE, SIZE);
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(src, 0, 0, SIZE, SIZE);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE;
  const f = new Float32Array(3 * n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    f[j] = (px[i] - 128) / 256;
    f[j + n] = (px[i + 1] - 128) / 256;
    f[j + 2 * n] = (px[i + 2] - 128) / 256;
  }
  const m = await callWorker({ type: 'run', model, data: f }, [f.buffer], onProgress);
  // Tighten the soft edge a little so no pale halo of the old background remains.
  const lo = 70, hi = 215;
  for (let i = 0; i < m.length; i++) {
    const v = m[i];
    m[i] = v <= lo ? 0 : v >= hi ? 255 : Math.round(((v - lo) / (hi - lo)) * 255);
  }
  const mc = alphaToMask(m, SIZE, SIZE);
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(mc, 0, 0, w, h);
  return out;
}

// --- Method 2: plain studio background (white / grey) ---------------------------
// Removes everything connected to the border that matches the background colour.
export function plainMask(src, tol = 28) {
  const { width: w, height: h } = src;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const rs = [], gs = [], bs = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += step) for (const y of [0, 1, h - 2, h - 1]) { const i = (y * w + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); }
  for (let y = 0; y < h; y += step) for (const x of [0, 1, w - 2, w - 1]) { const i = (y * w + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const br = med(rs), bg = med(gs), bb = med(bs);
  const dist = (i) => Math.max(Math.abs(d[i] - br), Math.abs(d[i + 1] - bg), Math.abs(d[i + 2] - bb));
  const n = w * h;
  const isBg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (p) => { if (!isBg[p] && dist(p * 4) <= tol) { isBg[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }
  const a = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (isBg[p]) continue;
    const x = p % w;
    const edge = (x > 0 && isBg[p - 1]) || (x < w - 1 && isBg[p + 1]) || (p >= w && isBg[p - w]) || (p < n - w && isBg[p + w]);
    if (edge) {
      const k = Math.min(1, dist(p * 4) / (tol * 2.5));
      a[p] = Math.round(255 * Math.max(0.25, k));
    } else a[p] = 255;
  }
  return alphaToMask(a, w, h);
}

// How plain is the photo's border? Returns the share of border pixels close to the usual border colour.
export function borderUniformity(src) {
  const { width: w, height: h } = src;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const px = [];
  const step = Math.max(1, Math.floor((w + h) / 300));
  for (let x = 0; x < w; x += step) { px.push(x * 4, ((h - 1) * w + x) * 4); }
  for (let y = 0; y < h; y += step) { px.push(y * w * 4, (y * w + w - 1) * 4); }
  const med = (k) => { const a = px.map((i) => d[i + k]).sort((p, q) => p - q); return a[a.length >> 1]; };
  const m = [med(0), med(1), med(2)];
  let near = 0;
  for (const i of px) if (Math.max(Math.abs(d[i] - m[0]), Math.abs(d[i + 1] - m[1]), Math.abs(d[i + 2] - m[2])) <= 16) near++;
  return near / px.length;
}

function dilate(mask, r) {
  const { width: w, height: h } = mask;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(mask, 0, 0);
  for (const rr of [r, r / 2]) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    ctx.drawImage(mask, Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return c;
}

function overlap(a, b) {
  let inter = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i] > 128, y = b[i] > 128;
    if (x) na++;
    if (y) nb++;
    if (x && y) inter++;
  }
  return { iou: inter / Math.max(1, na + nb - inter), na, nb };
}

// --- Automatic: picks the cleanest result -------------------------------------
// On a plain studio background the colour-based edge is the sharpest, so we use it,
// and let the model veto shadows and gaps. Otherwise the model result is used as is.
export async function autoMask(src, model, onProgress) {
  const { width: w, height: h } = src;
  let ai = null, aiError = null;
  try { ai = await aiMask(src, model, onProgress); } catch (e) { aiError = e; }
  const plainOk = borderUniformity(src) >= 0.8;
  if (!ai) {
    if (plainOk) return { mask: plainMask(src), method: 'plain', note: 'model-failed' };
    throw aiError;
  }
  if (!plainOk) return { mask: ai, method: 'ai' };
  const plain = plainMask(src);
  const { iou, na, nb } = overlap(maskToAlpha(ai), maskToAlpha(plain));
  if (iou >= 0.82) {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(plain, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(dilate(ai, Math.max(4, Math.round(Math.max(w, h) * 0.008))), 0, 0);
    return { mask: c, method: 'auto' };
  }
  // They disagree. If the model found far less than the colour method, it probably missed part of the product.
  if (na < nb * 0.6 && nb / (maskToAlpha(plain).length / 3) < 0.9) return { mask: plain, method: 'plain' };
  return { mask: ai, method: 'ai' };
}

// Shave one pixel off the edge of the cutout (for stubborn halos).
export function tightenMask(mask) {
  const { width: w, height: h } = mask;
  const a = maskToAlpha(mask);
  const o = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let m = a[p];
      if (m) {
        if (x > 0 && a[p - 1] < m) m = a[p - 1];
        if (x < w - 1 && a[p + 1] < m) m = a[p + 1];
        if (y > 0 && a[p - w] < m) m = a[p - w];
        if (y < h - 1 && a[p + w] < m) m = a[p + w];
      }
      o[p] = m;
    }
  }
  const ctx = mask.getContext('2d');
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(alphaToMask(o, w, h), 0, 0);
  return mask;
}

// Original photo + mask -> trimmed cutout canvas.
export function composeCut(src, mask) {
  const { width: w, height: h } = src;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null; // nothing left
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const t = makeCanvas(tw, th);
  t.getContext('2d').drawImage(c, x0, y0, tw, th, 0, 0, tw, th);
  return t;
}

// Share of the picture that is kept (used to spot failed cutouts).
export function maskCoverage(mask) {
  const a = maskToAlpha(mask);
  let s = 0;
  for (let i = 0; i < a.length; i += 7) if (a[i] > 128) s++;
  return s / Math.ceil(a.length / 7);
}
