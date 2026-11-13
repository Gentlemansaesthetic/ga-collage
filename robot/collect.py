"""Collects products from the owner's shops (Shopify product lists) and affiliate product feeds."""
import csv
import gzip
import io
import os
import re
import xml.etree.ElementTree as ET

import requests

from common import guess_category, log, make_id

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
HEADERS = {'user-agent': UA, 'accept': 'application/json,text/html;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9'}
DEFAULT_EXCLUDE = ['women', 'womens', "women's", 'woman', 'ladies', 'girls', 'boys', 'kids', 'baby', 'gift card', 'gift-card', 'sample', 'swatch', 'repair', 'monogram service',
                   'set', 'pyjama', 'pyjamas', 'pajama', 'pajamas', 'robe', 'dressing gown', 'sock', 'socks', 'underwear', 'boxer', 'boxers', 'briefs', 'trunks', 'swim', 'swimwear',
                   'towel', 'candle', 'refill', 'spurs', 'strap', 'straps', 'laces', 'shoe tree', 'shoe trees', 'polish', 'brush', 'care kit', 'lint', 'hanger', 'umbrella', 'keyring', 'key ring',
                   'mug', 'book', 'poster', 'print', 'blanket', 'pillow', 'cushion', 'notebook', 'pen', 'lens', 'case only', 'replacement']


def category_for(title, ptype, shop, tags=''):
    """The shop's own product type is more reliable than the name ("Grey Blazer" can be a perfume)."""
    if shop.get('category'):
        return shop['category']
    for text in (ptype, title, tags):
        cat = guess_category(text)
        if cat != 'other':
            return cat
    return 'other'


def clean_brand(vendor, shop):
    """Shops often put their own name in odd forms ("Drakes - UK/ROW", "PrivateWhite V.C"). Use the shop's name then."""
    if shop.get('brand'):
        return shop['brand']
    v = (vendor or '').strip()
    a = re.sub(r'[^a-z0-9]', '', v.lower())
    b = re.sub(r'[^a-z0-9]', '', shop['name'].lower())
    if not a or a.startswith(b[:6]) or b.startswith(a[:6]):
        return shop['name']
    return v


def http_get(url, timeout=30, accept=None):
    h = dict(HEADERS)
    if accept:
        h['accept'] = accept
    r = requests.get(url, headers=h, timeout=timeout)
    r.raise_for_status()
    return r


def excluded(text, words):
    t = ' ' + text.lower() + ' '
    return any(re.search(r'(?<![a-z])' + re.escape(w) + r'(?![a-z])', t) for w in words)


def _price(v):
    m = re.search(r'\d[\d,]*(?:\.\d+)?', str(v or ''))
    if not m:
        return None
    return float(m.group(0).replace(',', ''))


def _fmt_price(p):
    if p is None:
        return ''
    return str(int(p)) if abs(p - round(p)) < 0.005 else f'{p:.2f}'


def shopify(shop, cfg):
    """All in-stock menswear products of a Shopify shop."""
    base = shop['url'].rstrip('/')
    exclude = DEFAULT_EXCLUDE + cfg.get('exclude_words', []) + shop.get('exclude_words', [])
    min_price = shop.get('min_price', cfg.get('min_price', 0))
    out, total = [], 0
    for page in range(1, shop.get('max_pages', 6) + 1):
        r = http_get(f'{base}/products.json?limit=250&page={page}', accept='application/json')
        if 'json' not in r.headers.get('content-type', ''):
            raise RuntimeError('this shop does not share a product list')
        prods = r.json().get('products', [])
        if not prods:
            break
        total += len(prods)
        for p in prods:
            tags = p.get('tags') or []
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(',')]
            text = ' '.join([p.get('title', ''), p.get('product_type', ''), ' '.join(tags)])
            if excluded(text, exclude):
                continue
            if shop.get('include_words') and not excluded(text, shop['include_words']):
                continue
            variants = p.get('variants') or []
            avail = [v for v in variants if v.get('available', True)]
            if not avail:
                continue
            price = min((_price(v.get('price')) or 0) for v in avail)
            if price < min_price:
                continue
            cat = category_for(p.get('title', ''), p.get('product_type', ''), shop, ' '.join(tags))
            if cat == 'other':
                continue
            images = [i.get('src') for i in (p.get('images') or []) if i.get('src')]
            images = ['https:' + s if s.startswith('//') else s for s in images]
            if not images:
                continue
            url = f"{base}/products/{p.get('handle')}"
            out.append({
                'id': make_id(base, str(p.get('handle'))),
                'source': shop['name'],
                'name': p.get('title', '').strip(),
                'brand': clean_brand(p.get('vendor'), shop),
                'category': cat,
                'ptype': p.get('product_type', ''),
                'price': _fmt_price(price),
                'currency': shop.get('currency', 'USD'),
                'url': url,
                'buy_url': _affiliate(url, shop),
                'images': images[:4],
            })
        if len(prods) < 250:
            break
    log(f"{shop['name']}: {total} products, {len(out)} usable menswear")
    return out, total


def _affiliate(url, src):
    tpl = src.get('affiliate_template')
    if not tpl:
        return url
    from urllib.parse import quote
    return tpl.replace('{url}', quote(url, safe=''))


# ----- affiliate product feeds (Google Shopping format, CSV / TSV / XML, optionally gzipped) -----
G = '{http://base.google.com/ns/1.0}'


def _feed_rows(data):
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    text = data.decode('utf-8-sig', errors='replace')
    if text.lstrip().startswith('<'):
        root = ET.fromstring(text)
        for item in root.iter():
            if item.tag not in ('item', 'entry', '{http://www.w3.org/2005/Atom}entry', 'product', 'Product'):
                continue
            row = {}
            for child in item:
                key = child.tag.replace(G, '').split('}')[-1].lower()
                if key in row and key == 'additional_image_link':
                    row[key] += ',' + (child.text or '')
                else:
                    row[key] = (child.text or child.attrib.get('href') or '').strip()
            yield row
        return
    first = text.split('\n', 1)[0]
    delim = '\t' if first.count('\t') > first.count(',') else (',' if first.count(',') >= first.count('|') else '|')
    for row in csv.DictReader(io.StringIO(text), delimiter=delim):
        yield {(k or '').strip().lower().replace(' ', '_'): (v or '').strip() for k, v in row.items()}


def _pick(row, *keys):
    for k in keys:
        if row.get(k):
            return row[k]
    return ''


def feed(src, cfg):
    url = os.environ.get(src.get('secret', ''), '') or src.get('url', '')
    if not url:
        raise RuntimeError(f"the feed address is missing (GitHub secret {src.get('secret')})")
    data = http_get(url, timeout=180, accept='*/*').content
    exclude = DEFAULT_EXCLUDE + cfg.get('exclude_words', []) + src.get('exclude_words', [])
    brands = [b.lower() for b in src.get('brands', cfg.get('brands', []))]
    min_price = src.get('min_price', cfg.get('min_price', 0))
    out, total = [], 0
    for row in _feed_rows(data):
        total += 1
        name = _pick(row, 'title', 'name', 'product_name')
        brand = _pick(row, 'brand', 'manufacturer', 'designer')
        gender = _pick(row, 'gender').lower()
        if gender and gender not in ('male', 'men', 'mens', "men's", 'unisex'):
            continue
        avail = _pick(row, 'availability', 'stock_status', 'in_stock').lower()
        if avail and ('out' in avail or avail in ('false', '0', 'no')):
            continue
        ptype = _pick(row, 'product_type', 'google_product_category', 'category', 'merchant_category')
        if excluded(' '.join([name, ptype]), exclude):
            continue
        if brands and brand.lower() not in brands:
            continue
        price_raw = _pick(row, 'sale_price', 'price', 'search_price', 'retail_price')
        price = _price(price_raw)
        if price is None or price < min_price:
            continue
        cur = re.search(r'[A-Z]{3}', price_raw or '') or re.search(r'[A-Z]{3}', _pick(row, 'currency'))
        cat = guess_category(name, ptype)
        if cat == 'other':
            continue
        link = _pick(row, 'link', 'product_url', 'url', 'merchant_deep_link')
        buy = _pick(row, 'affiliate_link', 'aw_deep_link', 'click_url', 'buy_url', 'deeplink', 'tracking_link') or link
        images = [_pick(row, 'image_link', 'image_url', 'large_image', 'merchant_image_url', 'aw_image_url', 'image')]
        images += [s for s in re.split(r'[,|\s]+', _pick(row, 'additional_image_link', 'alternate_image', 'additional_images')) if s.startswith('http')]
        images = [i for i in images if i]
        if not link or not images:
            continue
        out.append({
            'id': make_id(src['name'], _pick(row, 'id', 'sku', 'product_id') or link),
            'source': src['name'], 'name': name, 'brand': brand or src['name'], 'category': cat,
            'price': _fmt_price(price), 'currency': cur.group(0) if cur else src.get('currency', 'USD'),
            'url': link, 'buy_url': buy, 'images': images[:4],
        })
    log(f"{src['name']}: {total} feed rows, {len(out)} usable menswear")
    return out, total


def friendly(e):
    if isinstance(e, requests.HTTPError) and e.response is not None:
        code = e.response.status_code
        if code == 404:
            return 'No product list found here. It may not be a Shopify shop, or the address is wrong.'
        if code in (401, 403, 429, 503):
            return 'This shop blocks automatic visits.'
        return f'The shop answered with an error ({code}).'
    if isinstance(e, (requests.ConnectionError, requests.Timeout)):
        return 'Could not reach this shop.'
    return str(e)[:200]


def collect(cfg):
    """Returns ({source name: (products, total) or exception})."""
    results = {}
    for shop in cfg.get('shops', []):
        if not shop.get('on', True):
            continue
        try:
            results[shop['name']] = shopify(shop, cfg)
        except Exception as e:  # noqa: BLE001
            log(f"{shop['name']}: failed - {e}")
            results[shop['name']] = RuntimeError(friendly(e))
    for src in cfg.get('feeds', []):
        if not src.get('on', True):
            continue
        try:
            results[src['name']] = feed(src, cfg)
        except Exception as e:  # noqa: BLE001
            log(f"{src['name']}: failed - {e}")
            results[src['name']] = RuntimeError(friendly(e))
    return results


def download(url, limit=12_000_000):
    r = requests.get(url, headers={'user-agent': UA, 'accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8'}, timeout=40, stream=True)
    r.raise_for_status()
    data = r.raw.read(limit + 1, decode_content=True)
    if len(data) > limit:
        raise RuntimeError('photo too large')
    return data
