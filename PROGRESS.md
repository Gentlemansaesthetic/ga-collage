# PROGRESS – Gentleman's Aesthetic Collage Maker

Handoff notes for a new session with no memory of the original chat.
Last updated: 2026-11-13. State: **app is on GitHub (`Gentlemansaesthetic/ga-collage`, branch `main`). "Daily Picks" (nightly robot + Today tab) built and tested locally against pretend shops; not yet confirmed running on GitHub or on a real iPhone.**

> **Big change on 2026-11-13 – read section 0 first.** The owner found hand-building collages too much work.
> The app now has a nightly robot that finds products, cuts them out and makes ~10 outfits a day; the owner just keeps the best.

---

## 0. Daily Picks (added 2026-11-13)

**Why:** "This app is completely defeating the purpose… I want the app to find all the pieces and make a specific amount of outfits a day. I choose one, two, three… and just look it over." The owner's answers when asked:
- Where to look: **both** – shops they pick now, **affiliate networks** later.
- Links should **earn commission**.
- Price level: **true luxury** (Loro Piana, Brunello Cucinelli, Zegna, Cartier).

**How it works**
1. **Robot** (`robot/`, Python) runs on **GitHub Actions** every day at 10:17 UTC (~5 am US Eastern) – free on public repos, computer can be off. Workflow: `.github/workflows/daily.yml`.
   - `collect.py` reads each shop's open Shopify product list (`<shop>/products.json`) and, in Phase 2, affiliate product feeds (Google-Shopping-style CSV/TSV/XML, gzipped OK). Filters out women's/kids/gift cards, sold-out, below `min_price`, and anything whose type can't be guessed.
   - `cutout.py` = Python copy of the app's cutout (same ISNet model + plain-background method + 1 px edge trim). **Mask only – product pixels are never changed.** Rejects photos with a busy background, a face in them (OpenCV face detector), the product cut off at the edge, or a failed cut. Tries up to 4 photos per product.
   - `stylist.py` makes outfits: top/jacket (+ layer in winter), trousers, shoes, 1–2 accessories (watch first). Scores: neutral palette with at most one accent, light/dark contrast, tonal browns bonus, season words, brand variety, new items bonus, recently-used penalty, owner's keep/skip history. Makes ~1500 candidates, keeps the best N with limits on repeats; no top+trousers combo repeated within 60 days. Gives up to 4 swap alternatives per piece.
   - `run.py` ties it together; tops up the categories the pool needs most (targets in `TARGET`), max `new_items_per_run` new products and 25 min of cutting per run; drops products a shop no longer lists (after 3 days) and trims the pool to ~2× targets.
   - Output goes to the **`data` branch**, which is **replaced every run** (single commit, so the repo doesn't grow): `pool/catalog.json`, `pool/items/<id>.webp`, `pool/rejects.json`, `daily/latest.json`, `daily/<date>.json` (30 days), `daily/history.json` (90 days), `daily/status.json`.
2. **App** has a new first tab, **Today** (`js/today.js`): reads `https://raw.githubusercontent.com/<repo>/data/daily/latest.json` (repo worked out from the `*.github.io/<repo>/` address, or Settings). Each outfit is drawn with the app's own `renderLook` + `applyLayout`. Buttons: **Skip**, **Swap** (pick another piece from the alternatives; "Don't use this piece again"), **Keep** (becomes a normal look in Library, fully editable, then Edit / Export).
3. **Feedback loop:** kept/skipped/hidden are saved on the phone and written to `robot/feedback.json` on `main` (needs the GitHub token). The robot reads it next run.
4. **Settings → Daily outfits:** last-run summary, outfits per day (3/5/10/15/20), the shop list with per-shop status from the last run (pieces found / error), Pause / Remove / Add shop (writes `robot/sources.json`), and **Make new outfits now** (starts the workflow; token needs Actions permission).
5. **Items pasted by hand** are also sent to the robot (`pool/manual/<id>.png` + `pool/manual.json` on `main`) and reused in future outfits – one paste, many pins. Good for watches/fragrance, which few Shopify shops sell.
6. **Shop this look website:** `site/index.html`, served at `https://gentlemansaesthetic.github.io/ga-collage/site/`. Lists published looks from `looks/index.json`; each look page has the pin, every piece, price, a Shop button (`rel="sponsored"`) and an affiliate disclosure. The Export screen's **Publish to Shop this look** uploads the look to `looks/<id>/` on `main` and copies the look's link (`…/site/#<id>`) for the Pinterest pin. Backups now go to the same repo as the app.

**Phases**
- Phase 1 (built): shop list + robot + Today + feedback + website.
- Phase 2 (not started – needs the owner): apply to affiliate networks / creator programmes; real luxury (Loro Piana, Brunello Cucinelli, Zegna…) mostly comes through big retailers on these networks. When approved, the feed address goes into a GitHub secret `FEED_1`…`FEED_4` (never in files) and a `feeds` entry in `robot/sources.json` like `{"name": "Mr Porter", "type": "feed", "secret": "FEED_1", "on": true}`. Optional per-source fields: `brands` (allow-list), `min_price`, `exclude_words`, `currency`, `affiliate_template` (`{url}` placeholder, for shops where you wrap links).
- Phase 3 (ideas): "Today's picks are ready" phone notification, smarter taste learning, scheduling pins straight to Pinterest.

**Honest limits**
- **First real run on GitHub (2026-11-13): worked.** 288 s, 10 outfits. Shops that work: Drake's (881 usable products), Sunspel (452), Anglo-Italian (228), Garrett Leight (155), Baudoin & Lange (117), Private White V.C. (81), Colhay's (63), Jacques Marie Mage (63), D.S. & Durga (24). **Not working:** Luca Faloni ("blocks automatic visits"), The Armoury (no product list – not Shopify or wrong address), Common Projects ("could not reach"). Consider removing those three or finding the right address. Currencies in `sources.json` are still guesses.
- Real cutouts looked clean. Problems seen in the first real outfits, fixed the same day: "Watch Coat"/"Watch Cap"/"Watch Case" taken for watches; lounge sets and spurs; messy brand names ("Drakes - UK/ROW", "PrivateWhite V.C", "GLCO") → `clean_brand()` + `brand` per shop; too many casual pieces → `CASUAL_WORDS` penalty in `stylist.py` and a longer `DEFAULT_EXCLUDE` list in `collect.py`.
- **No real watches** in the pool: none of these shops sell them. Until Phase 2 the owner should add a few watches by hand (they are reused).
- True-luxury brands' own sites don't offer open product lists; they arrive with Phase 2.
- Styling is rules, not a paid AI.

---

## 1. Who this is for and what they asked for

The owner runs a men's style Pinterest account, **Gentleman's Aesthetic** (quiet luxury: classy, minimal, timeless).
They make "flat lay" outfit collages by hand in Canva and want a tool that does the cutting and arranging.
They still choose the items. **They are not a developer – explain everything in plain English.**

Hard rules from the owner (do not break these):

1. Must work on their **iPhone, anywhere, with the computer off**.
2. **Free to run.** No paid services or subscriptions.
3. Items in the collage must be the **real product photos**, cut out cleanly. **Never let AI redraw or generate a product** – the pins link to the actual items.
4. Pins are **1000 × 1500** (Pinterest 2:3).
5. With each collage, **save a list of the items** (name, brand, link, etc.) for future "Shop this look" pages on a website.
6. Everything else (how it's built, hosting, layouts, editing features) was left to Claude.

Later requests:
- The GA logo is only for the bottom of the pin.
- They supplied the brown textured background. A reference pin with a wood background was for layout only – don't use wood.
- "Make it work sort of like an iOS app."
- Less manual labour: rather than saving photos first, they want to **choose from photos the app collects**.
- No website yet – "make it in a way that I can link it afterwards".
- They believe they have a free GitHub account (can create a new one).

---

## 2. What the tool does (plain English)

It is a web app that is added to the iPhone home screen and then behaves like an app (full screen, own icon, three tabs at the bottom: **Create / Library / Settings**).

1. **Add an item.** Three ways:
   - Copy a product page link in Safari → in the app tap **Paste link or copied photo**. The app shows that page's photos; tap the right one. Name, brand, price and link are filled in. (Needs the free "link helper", section 6.)
   - Press-and-hold a photo in Safari → Copy → **Paste link or copied photo**.
   - **Choose from Photos**.
2. **Cutout.** The app removes the background from that photo on the phone. It only decides which pixels to keep; the kept pixels are the original photo.
3. **Details.** A form to confirm name, brand, link, price, type (jacket, trousers, shoes, watch…), notes. The type decides where the item sits.
4. **Arrange.** **Layout** flips through six arrangements (Centered, Classic, Two columns, Side by side, Layered, Mirrored) modelled on the owner's reference pins. Drag to move, pinch or drag the round handle to resize. Tapping an item gives: Details, Touch up, Forward, Back, Flip, Shadow, Copy, Remove.
5. **Touch up.** Full-screen eraser / "bring back" brush, two-finger zoom, Undo, Trim edge, Backdrop preview, Start over (re-cut automatically / plain-background cut at different strengths / no cutout).
6. **Other controls.** Backdrop (brown, tan, espresso, or the owner's own image), Brands (brand name under each item, on/off), Logo (on/off), Undo.
7. **Export.** Save/share the 1000 × 1500 pin, copy the item list as text, optionally back up to GitHub.
8. **Library.** Every look is stored on the phone. Tap one to Open / Make a copy / Copy item list / Delete. **Export all** gives a spreadsheet (CSV) or a data file (JSON) of every look.

---

## 3. How it is built

No build step, no framework, no server of our own. Plain HTML/CSS/JavaScript modules.

| Path | What it is |
|---|---|
| `index.html`, `css/app.css` | The screens and the styling |
| `manifest.webmanifest`, `sw.js` | Home-screen install + offline. Service worker: app files are network-first with a cached fallback; `models/` and `vendor/` are cache-first (big, never change) |
| `js/app.js` | Everything the user touches: tabs, sheets, add-item flow, details form, export, library, settings. Exposes `window.ga` (state, editor, processPhoto, saveNow, setLook, blankLook, showTab) for tests |
| `js/cutout.js` | Background removal logic (see section 4) |
| `js/seg-worker.js` | Runs the cutout model in a background thread |
| `js/editor.js` | Draws the pin on a fixed 1000 × 1500 canvas; drag / pinch / resize; centre snap guide |
| `js/layouts.js` | The six layout templates, item types, type guessing from the name |
| `js/touchup.js` | The touch-up screen |
| `js/db.js` | Storage on the phone (IndexedDB: `looks` and `kv`). Images stored as `{buf, type}` |
| `js/github.js` | GitHub API: publish looks, read/write JSON files, start the robot |
| `js/today.js` | The Today tab (daily outfits), feedback sync, shop-list read/write, sharing hand-added items with the robot |
| `robot/` | The nightly robot (Python): `run.py`, `collect.py`, `cutout.py`, `stylist.py`, `common.py`, `sources.json` (shop list), `feedback.json` (written by the app), `requirements.txt` |
| `.github/workflows/daily.yml` | Runs the robot daily, on demand, and when the shop list / hand-added items / robot code change |
| `pool/manual.json`, `pool/manual/` | Items added by hand in the app, for the robot (created by the app) |
| `looks/` | Published looks for the website (created by the app's Publish button) |
| `site/index.html` | The "Shop this look" website |
| `worker/worker.js` | The link helper (Cloudflare Worker). The app shows its code with the private key filled in |
| `assets/` | `bg-brown.jpg` (owner's texture), `bg-tan.jpg`, `bg-espresso.jpg`, `logo.png` (owner's GA logo), icons |
| `models/isnet_fp16.onnx` | Cutout model, 88 MB |
| `vendor/ort/` | onnxruntime-web 1.21.0 (runs the model in the browser) |
| `dev-server.mjs` | Local preview server for testing only |
| `tests/` | Test scripts, sample photos, pretend-shop builder (section 7) |
| `README.md` | Short plain-English user guide |
| `.nojekyll` | Tells GitHub Pages to serve files as they are |

Data saved per look (also the GitHub backup format):

```
looks/index.json            list of all looks, newest first
looks/<id>/pin.jpg          the finished pin
looks/<id>/look.json        id, title, dates, items[]: name, brand, category, price, url, notes, image
looks/<id>/items/<n>.png    each cut-out product (max 700 px)
```

---

## 4. Decisions made, and why

**Form: installable web app (PWA), not a native iOS app.** A real App Store app costs $99/year and needs a Mac. A web app added to the home screen is free, works anywhere, and looks app-like.

**Hosting: GitHub Pages.** Free, no server to keep running, and the owner already has (or can make) a GitHub account. The app is only static files.

**Cutouts happen on the phone, not on a server.** Free forever, private, no paid API. Cost: an 88 MB one-time download and slower cutting.

**Cutout model: ISNet (fp16).** Chosen in testing over lighter options because it cut product photos most cleanly. It outputs only a mask (keep / don't keep). The mask is applied to the **original** photo pixels, which is how the "never redraw products" rule is guaranteed. No generative model is used anywhere.

**Hybrid cutout (`autoMask` in `js/cutout.js`).** Most shop photos are on plain white/grey. So: run the model, and also do a simple "remove the plain background from the edges inward" cut. If both agree, use the sharper plain-background edge limited to where the model saw the product; if they disagree, pick whichever is more plausible. Afterwards one pixel is shaved off the edge automatically to remove the pale fringe that shows on dark backdrops. Photos that already have a transparent background are used as they are.

**"Simple" engine option (Settings).** Plain-background cut only, no model. A fallback if the iPhone is too slow or runs out of memory with the 88 MB model.

**Crash guard.** Before running the model the app notes it is cutting. If iOS kills the app mid-cut, the next launch explains what happened and offers Simple mode.

**Layouts as templates with slots by item type.** Each item has a type; each template has slots (main piece, second piece, shoes, accessories). This is why the Type field matters. Sizes were tuned by rendering test outfits next to the owner's reference pins. Once the user moves or resizes an item it is marked manual.

**Look and feel.** Dark espresso interface, serif headings, tan accent, bottom tabs and slide-up sheets – to match the brand and feel like an iOS app. Default backdrop is the owner's brown texture. GA logo bottom centre, on by default. Soft drop shadow on items, on by default. Brand labels are optional because some reference pins have them.

**Link helper: a Cloudflare Worker.** A web page isn't allowed to read other websites directly, so something in between is required to "collect photos from a link". Cloudflare's free tier covers this and needs no card. It reads the product page (structured product data, meta tags, images on the page, Shopify's product file), returns name/brand/price/photo links, and passes photos through. It only answers requests carrying a private key that the app generates, so strangers can't use it. The app works without it (copy photo / Photos).

**Website link: back up looks to a GitHub repository.** The owner has no website yet. Saving each look as plain files (pin, item images, JSON) means any future site can read them. "Export all" (CSV/JSON) is the manual alternative.

**No sharing into the app from Safari's share button.** iOS does not allow home-screen web apps to appear in the share sheet. Claude wrongly promised this early on and has corrected it with the owner. The flow is copy → Paste.

**No accounts, no analytics, no outside services** beyond the owner's own Cloudflare Worker and GitHub.

---

## 5. What was tested, and what was not

Testing was done in headless Chromium at iPhone size (390 × 844, touch), on a Linux sandbox. **Not Safari, not an iPhone.**

### Tested and working
- App loads with no errors; Create, Library and Settings screens render.
- Add-item sheet; paste-link flow → photo grid → pick → cutout → details form prefilled (name, brand, link, price).
- Automatic cutout with the model on synthetic studio photos (white/grey backgrounds): trousers, jacket, sneaker, T-shirt cut cleanly. About 13–15 s per photo in the sandbox.
- Simple engine on the same studio photos.
- Photos with an existing transparent background are accepted as-is.
- All six layouts rendered for three test outfits and compared by eye with the reference pins.
- Drag to move (marks item as manual, records undo), selection toolbar appears.
- Touch up opens, paints, Undo, Cancel.
- Brand labels toggle; look title.
- Export: PNG is exactly 1000 × 1500; item list text is correct.
- Library: look appears, Make a copy, Delete, Open; look survives a page reload.
- Export all → CSV (quotes escaped correctly).
- Settings: link helper "Save and test" → Connected; "Copy helper code" copies the code with the generated key filled in.
- Link helper parsing, against a sample product page written for the test: name/brand/price, images from several sources, wrong key refused, blocked shop message, local addresses refused, photo pass-through.
- GitHub backup against a **stand-in** for GitHub: uploads item images, pin.jpg, look.json, index.json and marks the look "backed up".

### Daily Picks – tested locally (2026-11-13)
- Robot against two pretend Shopify shops (recoloured studio photos served on localhost) plus a broken shop: 17 products collected and cut (1–5 s each), women's / sold-out / gift card filtered, a photo of a person on a busy background rejected, broken shop reported in plain words, 10 outfits made with swap alternatives, `--keep-today` keeps the day's set, items added by hand imported and used, `hidden` respected.
- Today tab in the browser: 10 cards drawn, Swap changes the piece + title + brands, Keep → Library look with correct item list, prices and links; Export from a kept look; Skip.
- GitHub features against a **pretend** GitHub: connect, shop list add / pause / outfits-per-day (writes `robot/sources.json`), Make new outfits now (workflow dispatch), feedback written to `robot/feedback.json`, hand-added item uploaded to `pool/manual/`, Publish to Shop this look + pin link.
- Earlier tests (full flow, library, link helper) still pass after the changes.

### Daily Picks – NOT tested yet
- Real cutout quality on real shop photos (model shots, ghost mannequins, odd crops). Face detection catches faces only; cropped on-body shots without a face may slip through (they are often cut off at the photo edge, which is rejected).
- The website on GitHub Pages; raw.githubusercontent.com reading from the iPhone.
- Whether GitHub keeps the daily schedule running: GitHub pauses scheduled workflows in repos with no activity for 60 days. The app's feedback writes count as activity; if the owner stops using the app, the robot may pause (re-enable from the Actions tab).

### Not tested
- **A real iPhone / Safari at all.** Unknown: memory and speed with the 88 MB model, home-screen install, offline behaviour, the save/share sheet, clipboard paste (iOS shows its own "Paste" bubble), gestures with real fingers.
- **Real shop links.** Shop websites were blocked in the sandbox. The helper has never read a real product page.
- **A real Cloudflare Worker deployment.**
- **Real GitHub backup** (real token, real repository) and GitHub Pages hosting.
- Pinch-to-resize and the round resize handle (only dragging was automated).
- Pasting a copied photo (only pasting a link was automated).
- Choose from Photos through the real file picker.
- Custom backdrop upload; backdrop switching; Logo toggle; Flip, Shadow, Forward/Back, Copy, Remove buttons; Layout button taps (layouts were checked by rendering).
- Touch up: Bring back, Trim edge, Start over options, two-finger zoom.
- Export all → JSON; Copy item list.
- The crash-guard message.
- Service worker / offline.

---

## 6. Setup still needed

Done: GitHub account `Gentlemansaesthetic`, public repo `ga-collage`, Claude GitHub app installed, code pushed to `main`.

### A. Owner
1. **Pages: done** (the owner switched it on; GitHub's "pages build and deployment" runs succeed). App: `https://gentlemansaesthetic.github.io/ga-collage/`. Website: `…/ga-collage/site/`.
2. **Actions: working** (the robot ran successfully on 2026-11-13). Claude can read run status with `gh api repos/Gentlemansaesthetic/ga-collage/actions/runs`, and the results by cloning the `data` branch.
3. **iPhone:** open the app address in Safari → Share → Add to Home Screen.
4. **GitHub token for the app** (Settings → Connect GitHub; steps are in the app): fine-grained token, only the `ga-collage` repository, **Contents: Read and write** and **Actions: Read and write**. Paste in the app. Needed for: learning from keep/skip, editing the shop list, Make new outfits now, reusing hand-added items, Publish to Shop this look.

### B. Cloudflare link helper (optional now)
Only needed to add pieces by hand from a product link. Steps in the app (Settings → Link helper): free Cloudflare account → Worker → paste the code from **Copy helper code** → paste the Worker address back.

### C. Phase 2 – affiliate networks (owner)
Apply to affiliate networks / creator programmes that carry luxury menswear retailers. Approval usually wants a website: the Shop this look site is that. When approved, put each feed's address in a **GitHub secret** (repo Settings → Secrets and variables → Actions → New repository secret, names `FEED_1`…`FEED_4`), then add a `feeds` entry in `robot/sources.json` (section 0).

### What goes where (values never in files)
| Setting | Where it lives | Where it comes from |
|---|---|---|
| GitHub repository (`Gentlemansaesthetic/ga-collage`) | App Settings (filled in automatically) | – |
| GitHub token | App Settings, on the phone only | Owner creates it on GitHub |
| Link helper address | App Settings | Cloudflare, after deploying |
| Link helper key | App (generated), inside the copied Worker code | Automatic – the owner never types it |
| Affiliate feed addresses | GitHub repo secrets `FEED_1`…`FEED_4` | Affiliate networks |

Never commit a token, key or feed address. `worker/worker.js` holds only the `__KEY__` placeholder.

---

## 7. How to run and test

Run locally:

```bash
cd ga-collage
EXTRA_ROOT=tests/fixtures node dev-server.mjs
```

Open http://localhost:8080/ . The server also mounts the link helper at `/helper` and serves the test photos at `/_t/`.

Automated tests (need Playwright with Chromium; in Claude's cloud sandbox set `PLAYWRIGHT=/opt/node-tools/node_modules/playwright/index.js`). Start the server above first, on port 8080.

```bash
node tests/worker-parser.mjs
```
```bash
node tests/full-flow.mjs
```
```bash
node tests/library-simple.mjs
```

- `worker-parser.mjs` – link helper against a made-up product page. Prints the parsed result.
- `full-flow.mjs` – settings → paste link → pick photo → cutout → details → more items → drag → touch up → export → backup (GitHub is faked) → library → reload. Takes about a minute. Lines saying `404` in its output are the fake GitHub answering "file doesn't exist yet" and are expected.
- `library-simple.mjs` – Simple engine, Export all CSV, library menu.
- Screenshots land in `tests/shots/` (not committed). These are print-and-look scripts, not pass/fail tests.
- `today.mjs` – Today tab with a local copy of robot output: cards, Swap, Keep, Skip, Export. Needs `DATA_ROOT` (below).
- `github-features.mjs` – Connect GitHub, shop list, outfits per day, Make new outfits now, feedback sync, hand-added item → robot pool, all against a pretend GitHub. Needs `DATA_ROOT`.
- `tests/fixtures/studio/` – synthetic studio photos on white/grey. `tests/fixtures/out/` – three ready-made cutouts.

Robot, locally (Python 3.12+, `pip install -r robot/requirements.txt`):

```bash
python3 tests/make-test-shops.py /tmp/shops
```
```bash
cd /tmp/shops && python3 -m http.server 8099
```

Make a folder `/tmp/main` with `robot/sources.json` listing `{"name": "Shop A", "url": "http://localhost:8099/shopA", "type": "shopify", "on": true}` (and shopB), and a `models` link to the project's `models` folder. Then:

```bash
NO_PROXY=localhost python3 robot/run.py --data /tmp/data --main /tmp/main
```

Serve that output to the app tests with `DATA_ROOT=/tmp/data EXTRA_ROOT=tests/fixtures node dev-server.mjs` (served at `/_d/`; the tests point the app there with the `dataUrl` setting). Other robot flags: `--date YYYY-MM-DD`, `--seed N`, `--offline` (no shop visits), `--keep-today`, `--budget SECONDS`.

Testing on the real iPhone is the most valuable next step: one pin end to end, with a real shop link.

---

## 8. Unfinished / to improve

- Owner: switch on Pages, connect the token, open the app on the iPhone (section 6). Expect fixes after the first real run.
- After the first robot run on GitHub: check `daily/status.json` on the `data` branch (or Settings → Daily outfits). Remove shops that don't work; find more luxury Shopify shops; consider per-shop `min_price` / `include_words`.
- Watches, fragrance and accessories: few luxury Shopify shops sell them. Until Phase 2, the owner adds a handful by hand (they get reused).
- Phase 2 affiliate feeds; affiliate links for Shopify shops (`affiliate_template`).
- Owner's time zone for the 10:17 UTC schedule is assumed US Eastern – adjust the cron if not.
- Ideas: "picks ready" notification; "make more like this"; let the robot pick the backdrop; pin descriptions/hashtags generated from the item list; schedule to Pinterest.
- Try the link helper on the shops the owner actually uses; add special handling where a shop's photos aren't found. Shops that block automatic visits can't be fixed for free – the owner copies the photo instead.
- If the model is too heavy for the iPhone: try a smaller model or lower working size, or make Simple the default.
- The owner's reference pins are **not** in this project (they were only in the chat/sandbox). If layouts need more tuning, ask for them again.
- Layout polish after the owner sees real pins: spacing, accessory sizes, more templates.
- Brand label placement (see bugs).
- The "Shop this look" website is a simple first version (one page, `#look-id` links). A custom domain and nicer per-look pages (for Pinterest previews) would help later.
- No backup of the on-phone Library other than GitHub backup / Export all. If the owner deletes the app or clears Safari data, un-backed-up looks are gone. Worth telling them, and possibly adding a "restore from GitHub".
- When the app is updated, the phone picks up changes the next time it opens online; there is no "update available" message. The service worker cache names (`ga-shell-v1`, `ga-heavy-v1` in `sw.js`) should be bumped if the model or engine files ever change.
- Tests are scripts that print results; no pass/fail assertions.

---

## 9. Known bugs and rough edges

- **Brand labels can overlap things.** The label is drawn just under each item, so it can land on top of the item below (e.g. jacket label over the trousers) or on the GA logo. Workaround: move items or turn Brands off.
- **Small pale fringe can remain** on some edges (seen at a jacket collar and cuff) even after the automatic trim. Workaround: Touch up → Trim edge or erase.
- **Photos on busy or coloured backgrounds cut badly.** White trousers on a brown textured background were not found at all (the app then keeps the whole photo and asks for Touch up). Clean shop photos on white/grey are what it is good at.
- **Opening a look from the Library takes a moment** (it reloads every image) before switching to the Create tab.
- **The cutout engine runs on one processor thread** when hosted on GitHub Pages, so it is slower than it could be. Speed on iPhone is unknown.
- **The backup token and helper key are stored unencrypted on the phone**, and the helper key travels in the web address of each helper request. Acceptable for a personal tool; the token should be limited to the one backup repository as described.
- The test output shows `404` console lines during the GitHub backup test – expected, not a bug.
- **Today: Swap/hidden changes aren't saved** if the app is closed before Keep – the card returns to the robot's original outfit next time.
- **Kept outfits' touch-up can only erase**, not bring back, because the robot sends only the cut-out (not the original photo).
- **Robot colour names are approximate** (taken from the main colour of the cut-out; patterns and two-tone items get one name).
- **Robot face check needs OpenCV 4** (`opencv-python-headless<5`); OpenCV 5 dropped the face files, and the robot silently skips the check if they're missing.
- **Shop currencies** in `robot/sources.json` are guesses; prices may show the wrong symbol until corrected.
