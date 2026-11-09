// Optional backup: saves each finished look into a GitHub repository as
//   looks/<id>/pin.jpg, looks/<id>/look.json, looks/<id>/items/<n>.png  and  looks/index.json
// A future website can read these files to build "Shop this look" pages.
const API = 'https://api.github.com';

function headers(token) {
  return { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

const textToBase64 = (t) => blobToBase64(new Blob([t]));

async function getFile(cfg, path) {
  const r = await fetch(`${API}/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch || 'main')}&t=${Date.now()}`, { headers: headers(cfg.token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await explain(r));
  return r.json();
}

async function explain(r) {
  if (r.status === 401) return 'GitHub did not accept the token. Create a new one in Settings.';
  if (r.status === 403 || r.status === 404) return 'GitHub says this token may not write to that repository. Check the repository name and the token permissions.';
  let m = '';
  try { m = (await r.json()).message; } catch (e) {}
  return 'GitHub error ' + r.status + (m ? ': ' + m : '');
}

async function putFile(cfg, path, base64, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = await getFile(cfg, path);
    const r = await fetch(`${API}/repos/${cfg.repo}/contents/${path}`, {
      method: 'PUT',
      headers: { ...headers(cfg.token), 'content-type': 'application/json' },
      body: JSON.stringify({ message, content: base64, branch: cfg.branch || 'main', ...(old ? { sha: old.sha } : {}) }),
    });
    if (r.ok) return;
    if (r.status !== 409 && r.status !== 422) throw new Error(await explain(r));
    await new Promise((res) => setTimeout(res, 600));
  }
  throw new Error('GitHub was busy. Try again in a moment.');
}

export async function testGithub(cfg) {
  const r = await fetch(`${API}/repos/${cfg.repo}`, { headers: headers(cfg.token) });
  if (!r.ok) throw new Error(await explain(r));
  const j = await r.json();
  if (j.permissions && !j.permissions.push) throw new Error('The token can read this repository but not write to it.');
  return j.default_branch;
}

// data = look.json content, pin = JPEG blob, itemImages = [{ path, blob }]
export async function uploadLook(cfg, data, pin, itemImages, onStep) {
  const dir = `looks/${data.id}`;
  const total = itemImages.length + 3;
  let n = 0;
  const step = (label) => onStep && onStep(label, ++n / total);
  const msg = `Look: ${data.title}`;
  for (const im of itemImages) {
    await putFile(cfg, `${dir}/${im.path}`, await blobToBase64(im.blob), msg);
    step('Item photos');
  }
  await putFile(cfg, `${dir}/pin.jpg`, await blobToBase64(pin), msg);
  step('Pin image');
  await putFile(cfg, `${dir}/look.json`, await textToBase64(JSON.stringify(data, null, 2) + '\n'), msg);
  step('Item list');
  const old = await getFile(cfg, 'looks/index.json');
  let index = [];
  if (old && old.content) {
    try { index = JSON.parse(decodeURIComponent(escape(atob(old.content.replace(/\n/g, ''))))); } catch (e) { index = []; }
  }
  index = index.filter((x) => x.id !== data.id);
  index.unshift({ id: data.id, title: data.title, updatedAt: data.updatedAt, image: `${dir}/pin.jpg`, data: `${dir}/look.json`, items: data.items.length });
  await putFile(cfg, 'looks/index.json', await textToBase64(JSON.stringify(index, null, 2) + '\n'), msg);
  step('Index');
}
