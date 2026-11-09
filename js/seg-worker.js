// Background-removal worker. Runs the segmentation model fully on the device.
// It only produces a mask (which pixels to keep). It never changes product pixels.
import * as ort from '../vendor/ort/ort.wasm.bundle.min.mjs';

ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const SIZE = 1024;
let session = null;
let sessionModel = null;

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download the cutout model (' + res.status + ')');
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function ensureSession(model, id) {
  if (session && sessionModel === model) return;
  if (session) { try { await session.release(); } catch (e) {} session = null; }
  const url = new URL('../models/' + model + '.onnx', import.meta.url).href;
  const bytes = await fetchWithProgress(url, (p) => postMessage({ id, type: 'progress', stage: 'download', p }));
  postMessage({ id, type: 'progress', stage: 'start', p: 1 });
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  sessionModel = model;
}

self.onmessage = async (e) => {
  const { id, type, model, data } = e.data;
  try {
    await ensureSession(model, id);
    if (type === 'preload') { postMessage({ id, type: 'done' }); return; }
    postMessage({ id, type: 'progress', stage: 'cut', p: 0 });
    const input = new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]);
    const out = await session.run({ [session.inputNames[0]]: input });
    const mask = out[session.outputNames[0]].data;
    const u8 = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < u8.length; i++) {
      const v = mask[i] * 255;
      u8[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    postMessage({ id, type: 'done', mask: u8 }, [u8.buffer]);
  } catch (err) {
    postMessage({ id, type: 'error', message: String((err && err.message) || err) });
  }
};
