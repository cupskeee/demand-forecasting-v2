import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

// Reads public/_headers so `vite preview` serves the same security headers as production.
function headersForAll(): Record<string, string> {
  const out: Record<string, string> = {};
  let inAll = false;
  for (const line of readFileSync('public/_headers', 'utf8').split('\n')) {
    if (/^\S/.test(line)) inAll = line.trim() === '/*';
    else if (inAll && line.includes(':')) {
      const i = line.indexOf(':');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

// After the build, fills the service worker with the list of files that make up the
// application, so it can open with the network off. Engine files are not in this list:
// the app downloads, verifies and caches those itself.
function offlineShell(): Plugin {
  return {
    name: 'offline-shell',
    apply: 'build',
    closeBundle() {
      const dist = 'dist';
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push('/' + relative(dist, full).split('\\').join('/'));
        }
      };
      walk(dist);
      const shell = files
        .filter((f) => !f.startsWith('/engine/') || f === '/engine/manifest.json')
        .filter((f) => !['/sw.js', '/_headers', '/404.html'].includes(f))
        .sort();
      const hash = createHash('sha256');
      for (const f of shell) hash.update(f).update(readFileSync(join(dist, f)));
      const sw = readFileSync(join(dist, 'sw.js'), 'utf8')
        .replace("'dev'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('[/* filled in by the build */]', JSON.stringify(shell));
      writeFileSync(join(dist, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  plugins: [preact(), offlineShell()],
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  preview: { headers: headersForAll() },
});
