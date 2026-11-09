// Gentleman's Aesthetic - link helper (runs free on Cloudflare Workers).
// It does two small jobs for the collage app:
//   1. /?url=<product page>   -> reads the page and returns the product name, brand, price and photo links
//   2. /img?url=<photo link>  -> passes a product photo through so the app is allowed to open it
// Only requests carrying your private key are answered.
const KEY = '__KEY__';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': '*' };

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });

function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = u.hostname;
  if (h === 'localhost' || /^[\d.]+$/.test(h) || h.includes(':') || !h.includes('.') || /\.(local|internal|lan)$/.test(h)) return null;
  return u;
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
  .replace(/\s+/g, ' ').trim();

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5];
  return out;
}

function fromSrcset(v) {
  let best = null, bestW = -1;
  for (const part of String(v).split(/,\s+|,(?=https?:|\/\/)/)) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const n = parseFloat(d) || 0;
    if (n >= bestW) { bestW = n; best = u; }
  }
  return best;
}

const BAD = /sprite|icon|logo|favicon|flag|payment|badge|placeholder|spinner|loader|pixel|tracking|avatar|swatch|\.svg(\?|$)|\.gif(\?|$)|data:image/i;

function parsePage(html, pageUrl) {
  const out = { title: '', brand: '', price: '', currency: '', site: '', images: [] };
  const seen = new Set();
  const add = (raw, front) => {
    if (!raw || typeof raw !== 'string') return;
    let s = decode(raw).replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
    if (s.startsWith('//')) s = 'https:' + s;
    let u;
    try { u = new URL(s, pageUrl); } catch (e) { return; }
    if (!/^https?:$/.test(u.protocol) || BAD.test(u.href)) return;
    const k = u.origin + u.pathname;
    if (seen.has(k)) return;
    seen.add(k);
    if (front) out.images.unshift(u.href); else out.images.push(u.href);
  };

  // 1. Structured product data (most shops include this for Google).
  const ldImages = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const type = [].concat(node['@type'] || []).join(' ');
    if (/Product/i.test(type)) {
      if (!out.title && node.name) out.title = decode(node.name);
      const b = node.brand;
      if (!out.brand && b) out.brand = decode(typeof b === 'string' ? b : b.name || '');
      const imgs = [].concat(node.image || []);
      for (const im of imgs) ldImages.push(typeof im === 'string' ? im : im && (im.url || im.contentUrl));
      const offers = [].concat(node.offers || []);
      for (const o of offers) {
        if (!o || out.price) continue;
        const p = o.price ?? o.lowPrice ?? (o.priceSpecification && [].concat(o.priceSpecification)[0]?.price);
        if (p != null && p !== '') { out.price = String(p); out.currency = o.priceCurrency || [].concat(o.priceSpecification || [])[0]?.priceCurrency || ''; }
      }
    }
    for (const k of ['@graph', 'hasVariant', 'mainEntity', 'itemListElement', 'item']) if (node[k]) walk(node[k]);
  };
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch (e) { /* ignore broken blocks */ }
  }

  // 2. Meta tags.
  const meta = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const k = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (k && a.content !== undefined) (meta[k] = meta[k] || []).push(a.content);
  }
  const first = (...keys) => { for (const k of keys) if (meta[k] && meta[k][0]) return decode(meta[k][0]); return ''; };
  if (!out.title) out.title = first('og:title', 'twitter:title');
  if (!out.title) { const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (t) out.title = decode(t[1]); }
  if (!out.brand) out.brand = first('product:brand', 'og:brand', 'brand');
  if (!out.price) { out.price = first('product:price:amount', 'og:price:amount', 'price'); out.currency = out.currency || first('product:price:currency', 'og:price:currency', 'pricecurrency'); }
  out.site = first('og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '');

  ldImages.forEach((u) => add(u));
  for (const k of ['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) (meta[k] || []).forEach((u) => add(u));

  // 3. Pictures on the page.
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const w = parseInt(a.width, 10);
    if (w && w < 120) continue;
    const set = a.srcset || a['data-srcset'];
    add((set && fromSrcset(set)) || a['data-zoom-image'] || a['data-large'] || a['data-src'] || a['data-original'] || a.src);
  }
  // 4. Photo links hidden in the page's data (shops that draw the page with JavaScript).
  for (const m of html.matchAll(/https?:(?:\\?\/){2}[^"'\s<>()\\]+?(?:\\?\/[^"'\s<>()\\]+?)*\.(?:jpe?g|png|webp|avif)(?:\?[^"'\s<>()\\]*)?/gi)) {
    if (out.images.length >= 60) break;
    add(m[0]);
  }
  out.images = out.images.slice(0, 48);
  return out;
}

async function shopify(u) {
  // Shopify shops publish a tidy data file for every product.
  const m = u.pathname.match(/^(.*\/products\/[^/?#]+)/);
  if (!m) return null;
  try {
    const r = await fetch(u.origin + m[1].replace(/\.js$/, '') + '.js', { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null;
    const p = await r.json();
    if (!p || !p.title || !Array.isArray(p.images)) return null;
    return {
      title: p.title,
      brand: p.vendor || '',
      price: typeof p.price === 'number' ? (p.price / 100).toFixed(2).replace(/\.00$/, '') : '',
      images: p.images.map((s) => (String(s).startsWith('//') ? 'https:' + s : String(s))),
    };
  } catch (e) { return null; }
}

async function readProduct(u) {
  const [res, shop] = await Promise.all([
    fetch(u.href, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' } }).catch((e) => ({ ok: false, status: 0, error: String(e) })),
    shopify(u),
  ]);
  let page = null;
  if (res.ok) {
    const html = (await res.text()).slice(0, 3_000_000);
    page = parsePage(html, res.url || u.href);
  }
  if (!page && !shop) {
    const blocked = [401, 403, 429, 503].includes(res.status);
    return json({ ok: false, status: res.status, error: blocked ? 'This shop blocks automatic visits. Save the photo and add it from Photos instead.' : 'Could not open that page (' + (res.status || 'no answer') + ').' });
  }
  const out = page || { title: '', brand: '', price: '', currency: '', site: u.hostname.replace(/^www\./, ''), images: [] };
  if (shop) {
    out.title = shop.title || out.title;
    out.brand = shop.brand || out.brand;
    out.price = out.price || shop.price;
    const have = new Set(shop.images.map((s) => s.split('?')[0]));
    out.images = shop.images.concat(out.images.filter((s) => !have.has(s.split('?')[0]))).slice(0, 48);
  }
  if (!out.images.length) return json({ ok: false, error: 'The page opened, but no product photos were found on it. Save the photo and add it from Photos instead.', ...out });
  return json({ ok: true, url: u.href, ...out });
}

async function passImage(u, ref) {
  const headers = { 'user-agent': UA, accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' };
  const r = safeUrl(ref || '');
  if (r) headers.referer = r.origin + '/';
  const res = await fetch(u.href, { headers });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !/^image\//.test(type)) return json({ ok: false, error: 'Photo could not be loaded (' + res.status + ').' }, 502);
  return new Response(res.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', ...CORS } });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const here = new URL(request.url);
    const key = (env && env.KEY) || KEY;
    if (here.searchParams.get('key') !== key) return json({ ok: false, error: 'Wrong key. Copy the helper code from the app again.' }, 403);
    if (here.pathname === '/ping') return json({ ok: true });
    const target = safeUrl(here.searchParams.get('url') || '');
    if (!target) return json({ ok: false, error: 'That does not look like a web link.' }, 400);
    try {
      if (here.pathname === '/img') return await passImage(target, here.searchParams.get('ref'));
      return await readProduct(target);
    } catch (e) {
      return json({ ok: false, error: 'The helper hit a problem: ' + String((e && e.message) || e) }, 500);
    }
  },
};
