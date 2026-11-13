// Local preview server (only used for development and testing).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const extra = process.env.EXTRA_ROOT || '';
const dataRoot = process.env.DATA_ROOT || ''; // a local copy of the robot's data branch, served at /_d/
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
let helper = null;
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname.startsWith('/helper')) {
      helper = helper || (await import('./worker/worker.js')).default;
      const r = await helper.fetch(new Request('http://localhost' + u.pathname.replace('/helper', '') + u.search, { method: req.method, headers: req.headers }), { KEY: 'devkey' });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += 'index.html';
    let file = path.join(root, p);
    if (extra && p.startsWith('/_t/')) file = path.join(extra, p.slice(4));
    if (dataRoot && p.startsWith('/_d/')) file = path.join(dataRoot, p.slice(4));
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-length': data.length, 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}).listen(process.env.PORT || 8080, () => console.log('http://localhost:' + (process.env.PORT || 8080)));
