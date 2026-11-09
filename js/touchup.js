// Full-screen cutout touch-up: erase / restore with a finger, zoom with two fingers.
import { makeCanvas, plainMask, autoMask, fullMask, tightenMask } from './cutout.js';

const $ = (s, r = document) => r.querySelector(s);

export function openTouchup({ src, mask, bg, model, busy }) {
  return new Promise((resolve) => {
    const root = $('#touchup');
    root.classList.remove('hidden');
    const canvas = $('#tu-canvas');
    const ctx = canvas.getContext('2d');
    const work = makeCanvas(mask.width, mask.height);
    work.getContext('2d').drawImage(mask, 0, 0);
    const wctx = work.getContext('2d');
    const comp = makeCanvas(src.width, src.height);
    const cctx = comp.getContext('2d');
    const undo = [];
    let tool = 'erase';
    let brush = 34; // screen px
    let backdrop = 0; // 0 pin background, 1 light, 2 dark
    let view = { k: 1, x: 0, y: 0 };
    let cursor = null;
    const pts = new Map();
    let stroke = null, pinch = null;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    function size() {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      const k = Math.min(r.width / src.width, r.height / src.height) * 0.9;
      view = { k, x: (r.width - src.width * k) / 2, y: (r.height - src.height * k) / 2 };
      draw();
    }
    function recompose() {
      cctx.globalCompositeOperation = 'source-over';
      cctx.clearRect(0, 0, comp.width, comp.height);
      cctx.drawImage(src, 0, 0);
      cctx.globalCompositeOperation = 'destination-in';
      cctx.drawImage(work, 0, 0);
    }
    function draw() {
      const cw = canvas.width / dpr, ch = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (backdrop === 0 && bg) {
        const k = Math.max(cw / bg.width, ch / bg.height);
        ctx.drawImage(bg, (cw - bg.width * k) / 2, (ch - bg.height * k) / 2, bg.width * k, bg.height * k);
      } else {
        ctx.fillStyle = backdrop === 1 ? '#f1ede6' : '#15110f';
        ctx.fillRect(0, 0, cw, ch);
      }
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);
      if (tool === 'restore') { ctx.globalAlpha = 0.4; ctx.drawImage(src, 0, 0); ctx.globalAlpha = 1; }
      ctx.drawImage(comp, 0, 0);
      ctx.restore();
      if (cursor) {
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, brush / 2, 0, Math.PI * 2);
        ctx.strokeStyle = tool === 'erase' ? '#ffb4a1' : '#b9f0c0';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    function snapshot() {
      const c = makeCanvas(work.width, work.height);
      c.getContext('2d').drawImage(work, 0, 0);
      undo.push(c);
      if (undo.length > 8) undo.shift();
      $('#tu-undo').disabled = false;
    }
    function setMask(m) {
      wctx.globalCompositeOperation = 'source-over';
      wctx.clearRect(0, 0, work.width, work.height);
      wctx.drawImage(m, 0, 0, work.width, work.height);
      recompose();
      draw();
    }
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const toImg = (p) => ({ x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k });
    function paint(a, b) {
      wctx.save();
      wctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
      wctx.strokeStyle = '#fff';
      wctx.fillStyle = '#fff';
      wctx.lineCap = 'round';
      wctx.lineJoin = 'round';
      wctx.lineWidth = brush / view.k;
      wctx.beginPath();
      wctx.moveTo(a.x, a.y);
      wctx.lineTo(b.x + 0.01, b.y + 0.01);
      wctx.stroke();
      wctx.restore();
    }
    function down(e) {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        snapshot();
        stroke = toImg(p);
        cursor = p;
        paint(stroke, stroke);
        recompose(); draw();
      } else if (pts.size === 2) {
        if (stroke) { // the first finger was the start of a pinch, not a stroke
          const prev = undo.pop();
          if (prev) setMask(prev);
          $('#tu-undo').disabled = !undo.length;
          stroke = null; cursor = null;
        }
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: { ...view } };
      }
    }
    function move(e) {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const k = Math.max(0.05, Math.min(12, (pinch.view.k * d) / pinch.d));
        const ix = (pinch.cx - pinch.view.x) / pinch.view.k, iy = (pinch.cy - pinch.view.y) / pinch.view.k;
        view = { k, x: cx - ix * k, y: cy - iy * k };
        draw();
      } else if (stroke) {
        const q = toImg(p);
        paint(stroke, q);
        stroke = q;
        cursor = p;
        recompose(); draw();
      }
    }
    function up(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) { stroke = null; cursor = null; draw(); }
    }
    const on = (el, ev, fn) => { el.addEventListener(ev, fn); offs.push(() => el.removeEventListener(ev, fn)); };
    const offs = [];
    on(canvas, 'pointerdown', down);
    on(canvas, 'pointermove', move);
    on(canvas, 'pointerup', up);
    on(canvas, 'pointercancel', up);
    on(window, 'resize', size);

    const setTool = (t) => {
      tool = t;
      $('#tu-erase').classList.toggle('on', t === 'erase');
      $('#tu-restore').classList.toggle('on', t === 'restore');
      draw();
    };
    on($('#tu-erase'), 'click', () => setTool('erase'));
    on($('#tu-restore'), 'click', () => setTool('restore'));
    on($('#tu-size'), 'input', (e) => { brush = +e.target.value; });
    on($('#tu-undo'), 'click', () => {
      const prev = undo.pop();
      if (prev) setMask(prev);
      $('#tu-undo').disabled = !undo.length;
    });
    on($('#tu-backdrop'), 'click', () => { backdrop = (backdrop + 1) % 3; draw(); });
    on($('#tu-tighten'), 'click', () => { snapshot(); tightenMask(work); recompose(); draw(); });
    on($('#tu-redo'), 'change', async (e) => {
      const v = e.target.value;
      e.target.value = '';
      if (!v) return;
      snapshot();
      try {
        if (v === 'auto') {
          const done = busy('Cutting out…');
          try { setMask((await autoMask(src, model, done.progress)).mask); } finally { done(); }
        } else if (v === 'none') setMask(fullMask(src.width, src.height));
        else setMask(plainMask(src, +v));
      } catch (err) {
        alert('That did not work: ' + err.message);
      }
    });
    const finish = (result) => {
      offs.forEach((f) => f());
      root.classList.add('hidden');
      resolve(result);
    };
    on($('#tu-cancel'), 'click', () => finish(null));
    on($('#tu-done'), 'click', () => finish(work));

    $('#tu-size').value = brush;
    $('#tu-undo').disabled = true;
    setTool('erase');
    recompose();
    size();
  });
}
