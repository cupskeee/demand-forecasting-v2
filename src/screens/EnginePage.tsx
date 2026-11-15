import { useState } from 'preact/hooks';
import { Confirm } from '../components/Confirm';
import { engineLine } from '../components/Rail';
import { CREDIT, REPO, engine, removeEverything, restartEngine, verifyEngine, type FileCheck } from '../engine/install';
import { bytes, when } from '../lib/format';
import { useStore } from '../lib/store';

export function EnginePage() {
  const status = useStore(engine);
  const manifest = status.manifest;
  const [checks, setChecks] = useState<FileCheck[] | null>(null);
  const [verifying, setVerifying] = useState(0);
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (!manifest) return null;
  const line = engineLine(status);
  const allOk = checks?.every((c) => c.ok);

  const verify = async () => {
    setChecks(null);
    setVerifying(1);
    setChecks(await verifyEngine((done) => setVerifying(done)));
    setVerifying(0);
  };

  return (
    <>
      <header class="page-head">
        <h1>Rama's ML Engine</h1>
        <p class="lead">
          The engine fits the forecasting models inside this browser. {CREDIT} It is Python {manifest.pythonVersion}{' '}
          and those libraries, compiled to WebAssembly and served from this site.
        </p>
      </header>

      <section class="panel stack">
        <div class="row spread">
          <div>
            <h2>{line.text}</h2>
            <p class="muted">
              {status.phase === 'ready'
                ? `${status.workers} background ${status.workers === 1 ? 'worker' : 'workers'}, each using about ${status.memoryMB} MB of memory.`
                : status.phase === 'failed'
                  ? status.error
                  : 'One moment.'}
            </p>
          </div>
          <button class="btn" onClick={restartEngine} disabled={status.phase === 'starting' || status.busy > 0}>
            Restart the engine
          </button>
        </div>
        {Object.keys(status.versions).length > 0 && (
          <p class="small muted">
            Running: {Object.entries(status.versions).map(([k, v]) => `${k} ${v}`).join(', ')}, on Pyodide{' '}
            {manifest.pyodideVersion}.
          </p>
        )}
      </section>

      <section class="section">
        <h2>Proof that the download is what it says</h2>
        <p class="hint">
          The engine is {manifest.files.length} files, {bytes(manifest.totalBytes)} in total. The public repository
          holds a <a href={`${REPO}/blob/main/public/engine/manifest.json`}>manifest</a> with the size, SHA-256
          checksum, source and licence of each one, and a{' '}
          <a href={`${REPO}/blob/main/tools/build-engine.mjs`}>script</a> that rebuilds the folder from the
          original releases, so anyone can reproduce it. Each file was checked against the manifest before it
          was first used{status.verifiedAt ? `; last verified ${when(status.verifiedAt)}` : ''}.
        </p>
        <div class="row" style={{ marginBottom: '0.8rem' }}>
          <button class="btn" onClick={verify} disabled={verifying > 0}>
            {verifying ? `Verifying ${verifying} of ${manifest.files.length}…` : 'Verify the installed files again'}
          </button>
          {checks && (
            <span class={`tag ${allOk ? 'best' : ''}`} role="status">
              {allOk ? `Verified: all ${checks.length} files match` : 'Some files do not match'}
            </span>
          )}
        </div>
        {checks && !allOk && (
          <div class="notice bad" style={{ marginBottom: '0.8rem' }}>
            <strong>The installed engine differs from the manifest</strong>
            Remove the engine below and install it again.
          </div>
        )}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>From</th>
                <th>Licence</th>
                <th class="n">Size</th>
                <th>SHA-256</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {manifest.files.map((f, i) => (
                <tr key={f.path}>
                  <th>
                    <a href={f.upstream} rel="noreferrer">
                      {f.path.length > 34 ? `${f.path.slice(0, 32)}…` : f.path}
                    </a>
                  </th>
                  <td>
                    {f.project.replace(/ \(.*/, '')} {f.version}
                  </td>
                  <td>{f.license}</td>
                  <td class="n">{bytes(f.size)}</td>
                  <td class="hash" title={f.sha256}>
                    {f.sha256.slice(0, 16)}…
                  </td>
                  <td>
                    {checks ? (
                      checks[i].ok ? (
                        <span class="up">Matches</span>
                      ) : (
                        <span class="down">Differs</span>
                      )
                    ) : (
                      <span class="muted">Verified at install</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="small muted" style={{ marginTop: '0.6rem' }}>
          File names link to the original copies the script downloads. <a href="#/licences">Licences of every project</a>
        </p>
      </section>

      <section class="section">
        <h2>Where your data goes</h2>
        <ul class="facts">
          <li>
            <span>
              Datasets and runs are stored in this browser's IndexedDB. The engine files are in its cache
              storage. Nothing else is kept.
            </span>
          </li>
          <li>
            <span>
              The site's server only hands out static files. The app has no code that uploads anything, and the
              page's security policy forbids connections to any other host.
            </span>
          </li>
          <li>
            <span>
              To check for yourself, open your browser's developer tools on the Network tab and use the app: you
              will see only downloads of this site's own files. Then turn your network off and keep working.
            </span>
          </li>
        </ul>
      </section>

      <section class="section">
        <h2>Remove everything</h2>
        <p class="hint">
          Deletes the engine, every dataset and every run from this browser, and returns to the install screen.
          There is no backup and no copy on any server, so this cannot be undone.
        </p>
        <button class="btn danger" onClick={() => setAsking(true)}>
          Remove the engine and all local data
        </button>
      </section>
      <Confirm
        open={asking}
        title="Remove the engine and all local data?"
        confirmLabel={removing ? 'Removing…' : 'Remove everything'}
        danger
        busy={removing}
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          setRemoving(true);
          await removeEverything();
          location.hash = '';
          location.reload();
        }}
      >
        <p>
          Your datasets, your run history and the {bytes(manifest.totalBytes)} engine are deleted from this
          browser. Nothing can be recovered afterwards.
        </p>
      </Confirm>
    </>
  );
}
