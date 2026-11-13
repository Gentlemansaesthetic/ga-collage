"""The nightly robot: collect products -> cut them out -> style outfits -> publish for the app.

Usage:  python robot/run.py --data <folder of the 'data' branch>
Inputs from the main branch: robot/sources.json, robot/feedback.json, pool/manual.json (+ pool/manual/*.png)
Outputs in the data folder:  pool/catalog.json, pool/items/*.webp, daily/latest.json, daily/<date>.json,
                             daily/history.json, daily/status.json
"""
import argparse
import datetime as dt
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import ACCESSORY, ROOT, guess_category, load_json, log, now, save_json  # noqa: E402
import collect  # noqa: E402
import cutout  # noqa: E402
import stylist  # noqa: E402

TARGET = {'outer': 30, 'top': 45, 'base': 15, 'pants': 40, 'shoes': 35, 'watch': 12, 'fragrance': 12, 'eyewear': 10, 'small': 20}
PUBLIC = ('id', 'source', 'name', 'brand', 'category', 'price', 'currency', 'url', 'buy_url', 'img', 'w', 'h', 'colour', 'added', 'manual')


def save_cut(im, data_dir, iid):
    rel = f'pool/items/{iid}.webp'
    path = os.path.join(data_dir, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=88, method=6)
    return rel, im.width, im.height


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--main', default=ROOT)
    ap.add_argument('--date')
    ap.add_argument('--seed', type=int)
    ap.add_argument('--offline', action='store_true', help='do not visit shops; restyle from the current pool')
    ap.add_argument('--keep-today', action='store_true', help="keep today's outfits if they are already made (only add to the pool)")
    ap.add_argument('--budget', type=int, default=25 * 60, help='seconds to spend cutting out new photos')
    a = ap.parse_args()

    started = time.time()
    today = dt.date.fromisoformat(a.date) if a.date else dt.date.today()
    data = a.data
    model = os.path.join(a.main, 'models', 'isnet_fp16.onnx')
    cfg = load_json(os.path.join(a.main, 'robot', 'sources.json'), {})
    feedback = load_json(os.path.join(a.main, 'robot', 'feedback.json'), {})
    manual = load_json(os.path.join(a.main, 'pool', 'manual.json'), {'items': []})
    cat_path = os.path.join(data, 'pool', 'catalog.json')
    catalog = load_json(cat_path, {'items': {}})['items']
    rejects = load_json(os.path.join(data, 'pool', 'rejects.json'), {})
    history = load_json(os.path.join(data, 'daily', 'history.json'), [])
    t = now()
    status = {'ran_at': t, 'date': today.isoformat(), 'sources': [], 'notes': []}

    # 1. collect
    results = {} if a.offline else collect.collect(cfg)
    candidates = []
    for name, res in results.items():
        if isinstance(res, Exception):
            status['sources'].append({'name': name, 'ok': False, 'error': str(res)[:200]})
            continue
        prods, total = res
        status['sources'].append({'name': name, 'ok': True, 'products': total, 'usable': len(prods), 'new': 0, 'rejected': 0})
        listed = set()
        for p in prods:
            listed.add(p['id'])
            if p['id'] in catalog:
                c = catalog[p['id']]
                c.update({k: p[k] for k in ('name', 'brand', 'category', 'price', 'currency', 'url', 'buy_url')})
                c['seen'] = t
                c.pop('gone', None)
            else:
                candidates.append(p)
        for c in catalog.values():  # products the shop no longer lists are sold out or removed
            if c.get('source') == name and c['id'] not in listed and not c.get('manual'):
                c.setdefault('gone', t)

    # rules may have changed since an item was added: re-check names
    exclude = collect.DEFAULT_EXCLUDE + cfg.get('exclude_words', [])
    for c in catalog.values():
        if c.get('manual'):
            continue
        if collect.excluded(c['name'], exclude):
            c['gone'] = 0
            continue
        cat = guess_category(c['name'])
        if cat != 'other':
            c['category'] = cat

    # 2. cut out new products, filling the categories the pool needs most
    counts = {}
    for c in catalog.values():
        if not c.get('gone'):
            counts[c['category']] = counts.get(c['category'], 0) + 1
    budget_n = cfg.get('new_items_per_run', 60)
    fresh = [p for p in candidates if not (p['id'] in rejects and t - rejects[p['id']]['at'] < 21 * 86400)]
    by_cat = {}
    for p in fresh:
        by_cat.setdefault(p['category'], []).append(p)
    for c, lst in by_cat.items():  # mix shops within each category (round robin)
        nth = {}
        ranked = []
        for p in lst:
            nth[p['source']] = nth.get(p['source'], 0) + 1
            ranked.append((nth[p['source']], p['source'], p))
        by_cat[c] = [p for _, _, p in sorted(ranked, key=lambda r: r[:2])]
    order = []
    while len(order) < budget_n and any(by_cat.values()):
        need = sorted(by_cat, key=lambda c: (counts.get(c, 0) - TARGET.get(c, 10)) / TARGET.get(c, 10))
        c = next((c for c in need if by_cat[c]), None)
        if c is None:
            break
        order.append(by_cat[c].pop(0))
        counts[c] = counts.get(c, 0) + 1
    src_stat = {s['name']: s for s in status['sources']}
    for p in order:
        if time.time() - started > a.budget:
            status['notes'].append('Stopped early to stay within the time limit; the rest follows tomorrow.')
            break
        reason = 'no usable photo'
        for img_url in p['images']:
            try:
                im, info = cutout.cut(collect.download(img_url), model, p['category'])
            except Exception as e:  # noqa: BLE001
                im, info = None, f'photo failed: {e}'[:120]
            if im is None:
                reason = info
                continue
            rel, w, h = save_cut(im, data, p['id'])
            item = {k: p[k] for k in ('id', 'source', 'name', 'brand', 'category', 'price', 'currency', 'url', 'buy_url')}
            item.update({'img': rel, 'w': w, 'h': h, 'colour': info['colour'], 'cut': info['method'], 'photo': img_url, 'added': t, 'seen': t})
            catalog[p['id']] = item
            src_stat[p['source']]['new'] += 1
            log('added', p['category'], '|', p['brand'], '|', p['name'], '|', info['colour']['name'])
            break
        else:
            rejects[p['id']] = {'reason': reason, 'at': t, 'name': p['name']}
            src_stat[p['source']]['rejected'] += 1
            log('skipped', p['name'], '-', reason)

    # 3. items the owner added by hand in the app (already cut out there)
    removed = set(manual.get('removed', []))
    for m in manual.get('items', []):
        if m['id'] in removed or m['id'] in catalog:
            continue
        path = os.path.join(a.main, m['img'])
        try:
            with open(path, 'rb') as f:
                im, info = cutout.cut(f.read(), model, m.get('category', 'other'))
        except Exception as e:  # noqa: BLE001
            im, info = None, str(e)
        if im is None:
            log('manual item failed', m.get('name'), info)
            continue
        rel, w, h = save_cut(im, data, m['id'])
        item = {k: m.get(k, '') for k in ('id', 'name', 'brand', 'category', 'price', 'url')}
        item.update({'source': 'Added in the app', 'currency': m.get('currency', ''), 'buy_url': m.get('url', ''), 'img': rel, 'w': w, 'h': h,
                     'colour': info['colour'], 'manual': True, 'added': m.get('added', t), 'seen': t})
        catalog[m['id']] = item
    for iid in removed:
        if iid in catalog:
            catalog[iid]['gone'] = 0  # removed in the app: drop now

    # 4. prune: gone for 3 days, or the pool grew too big
    keep_ids = {i.get('id') for e in feedback.get('kept', []) for i in e.get('items', [])}
    recent_ids = {iid for h in history[-14 * 12:] for iid in h['items']}
    for iid, c in list(catalog.items()):
        if 'gone' in c and t - c['gone'] > 3 * 86400:
            drop(data, catalog, iid)
    for cat, target in TARGET.items():
        items = sorted((c for c in catalog.values() if c['category'] == cat and not c.get('manual')), key=lambda c: c.get('added', 0))
        extra = len(items) - target * 2
        for c in items:
            if extra <= 0:
                break
            if c['id'] in keep_ids or c['id'] in recent_ids:
                continue
            drop(data, catalog, c['id'])
            extra -= 1
    for iid in [k for k, v in rejects.items() if t - v['at'] > 60 * 86400]:
        del rejects[iid]

    # 5. style today's outfits
    usable = [c for c in catalog.values() if not c.get('gone')]
    want = cfg.get('outfits_per_day', 10)
    existing = load_json(os.path.join(data, 'daily', f'{today.isoformat()}.json'), None)
    if a.keep_today and existing and len(existing.get('outfits', [])) >= want and all(i in catalog and 'gone' not in catalog[i] for o in existing['outfits'] for i in o['items']):
        log("today's outfits already exist; keeping them")
        save_json(cat_path, {'items': catalog})
        save_json(os.path.join(data, 'pool', 'rejects.json'), rejects)
        status.update({'pool': count_pool(usable), 'outfits': len(existing['outfits']), 'missing': [], 'seconds': round(time.time() - started), 'kept_today': True})
        save_json(os.path.join(data, 'daily', 'status.json'), status)
        return
    outfits, info = stylist.style(usable, [h for h in history if h['date'] != today.isoformat()], feedback, want, today, a.seed)
    used = {iid for o in outfits for iid in o['items'] + [x for alts in o['alts'].values() for x in alts]}
    day = {
        'date': today.isoformat(), 'made': t, 'season': info['season'],
        'outfits': [{k: v for k, v in o.items() if k != 'sig'} for o in outfits],
        'items': {iid: {k: catalog[iid][k] for k in PUBLIC if k in catalog[iid]} for iid in sorted(used)},
    }
    save_json(os.path.join(data, 'daily', f'{today.isoformat()}.json'), day)
    save_json(os.path.join(data, 'daily', 'latest.json'), day)
    history = [h for h in history if h['date'] != today.isoformat()]
    history += [{'date': today.isoformat(), 'sig': o['sig'], 'items': o['items']} for o in outfits]
    cutoff = (today - dt.timedelta(days=90)).isoformat()
    history = [h for h in history if h['date'] >= cutoff]
    for f in os.listdir(os.path.join(data, 'daily')):  # keep 30 days of daily files
        if f[:4].isdigit() and f[:10] < (today - dt.timedelta(days=30)).isoformat():
            os.remove(os.path.join(data, 'daily', f))

    pool_counts = count_pool(usable)
    status.update({'pool': pool_counts, 'outfits': len(outfits), 'missing': info['missing'], 'seconds': round(time.time() - started)})
    if len(outfits) < want:
        if info['missing']:
            status['notes'].append('Not enough ' + ', '.join(info['missing']) + ' yet to make outfits. Add shops that sell them.')
        else:
            status['notes'].append('Fewer outfits than asked: the pool is still small, so combinations ran out.')
    if 'watch' not in pool_counts:
        status['notes'].append('No watches yet: the shops on the list do not sell them. Add a few by hand in the app (paste a link); they are reused in many outfits.')

    save_json(cat_path, {'items': catalog})
    save_json(os.path.join(data, 'pool', 'rejects.json'), rejects)
    save_json(os.path.join(data, 'daily', 'history.json'), history)
    save_json(os.path.join(data, 'daily', 'status.json'), status)
    log(f"done in {status['seconds']}s: {len(outfits)} outfits, pool {pool_counts}")


def count_pool(items):
    out = {}
    for c in items:
        out[c['category']] = out.get(c['category'], 0) + 1
    return out


def drop(data, catalog, iid):
    c = catalog.pop(iid)
    try:
        os.remove(os.path.join(data, c['img']))
    except (OSError, KeyError):
        pass


if __name__ == '__main__':
    main()
