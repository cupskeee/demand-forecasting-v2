#!/usr/bin/env node
// Tiny static server with no dependencies, used for the engine proof page (spike/).
//   node tools/serve.mjs [port]        then open http://localhost:4173/spike/
// /engine/* and /licenses/* are served from public/, everything else from the project root.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip',
  '.whl': 'application/octet-stream', '.py': 'text/plain; charset=utf-8', '.css': 'text/css',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.svg': 'image/svg+xml',
};

createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path.endsWith('/')) path += 'index.html';
  const base = /^\/(engine|licenses)\//.test(path) ? join(root, 'public') : root;
  const file = join(base, path);
  try {
    if (!file.startsWith(root)) throw new Error('outside root');
    const info = statSync(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': path.startsWith('/engine/') ? 'public, max-age=3600' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}/spike/`));
