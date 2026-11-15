import { useEffect, useMemo, useState } from 'preact/hooks';
import { engine } from '../engine/install';
import { startRun } from '../engine/runner';
import { analyse, profileColumns, type Issue } from '../lib/checks';
import { dataVersion, getDataset, listRuns, putDataset, settings } from '../lib/db';
import { describeDevice } from '../lib/device';
import { monthLabel, percent, plural, when } from '../lib/format';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { MODELS, succeeded, type Dataset, type Mode, type Run } from '../lib/types';

const LEVEL: Record<Issue['level'], string> = { blocker: 'Must fix', warning: 'Check', info: 'Note' };

export function DatasetView({ id }: { id: string }) {
  const [dataset, setDataset] = useState<Dataset | null | undefined>(undefined);
  const [runs, setRuns] = useState<Run[]>([]);
  const version = useStore(dataVersion);
  const status = useStore(engine);
  const device = useMemo(describeDevice, []);
  const [mode, setMode] = useState<Mode>(() => {
    const saved = settings.get('mode');
    return saved === 'quick' || saved === 'thorough' ? saved : device.suggestedMode;
  });
  const [horizon, setHorizon] = useState<number | null>(null);

  useEffect(() => {
    getDataset(id).then((d) => setDataset(d ?? null), () => setDataset(null));
  }, [id]);
  useEffect(() => {
    listRuns().then((all) => setRuns(all.filter((r) => r.datasetId === id)), () => undefined);
  }, [id, version]);

  const profiles = useMemo(
    () => (dataset ? profileColumns(dataset.columns, dataset.rows) : []),
    [dataset?.columns, dataset?.rows],
  );
  const analysis = useMemo(
    () => (dataset ? analyse(dataset.columns, dataset.rows, dataset.mapping) : null),
    [dataset],
  );

  if (dataset === undefined) return null;
  if (dataset === null || !analysis) {
    return (
      <div class="empty">
        <strong>This dataset is not on this device</strong>
        It may have been deleted, or the link came from another browser. <a href="#/">See your datasets</a>
      </div>
    );
  }

  const { mapping } = dataset;
  const remap = (next: Partial<Dataset['mapping']>) => {
    const updated = { ...dataset, mapping: { ...mapping, ...next } };
    updated.mapping.factors = updated.mapping.factors.filter(
      (f) => f !== updated.mapping.date && f !== updated.mapping.target,
    );
    setDataset(updated);
    putDataset(updated);
  };
  const max = analysis.maxHorizon;
  const months = Math.min(horizon ?? Math.min(device.lowEnd ? 6 : 12, max), max);
  const prepared = analysis.prepared;
  const engineReady = status.phase === 'ready';
  const role = (name: string) =>
    name === mapping.date ? 'date' : name === mapping.target ? 'sales' : mapping.factors.includes(name) ? 'factor' : '';
  const kindOf = (p: (typeof profiles)[number]) =>
    p.numberShare >= 0.8 ? 'numbers' : p.dateShare >= 0.8 ? 'dates' : p.numberShare > 0 ? 'mixed' : 'text';

  const run = () => {
    if (!prepared) return;
    settings.set('mode', mode);
    navigate(`/run/${startRun(dataset, prepared, months, mode)}`);
  };

  return (
    <>
      <header class="page-head">
        <a class="crumb" href="#/">
          All datasets
        </a>
        <h1>{dataset.name}</h1>
        <p class="lead">
          {dataset.description ?? `Imported from ${dataset.fileName} on ${when(dataset.createdAt)}.`}{' '}
          {plural(dataset.rows.length, 'row')}, {plural(dataset.columns.length, 'column')}.
        </p>
      </header>

      <section class="section">
        <h2>Columns</h2>
        <p class="hint">
          These were proposed from the data. Change them if they are wrong: the checks below update as you do.
        </p>
        <div class="panel cols">
          <div class="stack">
            <label class="field">
              Month column
              <select value={mapping.date} onChange={(e) => remap({ date: e.currentTarget.value })}>
                <option value="">Choose a column</option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span class="help">One row per month, for example 2024-03 or Mar 2024.</span>
            </label>
            <label class="field">
              Sales column
              <select value={mapping.target} onChange={(e) => remap({ target: e.currentTarget.value })}>
                <option value="">Choose a column</option>
                {profiles
                  .filter((p) => p.name !== mapping.date)
                  .map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <span class="help">The number to forecast.</span>
            </label>
          </div>
          <fieldset>
            <legend>External factors</legend>
            <p class="muted small" style={{ marginBottom: '0.4rem' }}>
              Numeric columns that may drive sales. They are what the what-if lets you change.
            </p>
            <div class="factor-list">
              {profiles
                .filter((p) => p.name !== mapping.date && p.name !== mapping.target)
                .map((p) => (
                  <label key={p.name}>
                    <input
                      type="checkbox"
                      checked={mapping.factors.includes(p.name)}
                      onChange={(e) =>
                        remap({
                          factors: e.currentTarget.checked
                            ? dataset.columns.filter((c) => c === p.name || mapping.factors.includes(c))
                            : mapping.factors.filter((f) => f !== p.name),
                        })
                      }
                    />
                    {p.name}
                    <span class="kind">{kindOf(p)}</span>
                  </label>
                ))}
              {profiles.length <= 2 && <p class="muted small">This file has no other columns.</p>}
            </div>
          </fieldset>
        </div>
        <details style={{ marginTop: '0.8rem' }}>
          <summary>Preview the first rows</summary>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  {dataset.columns.map((c) => (
                    <th key={c} class={role(c) === 'date' ? '' : 'n'}>
                      {c}
                      {role(c) && (
                        <>
                          <br />
                          <span class={`tag ${role(c)}`}>{role(c) === 'date' ? 'Month' : role(c) === 'sales' ? 'Sales' : 'Factor'}</span>
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.rows.slice(0, 8).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, c) => (
                      <td key={c} class={role(dataset.columns[c]) === 'date' ? '' : 'n'}>
                        {cell || <span class="muted">blank</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section class="section">
        <h2>Data checks</h2>
        {prepared && (
          <p class="hint">
            {plural(analysis.months, 'month')} of history, {monthLabel(prepared.firstMonth)} to{' '}
            {monthLabel(prepared.firstMonth + analysis.months - 1)}, with{' '}
            {prepared.factors.length ? plural(prepared.factors.length, 'external factor') : 'no external factors'}.
          </p>
        )}
        <ul class="checks">
          {analysis.issues.map((issue) => (
            <li key={issue.title} class={`check ${issue.level}`}>
              <span class="level">{LEVEL[issue.level]}</span>
              <div>
                <strong>{issue.title}</strong>
                <p>{issue.detail}</p>
              </div>
            </li>
          ))}
          {!analysis.issues.some((i) => i.level !== 'info') && (
            <li class="check ok">
              <span class="level">Ready</span>
              <div>
                <strong>No problems found</strong>
                <p>Every month is present and every value is a number.</p>
              </div>
            </li>
          )}
        </ul>
      </section>

      <section class="section">
        <h2>Forecast</h2>
        {analysis.blocked || !prepared ? (
          <div class="notice warn">
            <strong>Fix the items marked "Must fix" to run a forecast</strong>
            Everything else on this page keeps working while you do.
          </div>
        ) : (
          <div class="panel stack">
            <label class="field">
              Months ahead
              <div class="row">
                <input
                  type="number"
                  min={1}
                  max={max}
                  value={months}
                  onInput={(e) => {
                    const v = Math.round(Number(e.currentTarget.value));
                    if (v >= 1) setHorizon(Math.min(v, max));
                  }}
                />
                <input
                  type="range"
                  min={1}
                  max={max}
                  value={months}
                  aria-label="Months ahead"
                  onInput={(e) => setHorizon(Number(e.currentTarget.value))}
                />
              </div>
              <span class="help">
                Up to {max} for this dataset: a third of its {analysis.months} months of history, and never more
                than 24. Forecasting {monthLabel(prepared.firstMonth + analysis.months)} to{' '}
                {monthLabel(prepared.firstMonth + analysis.months + months - 1)}.
              </span>
            </label>
            <fieldset>
              <legend>How thoroughly to test the models</legend>
              <div class="modes">
                {(['quick', 'thorough'] as Mode[]).map((m) => (
                  <label class="mode" key={m}>
                    <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                    <strong>
                      {m === 'quick' ? 'Quick' : 'Thorough'}
                      {device.suggestedMode === m && <span class="tag best">Suggested for this device</span>}
                    </strong>
                    <span class="desc">
                      {m === 'quick'
                        ? 'Each model is tested once, on the most recent months held back from it. Takes seconds.'
                        : 'Each model is tested on up to four rolling windows and the scores are averaged. SARIMAX and Holt-Winters also search for their best settings. Takes longer, and the scores are steadier.'}
                    </span>
                  </label>
                ))}
              </div>
              <p class="muted small" style={{ marginTop: '0.5rem' }}>
                {device.reason} All four models run either way: the fitting happens on this device, so it costs
                nothing.
              </p>
            </fieldset>
            <div class="row">
              <button class="btn primary big" onClick={run} disabled={!engineReady}>
                Run forecast
              </button>
              {!engineReady && (
                <span class="muted" role="status">
                  {status.phase === 'starting'
                    ? `The engine is starting (${status.bootMessage.toLowerCase() || 'one moment'})…`
                    : 'The engine is not running. See the Engine page.'}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {runs.length > 0 && (
        <section class="section">
          <h2>Earlier runs on this dataset</h2>
          <ul class="list">
            {runs.map((r) => {
              const best = r.best ? r.results[r.best] : undefined;
              return (
                <li key={r.id}>
                  <div class="what">
                    <a href={`#/run/${r.id}`}>{when(r.createdAt)}</a>
                    <div class="muted small">
                      {plural(r.horizon, 'month')} ahead, {r.mode}
                      {r.best && succeeded(best)
                        ? `. Best: ${MODELS[r.best].name}, MAPE ${percent(best.metrics.mape)}`
                        : ''}
                    </div>
                  </div>
                  <a class="btn" href={`#/run/${r.id}`}>
                    Open
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
