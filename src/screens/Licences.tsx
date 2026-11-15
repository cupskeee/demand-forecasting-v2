import { useEffect, useState } from 'preact/hooks';
import { CREDIT, REPO, type LicenseEntry } from '../engine/install';

function LicenceText({ file }: { file: string }) {
  const [text, setText] = useState('Loading…');
  useEffect(() => {
    fetch(`/licenses/${file}`)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setText, () => setText('The licence text could not be loaded.'));
  }, [file]);
  return <pre class="license-text">{text}</pre>;
}

export function Licences() {
  const [entries, setEntries] = useState<LicenseEntry[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    fetch('/licenses/index.json')
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);
  const main = ['Pyodide', 'scikit-learn', 'statsmodels', 'XGBoost', 'pandas', 'NumPy'];
  const sorted = [...entries].sort(
    (a, b) => Number(main.includes(b.project)) - Number(main.includes(a.project)) || a.project.localeCompare(b.project),
  );

  return (
    <>
      <header class="page-head">
        <a class="crumb" href="#/">
          Demand Forecasting
        </a>
        <h1>Credits and licences</h1>
        <p class="lead">
          Rama's ML Engine is a name for a bundle of other people's work. {CREDIT} All of the forecasting is done
          by these projects; this app adds the interface around them.
        </p>
      </header>
      <p class="hint muted" style={{ marginBottom: '1rem', maxWidth: '72ch' }}>
        The engine redistributes the projects below, unmodified, as published by the Pyodide project. Each one's
        licence and copyright notice is reproduced in full here. The app's own code is in the{' '}
        <a href={REPO}>public repository</a>.
      </p>
      <ul class="list">
        {sorted.map((e) => (
          <li key={e.name}>
            <div class="what">
              <strong>{e.project}</strong> <span class="muted">{e.version}</span>
              <div class="muted small">
                {e.license}. <a href={e.home} rel="noreferrer">{e.home.replace(/^https?:\/\//, '')}</a>
              </div>
            </div>
            <button
              class="btn"
              aria-expanded={!!open[e.name]}
              onClick={() => setOpen((o) => ({ ...o, [e.name]: !o[e.name] }))}
            >
              {open[e.name] ? 'Hide licence' : 'Read licence'}
            </button>
            {open[e.name] && (
              <div style={{ flexBasis: '100%', minWidth: 0 }}>
                <LicenceText file={e.file} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
