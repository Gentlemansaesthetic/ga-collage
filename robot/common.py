"""Shared helpers for the nightly robot: categories, colours, files."""
import hashlib
import json
import os
import re
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Same rules as guessCategory() in js/layouts.js - keep the two in step.
WORDS = [
    ('fragrance', r'parfum|perfume|cologne|eau de|fragrance|toilette|\bedp\b|\bedt\b'),
    ('watch', r'\bwatch(?!\s*(?:cap|coat|case|roll|box|strap|band|winder|hat|pouch))|chronograph|timepiece|\bautomatic \d+mm'),
    ('eyewear', r'sunglass|glasses|eyewear|aviator|wayfarer'),
    ('shoes', r'sneaker|trainer|\bshoes?\b|\bboots?\b|loafer|derby|oxford shoe|moccasin|espadrille|slip-on|chelsea'),
    ('small', r'watch (?:case|roll|box|pouch)|wallet|card ?holder|cardholder|card case|\bbelt\b|\bbag\b|briefcase|scarf|\btie\b|\bcap\b|\bhat\b|beanie|gloves|bracelet|\bring\b|necklace|cufflink'),
    ('pants', r'trouser|\bpants?\b|\bjeans?\b|chino|\bshorts\b|slacks|denim'),
    ('outer', r'jacket|\bcoat\b|\bvest\b|gilet|blazer|bomber|overshirt|parka|trench|shearling|puffer|blouson|peacoat|windbreaker|harrington'),
    ('base', r't-shirt|\btee\b|tank|undershirt|\bvest top'),
    ('top', r'sweater|jumper|knit|polo|\bshirt\b|turtleneck|rollneck|roll-neck|cardigan|hoodie|sweatshirt|half-zip|quarter-zip|pullover|crewneck|henley'),
]
WORDS = [(c, re.compile(p, re.I)) for c, p in WORDS]

UPPER = ('outer', 'top', 'base')
ACCESSORY = ('watch', 'fragrance', 'eyewear', 'small')


def guess_category(*texts):
    text = ' '.join(t for t in texts if t)
    for cat, rx in WORDS:
        if rx.search(text):
            return cat
    return 'other'


# Named colours. Neutrals are the quiet-luxury palette; everything else counts as an accent.
COLOURS = [
    ('black', (22, 22, 24), 'dark'), ('charcoal', (60, 61, 64), 'grey'), ('grey', (128, 128, 128), 'grey'),
    ('light grey', (190, 190, 188), 'grey'), ('white', (242, 242, 240), 'light'), ('cream', (232, 223, 204), 'light'),
    ('stone', (200, 190, 170), 'earth'), ('camel', (190, 150, 105), 'earth'), ('tan', (165, 125, 85), 'earth'),
    ('brown', (110, 75, 50), 'earth'), ('chocolate', (65, 45, 35), 'earth'), ('navy', (30, 38, 64), 'dark'),
    ('olive', (95, 95, 60), 'earth'), ('sage', (150, 160, 130), 'earth'),
    ('blue', (60, 100, 170), 'accent'), ('light blue', (160, 190, 220), 'accent'), ('green', (40, 110, 70), 'accent'),
    ('burgundy', (100, 30, 40), 'accent'), ('red', (190, 40, 40), 'accent'), ('pink', (225, 160, 170), 'accent'),
    ('yellow', (225, 200, 70), 'accent'), ('orange', (220, 120, 50), 'accent'), ('purple', (100, 60, 130), 'accent'),
    ('gold', (200, 165, 90), 'metal'), ('silver', (175, 178, 182), 'metal'),
]
NEUTRAL_FAMILIES = ('dark', 'grey', 'light', 'earth', 'metal')


def to_lab(rgb):
    def lin(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(v) for v in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116  # noqa: E731
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


_LABS = [(c, to_lab(c[1])) for c in COLOURS]


def colour_name(rgb):
    L, a, b = to_lab(rgb)
    best, bd = None, 1e9
    for c, (L2, a2, b2) in _LABS:
        # lightness matters a little less than hue for naming
        d = 0.6 * (L - L2) ** 2 + (a - a2) ** 2 + (b - b2) ** 2
        if d < bd:
            best, bd = c, d
    return best[0], best[2]


def lightness(rgb):
    r, g, b = rgb
    return round(0.2126 * r + 0.7152 * g + 0.0722 * b)


def make_id(*parts):
    return hashlib.sha1('|'.join(parts).encode()).hexdigest()[:12]


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, path)


def now():
    return int(time.time())


def log(*a):
    print('[robot]', *a, flush=True)
