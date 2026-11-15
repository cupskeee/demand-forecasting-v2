import { useEffect, useRef, useState } from 'preact/hooks';
import { Confirm } from '../components/Confirm';
import { proposeMapping } from '../lib/checks';
import { parseCsv } from '../lib/csv';
import { dataVersion, deleteDataset, getDataset, listDatasets, newId, putDataset } from '../lib/db';
import { humanise, plural, when } from '../lib/format';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import type { Dataset, Mapping, Suggestion } from '../lib/types';

interface Example {
  id: string;
  name: string;
  category: string;
  description: string;
  quirks: string[];
  file: string;
  months: number;
  from: string;
  to: string;
  mapping: Mapping;
  suggestion: Suggestion;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function Datasets() {
  const version = useStore(dataVersion);
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [doomed, setDoomed] = useState<Dataset | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listDatasets().then(setDatasets, () => setDatasets([]));
  }, [version]);
  useEffect(() => {
    fetch('/examples/index.json')
      .then((r) => r.json())
      .then(setExamples)
      .catch(() => setExamples([]));
  }, []);

  async function importFile(file: File | undefined) {
    setError('');
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. Monthly data is small: the limit is 5 MB.`);
      }
      if (/\.(xlsx?|ods|numbers)$/i.test(file.name)) {
        throw new Error(`"${file.name}" is a spreadsheet file. Save it as CSV first, then add the CSV.`);
      }
      const table = parseCsv(await file.text());
      const dataset: Dataset = {
        id: newId(),
        name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled dataset',
        kind: 'user',
        fileName: file.name,
        createdAt: Date.now(),
        columns: table.columns,
        rows: table.rows,
        mapping: proposeMapping(table.columns, table.rows),
      };
      await putDataset(dataset);
      navigate(`/dataset/${dataset.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be read.');
    }
  }

  async function openExample(example: Example) {
    setError('');
    const id = `example-${example.id}`;
    try {
      if (!(await getDataset(id))) {
        const res = await fetch(`/examples/${example.file}`);
        if (!res.ok) throw new Error(`The example could not be loaded (HTTP ${res.status}).`);
        const table = parseCsv(await res.text());
        await putDataset({
          id,
          name: example.name,
          kind: 'example',
          fileName: example.file,
          createdAt: Date.now(),
          columns: table.columns,
          rows: table.rows,
          mapping: example.mapping,
          description: example.description,
          category: example.category,
          suggestion: example.suggestion,
        });
      }
      navigate(`/dataset/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The example could not be opened.');
    }
  }

  return (
    <>
      <header class="page-head">
        <h1>Datasets</h1>
        <p class="lead">
          Add your monthly sales as a CSV file, or open an example. Files are read by your browser and stored on
          this device only.
        </p>
      </header>

      <div
        class={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          importFile(e.dataTransfer?.files[0]);
        }}
      >
        <button class="btn primary" onClick={() => picker.current?.click()}>
          Add a CSV file
        </button>
        <p>
          Or drop one here. It needs one row per month: a column with the month, a column with sales, and any
          number of numeric columns for external factors such as price or promotion.
        </p>
        <input
          ref={picker}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          class="sr-only"
          tabIndex={-1}
          aria-label="CSV file"
          onChange={(e) => {
            const input = e.currentTarget;
            importFile(input.files?.[0]);
            input.value = '';
          }}
        />
      </div>
      {error && (
        <div class="notice bad section" role="alert">
          <strong>That file could not be added</strong>
          {error}
        </div>
      )}

      <section class="section">
        <h2>On this device</h2>
        {datasets === null ? null : datasets.length === 0 ? (
          <div class="empty">
            <strong>No datasets yet</strong>
            Add a CSV file above, or open one of the examples below to see how a forecast works.
          </div>
        ) : (
          <ul class="list">
            {datasets.map((d) => (
              <li key={d.id}>
                <div class="what">
                  <a href={`#/dataset/${d.id}`}>{d.name}</a>{' '}
                  {d.kind === 'example' && <span class="tag">Example</span>}
                  <div class="muted small">
                    {plural(d.rows.length, 'row')}, {plural(d.columns.length, 'column')}
                    {d.mapping.target ? `, forecasting ${humanise(d.mapping.target)}` : ''}. Added {when(d.createdAt)}
                  </div>
                </div>
                <div class="row">
                  <a class="btn" href={`#/dataset/${d.id}`}>
                    Open
                  </a>
                  <button class="btn danger" onClick={() => setDoomed(d)} aria-label={`Delete ${d.name}`}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="section">
        <h2>Examples</h2>
        <p class="hint">
          Four fictional, brand-free products in an Indonesian market setting. Each has a few of the problems
          real files have, so you can see how the data checks and the models handle them.
        </p>
        <div class="examples">
          {examples.map((ex) => (
            <article class="example" key={ex.id}>
              <div class="row spread">
                <h3>{ex.name}</h3>
                <span class="tag">{ex.category}</span>
              </div>
              <p>{ex.description}</p>
              <p class="muted small">
                {ex.months} months, {ex.from} to {ex.to}, {plural(ex.mapping.factors.length, 'external factor')}
              </p>
              <ul>
                {ex.quirks.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <button class="btn" onClick={() => openExample(ex)}>
                Open example
              </button>
            </article>
          ))}
        </div>
      </section>

      <Confirm
        open={!!doomed}
        title={`Delete "${doomed?.name}"?`}
        confirmLabel="Delete dataset"
        danger
        onCancel={() => setDoomed(null)}
        onConfirm={async () => {
          if (doomed) await deleteDataset(doomed.id);
          setDoomed(null);
        }}
      >
        <p>
          The dataset is removed from this browser. Forecasts you already ran on it stay in the run history.
          {doomed?.kind === 'example' ? ' You can open the example again at any time.' : ' There is no copy anywhere else.'}
        </p>
      </Confirm>
    </>
  );
}
