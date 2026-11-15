import { CREDIT, REPO, engine, installEngine, openApp } from '../engine/install';
import { describeDevice } from '../lib/device';
import { bytes } from '../lib/format';
import { useStore } from '../lib/store';

export function Install() {
  const status = useStore(engine);
  const device = describeDevice();
  const manifest = status.manifest;
  const total = manifest?.totalBytes ?? 0;
  const size = manifest ? bytes(total) : 'about 50 MB';
  const installing = status.phase === 'installing';
  const finishing = status.justInstalled && status.phase !== 'ready' && status.phase !== 'failed';
  const ready = status.justInstalled && status.phase === 'ready';

  return (
    <div class="install">
      <section class="install-pitch">
        <h1>Forecast demand without sending your data anywhere</h1>
        <p>
          Add monthly sales, and four forecasting models are fitted right here in your browser. There is no
          server behind this app, no account, and no upload: your data stays on this device.
        </p>
        <ol class="path">
          <li class={ready ? '' : 'here'}>
            <div>
              Install the engine
              <span>One download, kept in this browser. After that the app works with the network off.</span>
            </div>
          </li>
          <li class={ready ? 'here' : ''}>
            <div>
              Add a dataset
              <span>Your own CSV file, or one of four built-in examples.</span>
            </div>
          </li>
          <li>
            <div>
              Fit four models
              <span>XGBoost, SARIMAX, Elastic Net and Holt-Winters, back-tested and compared.</span>
            </div>
          </li>
          <li>
            <div>
              Ask what if
              <span>Change a price or a promotion for the coming months and see the forecast move.</span>
            </div>
          </li>
        </ol>
        <p class="who">
          A portfolio project by Yusuf Ramadhan. Back to <a href="https://yusuframadhan.com">yusuframadhan.com</a> or{" "}
          <a href="https://yusuframadhan.dev">yusuframadhan.dev</a>.
        </p>
      </section>

      <section class="install-card" aria-live="polite">
        {status.phase === 'unsupported' ? (
          <>
            <h2>This browser cannot run the engine</h2>
            <div class="notice bad">{status.error}</div>
            <p class="muted">
              Try a current version of Chrome, Edge, Firefox or Safari. Nothing was downloaded.
            </p>
          </>
        ) : ready ? (
          <>
            <h2>Rama's ML Engine is ready on this device</h2>
            <div class="notice ok">
              <strong>Verified</strong>
              All {manifest?.files.length} files match the checksums in the public manifest. From now on the app
              opens straight away and works with the network off.
            </div>
            <p class="muted small">{CREDIT}</p>
            <div>
              <button class="btn primary big" onClick={openApp} autofocus>
                Start forecasting
              </button>
            </div>
          </>
        ) : status.justInstalled && status.phase === 'failed' ? (
          <>
            <h2>The engine was installed but could not start</h2>
            <div class="notice bad">{status.error}</div>
            <div>
              <button class="btn" onClick={openApp}>
                Open the app anyway
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Set up Rama's ML Engine on this device</h2>
            <p>
              The engine is what fits the models. It installs into this browser once. <br />
              <span class="muted">{CREDIT}</span>
            </p>
            <ul class="facts">
              <li>
                <span>
                  <strong>What is downloaded:</strong> {manifest?.files.length ?? 20} files, {size} in total. They are
                  the Python runtime compiled to WebAssembly and the open-source libraries named above.
                </span>
              </li>
              <li>
                <span>
                  <strong>What it can do:</strong> it runs inside this browser tab's sandbox. It cannot read your
                  files, install anything, or change anything on your computer.
                </span>
              </li>
              <li>
                <span>
                  <strong>How you can check:</strong> every file is compared with a published checksum before it
                  is used. The <a href={`${REPO}/blob/main/public/engine/manifest.json`}>manifest</a> and the{' '}
                  <a href={`${REPO}/blob/main/tools/build-engine.mjs`}>script that rebuilds the engine</a> from the
                  original releases are in the public repository. <a href="#/licences">Licences</a>
                </span>
              </li>
              <li>
                <span>
                  <strong>How to undo it:</strong> the Engine page has one control that removes the engine and all
                  your data from this browser.
                </span>
              </li>
            </ul>
            {(device.phone || device.lowEnd) && !installing && !finishing && (
              <div class="notice warn">
                <strong>{device.phone ? 'This is a heavy download for a phone' : 'This device is light on memory'}</strong>
                The engine is {size} and needs a few hundred megabytes of memory while it runs. Use Wi-Fi if you
                can. It will work, more slowly, and the app will default to its quicker settings.
              </div>
            )}
            {status.error && (
              <div class="notice bad" role="alert">
                <strong>The install did not finish</strong>
                {status.error}
              </div>
            )}
            {installing || finishing ? (
              <div class="stack">
                <div class="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={Math.round((status.downloaded / (total || 1)) * 100)} aria-label="Engine download">
                  <div style={{ width: `${Math.min(100, (status.downloaded / (total || 1)) * 100)}%` }} />
                </div>
                <p class="num" style={{ textAlign: 'left' }}>
                  {finishing
                    ? `All files verified. ${status.bootMessage || 'Starting the engine'}…`
                    : `${bytes(status.downloaded)} of ${size} downloaded, ${status.filesVerified} of ${manifest?.files.length} files verified`}
                </p>
              </div>
            ) : (
              <div>
                <button class="btn primary big" onClick={installEngine} disabled={!manifest}>
                  Install the engine ({size})
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
