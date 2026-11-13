"""Builds the day's outfits from the product pool.

Rule based and free: quiet-luxury colours, the season, variety, and what the owner
kept or skipped before. It makes many candidates and keeps the best few.
"""
import datetime as dt
import math
import random
import re

from common import ACCESSORY, UPPER

TEMPLATE_COUNT = 6
WINTER_WORDS = re.compile(r'wool|cashmere|shearling|suede|flannel|knit|coat|boot|corduroy|cord\b|tweed|merino|alpaca|mohair|turtleneck|roll ?neck|overcoat|leather|quilted|down', re.I)
CASUAL_WORDS = re.compile(r'hoodie|hooded|sweatpant|sweatshirt|jogger|lounge|track ?(?:pant|suit|top)|cargo|hiking|camo|graphic|logo|fleece|puffer|featherbed|down vest|board ?short|beanie|bucket hat|trucker|sneaker', re.I)
SUMMER_WORDS = re.compile(r'linen|shorts|tank|sandal|seersucker|short[- ]sleeve|\btee\b|t-shirt|espadrille|swim|cotton-silk|camp collar|polo', re.I)


def season(today):
    m = today.month
    return 'winter' if m in (11, 12, 1, 2) else 'summer' if m in (5, 6, 7, 8) else 'mid'


def family(it):
    return (it.get('colour') or {}).get('family', 'grey')


def light(it):
    return (it.get('colour') or {}).get('light', 128)


class Taste:
    """What the owner liked before (from robot/feedback.json, written by the app)."""

    def __init__(self, feedback):
        self.item, self.brand, self.colour = {}, {}, {}
        self.hidden = set(feedback.get('hidden', []))

        def add(d, k, v):
            if k:
                d[k] = d.get(k, 0) + v
        for entry, w in [(e, 1.0) for e in feedback.get('kept', [])] + [(e, -0.6) for e in feedback.get('skipped', [])]:
            for it in entry.get('items', []):
                add(self.item, it.get('id'), w)
                add(self.brand, (it.get('brand') or '').lower(), w * 0.3)
                add(self.colour, it.get('colour'), w * 0.15)

    def __call__(self, it):
        s = self.item.get(it['id'], 0) + self.brand.get((it.get('brand') or '').lower(), 0) + self.colour.get((it.get('colour') or {}).get('name'), 0)
        return math.tanh(s / 2)


def score(outfit, ctx):
    items = outfit['all']
    s = 0.0
    # colour: neutrals first, at most one accent
    accents = sum(1 for i in items if family(i) == 'accent' and i['category'] not in ACCESSORY)
    s += {0: 1.0, 1: 0.6}.get(accents, -1.5)
    upper, pants, shoes = outfit['upper'][0], outfit['pants'], outfit['shoes']
    contrast = abs(light(upper) - light(pants))
    if contrast >= 40:
        s += 0.5
    elif contrast < 15 and family(upper) != family(pants):
        s -= 0.3
    if family(upper) == family(pants) == 'earth':
        s += 0.3  # tonal browns / camels - very on brand
    if len(outfit['upper']) == 2:
        a, b = outfit['upper']
        if abs(light(a) - light(b)) < 12 and (a.get('colour') or {}).get('name') == (b.get('colour') or {}).get('name'):
            s -= 0.4  # two layers in the exact same colour look like one blob
    if family(shoes) == 'accent':
        s -= 0.5
    # season
    sea = ctx['season']
    text = ' '.join(i['name'] for i in items)
    if sea == 'winter':
        s += 0.25 * min(3, len(WINTER_WORDS.findall(text))) - 0.8 * min(2, len(SUMMER_WORDS.findall(text)))
        if any(i['category'] == 'outer' for i in items):
            s += 0.4
    elif sea == 'summer':
        s += 0.2 * min(3, len(SUMMER_WORDS.findall(text))) - 0.6 * min(2, len(re.findall(r'coat|shearling|down|puffer|flannel|tweed', text, re.I)))
    # quiet luxury: tailored and refined beats sporty
    s -= 0.5 * min(3, len(CASUAL_WORDS.findall(text)))
    # variety and freshness
    brands = {i.get('brand', '').lower() for i in items}
    if len(brands) >= max(2, len(items) // 2):
        s += 0.2
    t = ctx['now']
    for i in items:
        if t - i.get('added', 0) < 3 * 86400:
            s += 0.25
        s -= 0.35 * ctx['recent'].get(i['id'], 0)
        s += 0.6 * ctx['taste'](i)
    return s + random.random() * 0.4


def make_outfit(pool, sea, rnd):
    def pick(cats):
        cands = [i for c in cats for i in pool.get(c, [])]
        return rnd.choice(cands) if cands else None
    layer = rnd.random() < (0.65 if sea == 'winter' else 0.35 if sea == 'mid' else 0.15)
    upper = []
    if layer and pool.get('outer'):
        upper.append(pick(['outer']))
        inner = pick(['top', 'base'])
        if inner:
            upper.append(inner)
    else:
        u = pick(['top', 'base'] if pool.get('top') or pool.get('base') else ['outer'])
        if u:
            upper.append(u)
    pants, shoes = pick(['pants']), pick(['shoes'])
    if not upper or not pants or not shoes:
        return None
    acc = []
    avail = [c for c in ACCESSORY if pool.get(c)]
    want = 2 if rnd.random() < 0.7 else 1
    if 'watch' in avail and rnd.random() < 0.8:
        acc.append(pick(['watch']))
        avail.remove('watch')
    rnd.shuffle(avail)
    for c in avail:
        if len(acc) >= want:
            break
        acc.append(pick([c]))
    return {'upper': upper, 'pants': pants, 'shoes': shoes, 'acc': acc, 'all': upper + [pants, shoes] + acc}


def signature(o):
    return '+'.join(sorted(i['id'] for i in o['upper'] + [o['pants']]))


def title(o):
    def c(it):
        return (it.get('colour') or {}).get('name', '')
    a, b = c(o['upper'][0]), c(o['pants'])
    if a and b and a != b:
        return f'{a.capitalize()} & {b}'
    return (a or b or 'Daily').capitalize() + ' tones'


def style(items, history, feedback, count=10, today=None, seed=None):
    today = today or dt.date.today()
    rnd = random.Random(seed if seed is not None else today.toordinal())
    random.seed(rnd.random())
    taste = Taste(feedback)
    items = [i for i in items if i['id'] not in taste.hidden]
    pool = {}
    for i in items:
        pool.setdefault(i['category'], []).append(i)
    sea = season(today)
    recent, old_sigs = {}, set()
    cutoff7 = (today - dt.timedelta(days=7)).isoformat()
    cutoff60 = (today - dt.timedelta(days=60)).isoformat()
    for h in history:
        if h['date'] >= cutoff60:
            old_sigs.add(h['sig'])
        if h['date'] >= cutoff7:
            for iid in h['items']:
                recent[iid] = recent.get(iid, 0) + 1
    ctx = {'season': sea, 'now': int(dt.datetime.combine(today, dt.time()).timestamp()), 'recent': recent, 'taste': taste}

    cands, seen = [], set()
    for _ in range(1500):
        o = make_outfit(pool, sea, rnd)
        if not o:
            break
        sig = signature(o)
        if sig in seen or sig in old_sigs:
            continue
        seen.add(sig)
        o['score'] = score(o, ctx)
        cands.append(o)
    cands.sort(key=lambda o: -o['score'])

    chosen, uses = [], {}
    limit = {c: 2 for c in UPPER + ('pants',)}
    limit.update({'shoes': 3, 'watch': 4, 'fragrance': 4, 'eyewear': 4, 'small': 4})
    for k in (1, 2, 4):  # with a small pool, allow pieces to repeat more rather than show fewer outfits
        for o in cands:
            if len(chosen) >= count:
                break
            if o in chosen or any(uses.get(i['id'], 0) >= limit.get(i['category'], 3) * k for i in o['all']):
                continue
            for i in o['all']:
                uses[i['id']] = uses.get(i['id'], 0) + 1
            chosen.append(o)
    chosen.sort(key=lambda o: -o['score'])

    out = []
    for n, o in enumerate(chosen):
        ids = [i['id'] for i in o['all']]
        alts = {}
        for i in o['all']:
            others = [x for x in pool.get(i['category'], []) if x['id'] not in ids]
            ranked = []
            for x in others:
                trial = dict(o)
                trial['all'] = [x if y is i else y for y in o['all']]
                trial['upper'] = [x if y is i else y for y in o['upper']]
                trial['pants'] = x if o['pants'] is i else o['pants']
                trial['shoes'] = x if o['shoes'] is i else o['shoes']
                ranked.append((score(trial, ctx), x['id']))
            ranked.sort(reverse=True)
            alts[i['id']] = [x for _, x in ranked[:4]]
        out.append({
            'id': f'{today.isoformat()}-{n + 1}',
            'title': title(o),
            'template': (n + rnd.randrange(TEMPLATE_COUNT)) % TEMPLATE_COUNT,
            'items': ids,
            'alts': alts,
            'score': round(o['score'], 2),
            'sig': signature(o),
        })
    missing = [c for c in ('pants', 'shoes') if not pool.get(c)]
    if not (pool.get('top') or pool.get('base') or pool.get('outer')):
        missing.insert(0, 'tops or jackets')
    return out, {'season': sea, 'candidates': len(cands), 'missing': missing}
