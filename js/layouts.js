// Pin size and the automatic layouts (modelled on the Gentleman's Aesthetic reference pins).
export const W = 1000;
export const H = 1500;

export const CATEGORIES = [
  { id: 'outer', label: 'Jacket / coat / vest' },
  { id: 'top', label: 'Sweater / shirt / polo' },
  { id: 'base', label: 'T-shirt / tank' },
  { id: 'pants', label: 'Trousers' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'watch', label: 'Watch' },
  { id: 'fragrance', label: 'Fragrance' },
  { id: 'eyewear', label: 'Sunglasses' },
  { id: 'small', label: 'Wallet / belt / small item' },
  { id: 'other', label: 'Other' },
];

const WORDS = [
  ['fragrance', /parfum|perfume|cologne|eau de|fragrance|toilette|\bedp\b|\bedt\b/i],
  ['watch', /\bwatch(?!\s*(?:cap|coat|case|roll|box|strap|band|winder|hat|pouch))|chronograph|timepiece|\bautomatic \d+mm/i],
  ['eyewear', /sunglass|glasses|eyewear|aviator|wayfarer/i],
  ['shoes', /sneaker|trainer|\bshoes?\b|\bboots?\b|loafer|derby|oxford shoe|moccasin|espadrille|slip-on|chelsea/i],
  ['small', /watch (?:case|roll|box|pouch)|wallet|card ?holder|cardholder|card case|\bbelt\b|\bbag\b|briefcase|scarf|\btie\b|\bcap\b|\bhat\b|beanie|gloves|bracelet|\bring\b|necklace|cufflink/i],
  ['pants', /trouser|\bpants?\b|\bjeans?\b|chino|\bshorts\b|slacks|denim/i],
  ['outer', /jacket|\bcoat\b|\bvest\b|gilet|blazer|bomber|overshirt|parka|trench|shearling|puffer|blouson|peacoat|windbreaker|harrington/i],
  ['base', /t-shirt|\btee\b|tank|undershirt|\bvest top/i],
  ['top', /sweater|jumper|knit|polo|\bshirt\b|turtleneck|rollneck|roll-neck|cardigan|hoodie|sweatshirt|half-zip|quarter-zip|pullover|crewneck|henley/i],
];

export function guessCategory(text) {
  if (!text) return 'other';
  for (const [id, re] of WORDS) if (re.test(text)) return id;
  return 'other';
}

// Size of the box (as a share of pin width / height) each accessory is fitted into.
const ACC_BOX = {
  watch: [0.22, 0.22],
  fragrance: [0.22, 0.25],
  eyewear: [0.29, 0.12],
  small: [0.24, 0.14],
  other: [0.2, 0.18],
  outer: [0.3, 0.22], top: [0.3, 0.22], base: [0.28, 0.2], pants: [0.2, 0.3], shoes: [0.26, 0.13],
};

// x, y = centre of the slot; w, h = the biggest the item may be. All as shares of the pin.
// `acc` slots list which accessory they are meant for first.
export const TEMPLATES = [
  {
    name: 'Centered',
    main: { x: 0.47, y: 0.245, w: 0.50, h: 0.34 },
    second: { x: 0.675, y: 0.185, w: 0.42, h: 0.30 },
    pants: { x: 0.47, y: 0.655, w: 0.3, h: 0.5 },
    shoes: { x: 0.19, y: 0.8, w: 0.27, h: 0.17 },
    acc: [
      { x: 0.17, y: 0.44, for: ['watch'] },
      { x: 0.79, y: 0.49, for: ['fragrance'] },
      { x: 0.78, y: 0.75, for: ['small'] },
      { x: 0.17, y: 0.62, for: ['eyewear'] },
      { x: 0.8, y: 0.88, for: [] },
    ],
  },
  {
    name: 'Classic',
    main: { x: 0.46, y: 0.265, w: 0.50, h: 0.35 },
    second: { x: 0.665, y: 0.19, w: 0.42, h: 0.31 },
    pants: { x: 0.48, y: 0.655, w: 0.3, h: 0.47 },
    shoes: { x: 0.73, y: 0.85, w: 0.32, h: 0.14 },
    acc: [
      { x: 0.17, y: 0.52, for: ['eyewear'] },
      { x: 0.2, y: 0.72, for: ['watch'] },
      { x: 0.79, y: 0.57, for: ['fragrance'] },
      { x: 0.19, y: 0.89, for: ['small'] },
      { x: 0.8, y: 0.36, for: [] },
    ],
  },
  {
    name: 'Two columns',
    main: { x: 0.3, y: 0.265, w: 0.50, h: 0.35 },
    second: { x: 0.44, y: 0.2, w: 0.38, h: 0.32 },
    pants: { x: 0.31, y: 0.675, w: 0.3, h: 0.48 },
    shoes: { x: 0.75, y: 0.855, w: 0.33, h: 0.14 },
    column: { x: 0.74, y0: 0.17, y1: 0.66, order: ['eyewear', 'watch', 'small', 'other', 'fragrance'] },
  },
  {
    name: 'Side by side',
    main: { x: 0.275, y: 0.25, w: 0.50, h: 0.34 },
    second: { x: 0.725, y: 0.255, w: 0.44, h: 0.30 },
    pants: { x: 0.275, y: 0.67, w: 0.3, h: 0.48 },
    shoes: { x: 0.68, y: 0.86, w: 0.34, h: 0.14 },
    acc: [
      { x: 0.56, y: 0.56, for: ['watch'] },
      { x: 0.8, y: 0.64, for: ['fragrance'] },
      { x: 0.76, y: 0.46, for: ['eyewear', 'small'] },
      { x: 0.57, y: 0.74, for: ['small'] },
      { x: 0.5, y: 0.44, for: [] },
    ],
  },
  {
    name: 'Layered',
    main: { x: 0.6, y: 0.285, w: 0.50, h: 0.34 },
    second: { x: 0.37, y: 0.2, w: 0.41, h: 0.30 },
    pants: { x: 0.5, y: 0.665, w: 0.3, h: 0.5 },
    shoes: { x: 0.7, y: 0.83, w: 0.32, h: 0.13 },
    acc: [
      { x: 0.2, y: 0.47, for: ['watch'] },
      { x: 0.81, y: 0.62, for: ['fragrance'] },
      { x: 0.2, y: 0.66, for: ['eyewear'] },
      { x: 0.2, y: 0.84, for: ['small'] },
      { x: 0.82, y: 0.1, for: [] },
    ],
  },
  {
    name: 'Mirrored',
    main: { x: 0.715, y: 0.26, w: 0.49, h: 0.34 },
    second: { x: 0.265, y: 0.265, w: 0.44, h: 0.31 },
    pants: { x: 0.71, y: 0.685, w: 0.29, h: 0.47 },
    shoes: { x: 0.4, y: 0.84, w: 0.34, h: 0.14 },
    acc: [
      { x: 0.2, y: 0.53, for: ['eyewear'] },
      { x: 0.46, y: 0.56, for: ['watch'] },
      { x: 0.19, y: 0.72, for: ['fragrance'] },
      { x: 0.45, y: 0.72, for: ['small'] },
      { x: 0.19, y: 0.89, for: [] },
    ],
  },
];

function fit(item, x, y, w, h) {
  const k = Math.min((w * W) / item.w, (h * H) / item.h);
  item.s = item.w * k;
  item.x = x * W;
  item.y = y * H;
}

const UPPER = { outer: 0, top: 1, base: 2 };

// Places every item according to the template. Changes items in place.
export function applyLayout(items, index) {
  const t = TEMPLATES[((index % TEMPLATES.length) + TEMPLATES.length) % TEMPLATES.length];
  const uppers = items.filter((i) => i.category in UPPER).sort((a, b) => UPPER[a.category] - UPPER[b.category]);
  const main = uppers[0];
  const second = uppers[1];
  const pants = items.find((i) => i.category === 'pants');
  const shoes = items.find((i) => i.category === 'shoes');
  const placed = new Set([main, second, pants, shoes].filter(Boolean));
  const accs = items.filter((i) => !placed.has(i));

  if (second) { fit(second, t.second.x, t.second.y, t.second.w, t.second.h); second.z = 1; }
  if (pants) { fit(pants, t.pants.x, t.pants.y, t.pants.w, t.pants.h); pants.z = 2; }
  if (main) { fit(main, t.main.x, t.main.y, t.main.w, t.main.h); main.z = 3; }
  if (shoes) { fit(shoes, t.shoes.x, t.shoes.y, t.shoes.w, t.shoes.h); shoes.z = 20; }

  const box = (i) => ACC_BOX[i.category] || ACC_BOX.other;
  if (t.column) {
    const order = t.column.order;
    const rank = (i) => { const r = order.indexOf(i.category); return r < 0 ? order.indexOf('other') : r; };
    const list = accs.slice().sort((a, b) => rank(a) - rank(b));
    const n = list.length;
    const shrink = n > 3 ? 3.4 / n : 1;
    list.forEach((it, k) => {
      const y = n === 1 ? (t.column.y0 + t.column.y1) / 2 : t.column.y0 + ((t.column.y1 - t.column.y0) * k) / (n - 1);
      const [bw, bh] = box(it);
      fit(it, t.column.x, y, bw, bh * shrink);
      it.z = 5 + k;
    });
  } else {
    const free = t.acc.slice();
    const todo = [];
    for (const it of accs) {
      const k = free.findIndex((s) => s.for.includes(it.category));
      if (k >= 0) { place(it, free.splice(k, 1)[0]); } else todo.push(it);
    }
    todo.forEach((it, n) => {
      const s = free.shift() || { x: 0.5 + 0.04 * n, y: 0.5 + 0.04 * n };
      place(it, s);
    });
  }
  function place(it, s) {
    const [bw, bh] = box(it);
    fit(it, s.x, s.y, bw, bh);
    it.z = 5 + accs.indexOf(it);
  }
  items.forEach((i) => { i.manual = false; });
  return t.name;
}

// Where a newly added item goes when the others were arranged by hand.
export function placeLoose(item, items) {
  const [bw, bh] = ACC_BOX[item.category] || ACC_BOX.other;
  fit(item, 0.5, 0.5, Math.max(bw, 0.3), Math.max(bh, 0.25));
  item.z = Math.max(0, ...items.map((i) => i.z || 0)) + 1;
  item.manual = true;
}
