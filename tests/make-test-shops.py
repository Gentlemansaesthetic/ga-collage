"""Builds two pretend Shopify shops (recoloured studio photos) for testing the robot offline.

  python3 tests/make-test-shops.py OUT_DIR
  (cd OUT_DIR && python3 -m http.server 8099)
  NO_PROXY=localhost python3 robot/run.py --data DATA_DIR --main MAIN_DIR
where MAIN_DIR/robot/sources.json lists http://localhost:8099/shopA and /shopB
and MAIN_DIR/models links to the project's models folder.
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'robot'))
import cutout  # noqa: E402

OUT = sys.argv[1]
ST = os.path.join(HERE, 'fixtures', 'studio')
os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)


def recolor(name, rgb, out):
    a = np.asarray(Image.open(os.path.join(ST, name)).convert('RGB')).astype(np.float32)
    m = cutout.plain_mask(a.astype(np.uint8)) > 128
    lum = a.mean(axis=2, keepdims=True) / 255
    col = np.clip(np.array(rgb, np.float32) * (lum / lum[m].mean()), 0, 255)
    a[m] = col[m]
    Image.fromarray(a.astype(np.uint8)).save(os.path.join(OUT, 'img', out + '.jpg'), quality=92)


VARIANTS = {
    'jacket.jpg': {'Camel Suede Bomber Jacket': (190, 150, 105), 'Navy Wool Overcoat': (35, 42, 66), 'Olive Suede Overshirt': (95, 95, 60), 'Charcoal Cashmere Blazer': (62, 62, 66)},
    'tee.jpg': {'Cream Cashmere Crewneck Sweater': (232, 223, 204), 'Navy Merino Polo Shirt': (32, 40, 66), 'Grey Cashmere Turtleneck': (128, 128, 128), 'White Cotton T-Shirt': (240, 240, 238), 'Chocolate Knit Polo': (70, 48, 38)},
    'pants.jpg': {'Cream Pleated Wool Trousers': (232, 223, 204), 'Grey Flannel Trousers': (120, 120, 122), 'Navy Cotton Chinos': (35, 42, 66), 'Brown Corduroy Trousers': (105, 72, 50)},
    'sneaker.jpg': {'Brown Suede Sneakers': (105, 72, 50), 'White Leather Sneakers': (238, 238, 236), 'Black Suede Loafers': (30, 30, 32)},
}
BRANDS = ['Luca Faloni', 'Brunello Cucinelli', 'Loro Piana', 'Zegna']
shops = {'shopA': [], 'shopB': []}
n = 0
for src, vs in VARIANTS.items():
    for title, rgb in vs.items():
        n += 1
        recolor(src, rgb, f'p{n}')
        shops['shopA' if n % 2 else 'shopB'].append({'id': n, 'title': title, 'handle': f'p{n}', 'vendor': BRANDS[n % 4], 'product_type': '', 'tags': ['Men'],
                                                     'variants': [{'price': f'{400 + n * 95}.00', 'available': True}], 'images': [{'src': f'http://localhost:8099/img/p{n}.jpg'}]})
shutil.copy(os.path.join(ST, 'rolex.jpg'), os.path.join(OUT, 'img', 'w1.jpg'))
shutil.copy(os.path.join(ST, 'fragrance.jpg'), os.path.join(OUT, 'img', 'f1.jpg'))
extra = [('Day-Date 40 Watch', 'w1', 'Rolex', 'Watches', '38000.00', True), ('Layton Eau de Parfum', 'f1', 'Parfums de Marly', 'Fragrance', '335.00', True),
         ("Women's Cashmere Sweater", 'p5', 'X', '', '900.00', True), ('Sold Out Loafers', 'p5', 'X', '', '900.00', False), ('Gift Card', 'p5', 'X', '', '900.00', True)]
for title, img, brand, ptype, price, avail in extra:
    shops['shopB'].append({'title': title, 'handle': title.lower().replace(' ', '-').replace("'", ''), 'vendor': brand, 'product_type': ptype, 'tags': [],
                           'variants': [{'price': price, 'available': avail}], 'images': [{'src': f'http://localhost:8099/img/{img}.jpg'}]})
for name, prods in shops.items():
    os.makedirs(os.path.join(OUT, name), exist_ok=True)
    with open(os.path.join(OUT, name, 'products.json'), 'w') as f:
        json.dump({'products': prods}, f)
print('shops written to', OUT)
