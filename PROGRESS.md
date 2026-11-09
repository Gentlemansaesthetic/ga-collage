# PROGRESS – Gentleman's Aesthetic Collage Maker

Handoff notes for a new session with no memory of the original chat.
Last updated: 2026-11-09. State: **built and tested in a desktop test browser; not yet online, never run on a real iPhone.**

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
| `js/github.js` | Optional backup through the GitHub API |
| `worker/worker.js` | The link helper (Cloudflare Worker). The app shows its code with the private key filled in |
| `assets/` | `bg-brown.jpg` (owner's texture), `bg-tan.jpg`, `bg-espresso.jpg`, `logo.png` (owner's GA logo), icons |
| `models/isnet_fp16.onnx` | Cutout model, 88 MB |
| `vendor/ort/` | onnxruntime-web 1.21.0 (runs the model in the browser) |
| `dev-server.mjs` | Local preview server for testing only |
| `tests/` | Test scripts and sample photos (section 7) |
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

Nothing is online yet. The project is committed locally only (branch `main`); **nothing has been pushed**. The sandbox is temporary, so the first job of the next session is to get the code into the owner's GitHub.

### A. GitHub – hosting the app
1. Owner logs in to GitHub (or creates a free account) and creates an empty repository, e.g. `ga-collage`. It must be **public** for free GitHub Pages.
2. Owner connects GitHub to Claude and gives the username + repository name. No GitHub account was connected in the original session.
3. Push this project to it (about 105 MB; the model file is 88 MB, under GitHub's 100 MB per-file limit, GitHub will print a size warning).
4. Repository → Settings → Pages → Deploy from a branch → `main` / root.
5. Owner opens `https://<username>.github.io/<repository>/` in Safari → Share → Add to Home Screen.
6. First cutout downloads the engine – do it on Wi-Fi. Settings → Cutout engine → Download now does it ahead of time.

### B. Cloudflare – link helper (optional, recommended)
Steps are also written inside the app (Settings → Link helper).
1. Free Cloudflare account → Workers → create a Worker (e.g. `ga-helper`).
2. In the app: **Copy helper code**. Paste it over the Worker's code and deploy.
3. Paste the Worker's address (`https://ga-helper.<something>.workers.dev`) into the app → **Save and test** → should say Connected.

### C. GitHub – website backup (optional)
1. Create a second repository for looks, e.g. `ga-looks`.
2. GitHub → Settings → Developer settings → Fine-grained tokens → new token, access to **only that repository**, permission **Contents: Read and write**.
3. In the app: Settings → Website backup → repository name (`username/ga-looks`) and the token.

### What goes in Settings (values are never written in this file or in the code)
| Setting | What it is | Where it comes from |
|---|---|---|
| Link helper address | Address of the Cloudflare Worker | Cloudflare, after deploying |
| Link helper key | Private key the helper checks | **Generated by the app automatically** and placed into the copied helper code. The owner never types it |
| Backup repository | `username/repository` | The owner's GitHub |
| Backup token | Fine-grained GitHub token | Created by the owner on GitHub |

All of these are stored only on the phone, in the app's own storage. Never commit a token or the helper key. `worker/worker.js` in the repository contains only the placeholder `__KEY__`. The local test server uses a dummy key that is not a secret.

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
- `tests/fixtures/studio/` – synthetic studio photos on white/grey. `tests/fixtures/out/` – three ready-made cutouts.

Testing on the real iPhone is the most valuable next step: one pin end to end, with a real shop link.

---

## 8. Unfinished / to improve

- Put it online (section 6) and do the first real-iPhone run. Expect fixes after that.
- Try the link helper on the shops the owner actually uses; add special handling where a shop's photos aren't found. Shops that block automatic visits can't be fixed for free – the owner copies the photo instead.
- If the model is too heavy for the iPhone: try a smaller model or lower working size, or make Simple the default.
- The owner's reference pins are **not** in this project (they were only in the chat/sandbox). If layouts need more tuning, ask for them again.
- Layout polish after the owner sees real pins: spacing, accessory sizes, more templates.
- Brand label placement (see bugs).
- The "Shop this look" website itself is not started. The backup format in section 3 is what it would read.
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
