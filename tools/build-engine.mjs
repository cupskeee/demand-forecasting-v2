#!/usr/bin/env node
// Rebuilds the engine folder (public/engine) and its manifest from the upstream
// Pyodide release. No dependencies: plain Node 20+.
//
//   node tools/build-engine.mjs           download what is missing, rewrite the manifest
//   node tools/build-engine.mjs --check   download nothing new; fail if the files on disk
//                                         differ from the committed manifest
//
// Every Python package is checked against the SHA-256 that Pyodide publishes in its
// own pyodide-lock.json before it is accepted.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PYODIDE_VERSION = '314.0.8';
const CPYTHON_TAG = 'v3.14.2';
const UPSTREAM = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// The libraries the app asks for. Their dependencies are resolved from the lock file.
const ROOT_PACKAGES = ['numpy', 'pandas', 'scikit-learn', 'statsmodels', 'xgboost'];

// The Pyodide runtime itself.
const CORE_FILES = [
  { path: 'pyodide.mjs', project: 'Pyodide', license: 'MPL-2.0' },
  { path: 'pyodide.asm.mjs', project: 'Pyodide', license: 'MPL-2.0' },
  {
    path: 'pyodide.asm.wasm',
    project: 'Pyodide (includes the CPython interpreter)',
    license: 'MPL-2.0 AND PSF-2.0',
  },
  { path: 'python_stdlib.zip', project: 'CPython standard library', license: 'PSF-2.0' },
  { path: 'pyodide-lock.json', project: 'Pyodide', license: 'MPL-2.0' },
];

// Licence of each Python package, by SPDX identifier. The script stops if the lock
// file brings in a package that is not listed here, so nothing ships unreviewed.
const PACKAGE_INFO = {
  numpy: { project: 'NumPy', license: 'BSD-3-Clause', home: 'https://numpy.org' },
  pandas: { project: 'pandas', license: 'BSD-3-Clause', home: 'https://pandas.pydata.org' },
  'scikit-learn': {
    project: 'scikit-learn',
    license: 'BSD-3-Clause',
    home: 'https://scikit-learn.org',
  },
  scipy: { project: 'SciPy', license: 'BSD-3-Clause', home: 'https://scipy.org' },
  statsmodels: {
    project: 'statsmodels',
    license: 'BSD-3-Clause',
    home: 'https://www.statsmodels.org',
  },
  xgboost: {
    project: 'XGBoost',
    license: 'Apache-2.0',
    home: 'https://xgboost.ai',
    // This wheel carries no licence file, so the text comes from the project's release tag.
    licenseUrl: (version) => `https://raw.githubusercontent.com/dmlc/xgboost/v${version}/LICENSE`,
  },
  joblib: { project: 'joblib', license: 'BSD-3-Clause', home: 'https://joblib.readthedocs.io' },
  threadpoolctl: {
    project: 'threadpoolctl',
    license: 'BSD-3-Clause',
    home: 'https://github.com/joblib/threadpoolctl',
  },
  patsy: { project: 'patsy', license: 'BSD-2-Clause', home: 'https://github.com/pydata/patsy' },
  packaging: {
    project: 'packaging',
    license: 'Apache-2.0 OR BSD-2-Clause',
    home: 'https://github.com/pypa/packaging',
  },
  'python-dateutil': {
    project: 'python-dateutil',
    license: 'Apache-2.0 OR BSD-3-Clause',
    home: 'https://github.com/dateutil/dateutil',
  },
  six: { project: 'six', license: 'MIT', home: 'https://github.com/benjaminp/six' },
  pytz: { project: 'pytz', license: 'MIT', home: 'https://pythonhosted.org/pytz/' },
  setuptools: {
    project: 'setuptools',
    license: 'MIT',
    home: 'https://github.com/pypa/setuptools',
  },
  pyparsing: {
    project: 'pyparsing',
    license: 'MIT',
    home: 'https://github.com/pyparsing/pyparsing',
  },
};

// Licence texts that are not inside a wheel.
const EXTRA_LICENSES = [
  {
    name: 'pyodide',
    project: 'Pyodide',
    version: PYODIDE_VERSION,
    license: 'MPL-2.0',
    home: 'https://pyodide.org',
    url: `https://raw.githubusercontent.com/pyodide/pyodide/${PYODIDE_VERSION}/LICENSE`,
  },
  {
    name: 'cpython',
    project: 'CPython',
    version: CPYTHON_TAG.slice(1),
    license: 'PSF-2.0',
    home: 'https://www.python.org',
    url: `https://raw.githubusercontent.com/python/cpython/${CPYTHON_TAG}/LICENSE`,
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = join(root, 'public', 'engine');
const licenseDir = join(root, 'public', 'licenses');
const manifestPath = join(engineDir, 'manifest.json');
const checkOnly = process.argv.includes('--check');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Reads a file from disk, or downloads it when it is missing.
async function obtain(name) {
  const local = join(engineDir, name);
  if (existsSync(local)) return readFile(local);
  if (checkOnly) throw new Error(`missing ${name}; run "npm run engine" first`);
  process.stdout.write(`  downloading ${name}\n`);
  const buf = await download(UPSTREAM + name);
  await writeFile(local, buf);
  return buf;
}

// Minimal zip reader: returns the entries whose name passes the filter.
function readZipEntries(buf, wanted) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (wanted(name)) {
      const dataStart =
        localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      const raw = buf.subarray(dataStart, dataStart + compressedSize);
      out.push({ name, data: method === 0 ? raw : inflateRawSync(raw) });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Collects the licence, notice and copying files a wheel carries.
function licenseTextFromWheel(buf) {
  const entries = readZipEntries(
    buf,
    (n) => /\.dist-info\/(licenses\/)?[^/]*(LICEN[CS]E|COPYING|NOTICE)[^/]*$/i.test(n),
  );
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries
    .map((e) => `===== ${e.name.split('/').pop()} =====\n\n${e.data.toString('utf8').trim()}\n`)
    .join('\n');
}

async function main() {
  await mkdir(engineDir, { recursive: true });
  await mkdir(licenseDir, { recursive: true });

  const files = [];
  for (const core of CORE_FILES) {
    const buf = await obtain(core.path);
    files.push({
      path: core.path,
      size: buf.length,
      sha256: sha256(buf),
      project: core.project,
      version: core.path === 'python_stdlib.zip' ? CPYTHON_TAG.slice(1) : PYODIDE_VERSION,
      license: core.license,
      upstream: UPSTREAM + core.path,
    });
  }

  const lock = JSON.parse(await readFile(join(engineDir, 'pyodide-lock.json'), 'utf8'));
  const needed = new Map();
  const visit = (name) => {
    if (needed.has(name)) return;
    const pkg = lock.packages[name];
    if (!pkg) throw new Error(`package ${name} is not in this Pyodide release`);
    needed.set(name, pkg);
    pkg.depends.forEach(visit);
  };
  ROOT_PACKAGES.forEach(visit);

  const licenses = [];
  for (const [name, pkg] of [...needed].sort(([a], [b]) => a.localeCompare(b))) {
    const info = PACKAGE_INFO[name];
    if (!info) throw new Error(`no licence recorded for ${name}; add it to PACKAGE_INFO`);
    const buf = await obtain(pkg.file_name);
    const digest = sha256(buf);
    if (digest !== pkg.sha256) {
      await rm(join(engineDir, pkg.file_name), { force: true });
      throw new Error(`${pkg.file_name}: checksum differs from Pyodide's lock file`);
    }
    files.push({
      path: pkg.file_name,
      size: buf.length,
      sha256: digest,
      project: info.project,
      version: pkg.version,
      license: info.license,
      upstream: UPSTREAM + pkg.file_name,
    });
    const file = `${name}.txt`;
    let text = licenseTextFromWheel(buf);
    if (!text && info.licenseUrl) {
      text = existsSync(join(licenseDir, file))
        ? await readFile(join(licenseDir, file), 'utf8')
        : checkOnly
          ? ''
          : (await download(info.licenseUrl(pkg.version))).toString('utf8');
    }
    if (!text) throw new Error(`no licence text found for ${pkg.file_name}`);
    if (!checkOnly) await writeFile(join(licenseDir, file), text);
    licenses.push({ name, project: info.project, version: pkg.version, license: info.license, home: info.home, file });
  }

  for (const extra of EXTRA_LICENSES) {
    const file = `${extra.name}.txt`;
    if (!existsSync(join(licenseDir, file))) {
      if (checkOnly) throw new Error(`missing licence text ${file}`);
      await writeFile(join(licenseDir, file), await download(extra.url));
    }
    const { url, ...rest } = extra;
    licenses.push({ ...rest, file });
  }
  licenses.sort((a, b) => a.project.toLowerCase().localeCompare(b.project.toLowerCase()));

  const manifest = {
    engine: "Rama's ML Engine",
    builtOn: 'Pyodide, scikit-learn, statsmodels, XGBoost, pandas and NumPy',
    pyodideVersion: PYODIDE_VERSION,
    pythonVersion: lock.info.python,
    upstream: UPSTREAM,
    rebuiltBy: 'tools/build-engine.mjs',
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    files,
    licenses,
  };
  const text = JSON.stringify(manifest, null, 2) + '\n';

  if (checkOnly) {
    const committed = await readFile(manifestPath, 'utf8');
    if (committed !== text) throw new Error('engine files do not match public/engine/manifest.json');
    console.log(`engine verified: ${files.length} files, ${(manifest.totalBytes / 1e6).toFixed(1)} MB`);
    return;
  }
  await writeFile(manifestPath, text);
  await writeFile(join(licenseDir, 'index.json'), JSON.stringify(licenses, null, 2) + '\n');
  for (const f of files) await stat(join(engineDir, f.path));
  console.log(`engine ready: ${files.length} files, ${(manifest.totalBytes / 1e6).toFixed(1)} MB`);
  console.log(`manifest written to ${manifestPath}`);
}

main().catch((err) => {
  console.error(`build-engine failed: ${err.message}`);
  process.exit(1);
});
