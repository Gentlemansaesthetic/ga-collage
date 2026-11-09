// Draws the pin and handles touch editing (drag, pinch, resize handle).
import { W, H } from './layouts.js';

const LABEL_FONT = '500 30px "Helvetica Neue", Helvetica, Arial, sans-serif';

function itemH(it) { return (it.s * it.h) / it.w; }

function sprite(it, drawW) {
  const mips = it._mips;
  if (!mips) return it._img;
  let pick = mips[0];
  for (const m of mips) if (m.width >= drawW * 1.15) pick = m;
  return pick;
}

export function renderLook(ctx, look, assets, opts = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const bg = assets.bg;
  if (bg) {
    const k = Math.max(W / bg.width, H / bg.height);
    const bw = bg.width * k, bh = bg.height * k;
    ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
  } else {
    ctx.fillStyle = '#6b5443';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const items = look.items.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const it of items) {
    if (!it._img) continue;
    const w = it.s, h = itemH(it);
    ctx.save();
    if (it.shadow !== false) {
      ctx.shadowColor = 'rgba(18, 10, 4, 0.5)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetX = 7;
      ctx.shadowOffsetY = 11;
    }
    ctx.translate(it.x, it.y);
    if (it.flip) ctx.scale(-1, 1);
    ctx.drawImage(sprite(it, w), -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  if (look.labels) {
    ctx.save();
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#0d0b0a';
    for (const it of items) {
      if (!it._img || !it.brand) continue;
      ctx.fillText(it.brand, it.x, it.y + itemH(it) / 2 + 12);
    }
    ctx.restore();
  }
  if (look.logo !== false && assets.logo) {
    const lw = 340, lh = (lw * assets.logo.height) / assets.logo.width;
    ctx.drawImage(assets.logo, (W - lw) / 2, H - lh - 30, lw, lh);
  }
  if (opts.guideX != null) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 244, 225, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(opts.guideX, 0); ctx.lineTo(opts.guideX, H); ctx.stroke();
    ctx.restore();
  }
  const sel = opts.selected;
  if (sel && sel._img) {
    const w = sel.s, h = itemH(sel);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 244, 225, 0.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 9]);
    ctx.strokeRect(sel.x - w / 2 - 8, sel.y - h / 2 - 8, w + 16, h + 16);
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff4e1';
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(sel.x + w / 2 + 8, sel.y + h / 2 + 8, 17, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

export class Editor {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks; // { onSelect, onBefore, onChange }
    this.look = null;
    this.assets = {};
    this.selected = null;
    this.pointers = new Map();
    this.mode = null;
    this.guideX = null;
    this.raf = 0;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
  }

  set(look, assets) {
    this.look = look;
    this.assets = assets;
    this.selected = null;
    this.draw();
  }

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.look) renderLook(this.ctx, this.look, this.assets, { selected: this.selected, guideX: this.guideX });
    });
  }

  select(it) {
    if (this.selected === it) return;
    this.selected = it;
    this.hooks.onSelect && this.hooks.onSelect(it);
    this.draw();
  }

  pt(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  hit(p) {
    const items = this.look.items.slice().sort((a, b) => (b.z || 0) - (a.z || 0));
    const inside = (it, pad) => {
      const w = it.s, h = itemH(it);
      return Math.abs(p.x - it.x) <= w / 2 + pad && Math.abs(p.y - it.y) <= h / 2 + pad;
    };
    for (const it of items) {
      if (!it._hit || !inside(it, 0)) continue;
      const w = it.s, h = itemH(it);
      let u = (p.x - (it.x - w / 2)) / w;
      const v = (p.y - (it.y - h / 2)) / h;
      if (it.flip) u = 1 - u;
      const hx = Math.min(it._hit.w - 1, Math.floor(u * it._hit.w));
      const hy = Math.min(it._hit.h - 1, Math.floor(v * it._hit.h));
      if (it._hit.a[hy * it._hit.w + hx] > 30) return it;
    }
    for (const it of items) if (inside(it, 14)) return it;
    return null;
  }

  begin() {
    if (!this.started) { this.started = true; this.hooks.onBefore && this.hooks.onBefore(); }
  }

  down(e) {
    if (!this.look) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pt(e);
    this.pointers.set(e.pointerId, p);
    this.started = false;
    if (this.pointers.size === 2 && this.selected) {
      const [a, b] = [...this.pointers.values()];
      this.mode = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: this.selected.s };
      return;
    }
    if (this.pointers.size > 1) return;
    const sel = this.selected;
    if (sel) {
      const hx = sel.x + sel.s / 2 + 8, hy = sel.y + itemH(sel) / 2 + 8;
      if (Math.hypot(p.x - hx, p.y - hy) < 52) {
        this.mode = { type: 'resize', d0: Math.hypot(p.x - sel.x, p.y - sel.y) || 1, s0: sel.s };
        return;
      }
    }
    const it = this.hit(p);
    this.select(it);
    this.mode = it ? { type: 'move', dx: p.x - it.x, dy: p.y - it.y, x0: p.x, y0: p.y } : null;
  }

  move(e) {
    if (!this.pointers.has(e.pointerId) || !this.mode || !this.selected) return;
    const p = this.pt(e);
    this.pointers.set(e.pointerId, p);
    const it = this.selected, m = this.mode;
    if (m.type === 'move') {
      if (!this.started && Math.hypot(p.x - m.x0, p.y - m.y0) < 6) return;
      this.begin();
      let x = p.x - m.dx;
      this.guideX = null;
      if (Math.abs(x - W / 2) < 12) { x = W / 2; this.guideX = W / 2; }
      it.x = Math.max(-it.s / 4, Math.min(W + it.s / 4, x));
      it.y = Math.max(0, Math.min(H, p.y - m.dy));
      it.manual = true;
    } else if (m.type === 'resize') {
      this.begin();
      const d = Math.hypot(p.x - it.x, p.y - it.y);
      it.s = Math.max(40, Math.min(1600, (m.s0 * d) / m.d0));
      it.manual = true;
    } else if (m.type === 'pinch' && this.pointers.size >= 2) {
      this.begin();
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      it.s = Math.max(40, Math.min(1600, (m.s0 * d) / m.d0));
      it.manual = true;
    }
    this.draw();
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      if (this.started) this.hooks.onChange && this.hooks.onChange();
      this.mode = null;
      this.started = false;
      this.guideX = null;
      this.draw();
    } else if (this.mode && this.mode.type === 'pinch') {
      this.mode = null; // one finger left: wait for a fresh touch
    }
  }
}
