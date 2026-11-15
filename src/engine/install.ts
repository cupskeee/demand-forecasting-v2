// Installing the engine: download each file from this site, check it against the
// SHA-256 in the manifest, and only then keep it in the browser's cache storage.
import { settings } from '../lib/db';
import { describeDevice, missingFeatures } from '../lib/device';
import { createStore } from '../lib/store';
import { startPool, stopPool } from './pool';

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
  project: string;
  version: string;
  license: string;
  upstream: string;
}
export interface LicenseEntry {
  name: string;
  project: string;
  version: string;
  license: string;
  home: string;
  file: string;
}
export interface Manifest {
  engine: string;
  builtOn: string;
  pyodideVersion: string;
  pythonVersion: string;
  upstream: string;
  totalBytes: number;
  files: ManifestFile[];
  licenses: LicenseEntry[];
}

export type Phase =
  | 'checking' // looking at what is already on this device
  | 'unsupported' // the browser lacks something the app needs
  | 'absent' // not installed yet
  | 'installing'
  | 'starting' // installed and verified, workers are booting
  | 'ready'
  | 'failed'; // installed but could not start

export interface EngineStatus {
  phase: Phase;
  manifest: Manifest | null;
  downloaded: number;
  filesVerified: number;
  currentFile: string;
  error: string;
  bootMessage: string;
  workers: number;
  busy: number;
  verifiedAt: number | null;
  versions: Record<string, string>;
  memoryMB: number;
  /** True from the end of an install until the visitor opens the app. */
  justInstalled: boolean;
}

export const engine = createStore<EngineStatus>({
  phase: 'checking',
  manifest: null,
  downloaded: 0,
  filesVerified: 0,
  currentFile: '',
  error: '',
  bootMessage: '',
  workers: 0,
  busy: 0,
  verifiedAt: null,
  versions: {},
  memoryMB: 0,
  justInstalled: false,
});
const patch = (part: Partial<EngineStatus>) => engine.set((s) => ({ ...s, ...part }));

export const REPO = 'https://github.com/cupskeee/demand-forecasting-v2';
export const CREDIT = 'Built on Pyodide, scikit-learn, statsmodels, XGBoost, pandas and NumPy.';

const cacheName = (m: Manifest) => `engine-${m.pyodideVersion}`;
const urlOf = (f: ManifestFile) => `/engine/${f.path}`;
const fingerprint = (m: Manifest) => m.files.map((f) => f.sha256.slice(0, 8)).join('');

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TYPES: Record<string, string> = {
  mjs: 'text/javascript',
  wasm: 'application/wasm',
  json: 'application/json',
  zip: 'application/zip',
  whl: 'application/octet-stream',
};

async function loadManifest(): Promise<Manifest> {
  const res = await fetch('/engine/manifest.json');
  if (!res.ok) throw new Error(`The engine manifest could not be loaded (HTTP ${res.status}).`);
  return res.json();
}

async function isInstalled(manifest: Manifest): Promise<boolean> {
  if (settings.get('engine') !== fingerprint(manifest)) return false;
  const cache = await caches.open(cacheName(manifest));
  const keys = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  return manifest.files.every((f) => keys.has(urlOf(f)));
}

/** Called once when the app opens. */
export async function initEngine(): Promise<void> {
  const missing = missingFeatures();
  if (missing.length) {
    patch({
      phase: 'unsupported',
      error: `This browser is missing ${missing.join(', ')}, which the engine needs.`,
    });
    return;
  }
  try {
    const manifest = await loadManifest();
    patch({ manifest });
    if (await isInstalled(manifest)) {
      patch({ verifiedAt: Number(settings.get('engine.verifiedAt')) || null });
      boot();
    } else patch({ phase: 'absent' });
  } catch (err) {
    patch({ phase: 'failed', error: message(err) });
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function boot() {
  patch({ phase: 'starting', error: '', bootMessage: 'Starting', busy: 0 });
  startPool(describeDevice().workers, {
    onBoot: (bootMessage) => {
      if (engine.get().phase === 'starting') patch({ bootMessage });
    },
    onReady: (workers, info) =>
      patch({ phase: 'ready', workers, versions: info.versions, memoryMB: info.memoryMB }),
    onBusy: (busy) => patch({ busy }),
    onFailed: (error) => patch({ phase: 'failed', error, workers: 0 }),
  });
}

export function openApp() {
  patch({ justInstalled: false });
}

export function restartEngine() {
  stopPool();
  boot();
}

/** Downloads one file, reporting bytes as they arrive, and returns its contents. */
async function download(file: ManifestFile, onBytes: (n: number) => void): Promise<Response> {
  const res = await fetch(urlOf(file), { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`${file.path} could not be downloaded (HTTP ${res.status}).`);
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    onBytes(value.length);
  }
  const blob = new Blob(chunks);
  const digest = await sha256(await blob.arrayBuffer());
  if (digest !== file.sha256) {
    throw new Error(
      `${file.path} does not match its checksum in the manifest, so nothing was installed. Try again; if it keeps happening, the download is being altered on the way.`,
    );
  }
  const ext = file.path.split('.').pop() ?? '';
  return new Response(blob, {
    headers: { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Content-Length': String(blob.size) },
  });
}

export async function installEngine(): Promise<void> {
  const manifest = engine.get().manifest;
  if (!manifest || engine.get().phase === 'installing') return;
  patch({ phase: 'installing', downloaded: 0, filesVerified: 0, error: '', currentFile: '' });
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith('engine-')) await caches.delete(name);
    }
    // Wait for the offline helper so the engine is later served from the verified copies.
    if ('serviceWorker' in navigator) {
      await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 4000))]);
    }
    const cache = await caches.open(cacheName(manifest));
    const queue = [...manifest.files].sort((a, b) => b.size - a.size);
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        patch({ currentFile: file.path });
        const response = await download(file, (n) =>
          engine.set((s) => ({ ...s, downloaded: s.downloaded + n })),
        );
        await cache.put(urlOf(file), response);
        engine.set((s) => ({ ...s, filesVerified: s.filesVerified + 1 }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const now = Date.now();
    settings.set('engine', fingerprint(manifest));
    settings.set('engine.verifiedAt', String(now));
    patch({ verifiedAt: now, currentFile: '', justInstalled: true });
    navigator.storage?.persist?.().catch(() => undefined);
    boot();
  } catch (err) {
    for (const name of await caches.keys()) {
      if (name.startsWith('engine-')) await caches.delete(name);
    }
    patch({
      phase: 'absent',
      error: navigator.onLine
        ? message(err)
        : 'The download stopped because the network went away. Reconnect and try again.',
    });
  }
}

export interface FileCheck {
  file: ManifestFile;
  ok: boolean;
  found: string;
}

/** Re-reads every installed engine file and compares it with the manifest. */
export async function verifyEngine(onProgress?: (done: number) => void): Promise<FileCheck[]> {
  const manifest = engine.get().manifest;
  if (!manifest) return [];
  const cache = await caches.open(cacheName(manifest));
  const out: FileCheck[] = [];
  for (const file of manifest.files) {
    const hit = await cache.match(urlOf(file));
    const found = hit ? await sha256(await hit.arrayBuffer()) : 'missing';
    out.push({ file, ok: found === file.sha256, found });
    onProgress?.(out.length);
  }
  if (out.every((c) => c.ok)) {
    const now = Date.now();
    settings.set('engine.verifiedAt', String(now));
    patch({ verifiedAt: now });
  }
  return out;
}

/** Removes the engine and every dataset and run from this browser. */
export async function removeEverything(): Promise<void> {
  stopPool();
  const { deleteAllData } = await import('../lib/db');
  await deleteAllData();
  for (const name of await caches.keys()) await caches.delete(name);
  settings.clear();
  if ('serviceWorker' in navigator) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
  }
}
