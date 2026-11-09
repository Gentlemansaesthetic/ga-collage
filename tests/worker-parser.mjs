// 1) helper parser against a fixture, with fetch stubbed
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./worker-copy.mjs', import.meta.url), src);
const worker = (await import('./worker-copy.mjs')).default;
const html = `<html><head><title>Fallback title</title>
<meta property="og:site_name" content="Mr Shop"><meta property="og:image" content="https://cdn.shop.com/p/main.jpg?w=1200">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Suede Bomber &amp; Jacket","brand":{"@type":"Brand","name":"Brunello Cucinelli"},"image":["https://cdn.shop.com/p/main.jpg","//cdn.shop.com/p/side.jpg"],"offers":{"@type":"Offer","price":"4995.00","priceCurrency":"USD"}}]}</script></head>
<body><img src="/static/logo.svg"><img width="40" src="/tiny.jpg"><img data-src="/p/detail.webp" srcset="/p/detail-400.webp 400w, /p/detail-1600.webp 1600w">
<script>window.__DATA={"gallery":["https:\\/\\/cdn.shop.com\\/p\\/back.jpg?v=2"]}</script></body></html>`;
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push(String(url));
  if (String(url).endsWith('.js')) return new Response('nope', { status: 404 });
  if (String(url).includes('blocked')) return new Response('no', { status: 403 });
  if (String(url).includes('.jpg')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
  return new Response(html, { headers: { 'content-type': 'text/html' } });
};
const call = async (path) => { const r = await worker.fetch(new Request('https://h.workers.dev' + path), { KEY: 'k' }); return [r.status, r.headers.get('content-type'), (r.headers.get('content-type') || '').includes('json') ? await r.json() : (await r.arrayBuffer()).byteLength]; };
console.log(JSON.stringify(await call('/ping?key=bad')));
console.log(JSON.stringify(await call('/ping?key=k')));
console.log(JSON.stringify(await call('/?key=k&url=' + encodeURIComponent('https://www.shop.com/products/suede-bomber')), null, 1));
console.log(JSON.stringify(await call('/?key=k&url=' + encodeURIComponent('https://blocked.com/x'))));
console.log(JSON.stringify(await call('/?key=k&url=' + encodeURIComponent('http://localhost/x'))));
console.log(JSON.stringify(await call('/img?key=k&url=' + encodeURIComponent('https://cdn.shop.com/p/main.jpg') + '&ref=' + encodeURIComponent('https://www.shop.com/products/x'))));
