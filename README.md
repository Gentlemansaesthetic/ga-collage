# Gentleman's Aesthetic – Collage Maker

A phone app for building Pinterest flat-lay outfit pins (1000 × 1500).
You pick the products; the app cuts them out of the real product photos, arranges
them, and saves an item list (name, brand, link, price) with every pin.

- Works on iPhone from the home screen, with the computer off.
- Free: hosted on GitHub Pages, with one optional free Cloudflare helper.
- Products are never redrawn. The app only removes the background of the photo you give it.

## Putting it online (once)

1. Put this folder in a GitHub repository.
2. In the repository: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
3. After a minute or two the app is live at `https://<your-name>.github.io/<repository>/`.
4. On the iPhone, open that address in **Safari**, tap **Share → Add to Home Screen**.

The first cutout downloads the cutout engine (about 88 MB, once). Do that on Wi-Fi.

## Making a pin

1. **Add item** – either
   - copy a product page link in Safari, then tap **Paste link or copied photo** (needs the link helper below), or
   - press and hold a product photo in Safari → **Copy**, then tap **Paste link or copied photo**, or
   - **Choose from Photos**.
2. Check the name, brand and link, then **Add**.
3. Tap **Layout** to flip through arrangements. Drag to move, pinch or use the round handle to resize.
   Tap an item for more: Touch up (erase / bring back), Forward / Back, Flip, Shadow, Copy, Remove.
4. **Export** – save or share the pin, copy the item list, or back it up.

Everything is kept in **Library** on the phone. **Export all** gives a spreadsheet or a data file of every look.

## Link helper (optional, free)

Lets the app read a product page and offer its photos, name, brand and price.
Follow the steps in the app under **Settings → Link helper**: create a free Cloudflare
account, make a Worker, paste the code the app copies for you, and paste the Worker's
address back into the app. Some shops block automatic visits; for those, copy the photo instead.

## Website backup (optional, free)

In **Settings → Website backup**, enter a repository (`name/repository`) and a GitHub token
that may write to it. **Back up to GitHub** in the Export screen then saves:

```
looks/index.json            list of all looks (newest first)
looks/<id>/pin.jpg          the finished pin
looks/<id>/look.json        title, date and items: name, brand, type, price, link, notes, image
looks/<id>/items/<n>.png    each cut-out product
```

A future "Shop this look" website only has to read these files.

## Folders

- `index.html`, `css/`, `js/` – the app
- `assets/` – backdrops, logo, icons
- `models/`, `vendor/` – the on-device cutout engine
- `worker/worker.js` – the link helper code
- `dev-server.mjs` – only for testing on a computer (`node dev-server.mjs`)
