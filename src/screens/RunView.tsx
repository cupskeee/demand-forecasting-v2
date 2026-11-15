import { useEffect, useState } from 'preact/hooks';
import { Chart, type Band, type Line, type Zone } from '../components/Chart';
import { Confirm } from '../components/Confirm';
import { WhatIf } from '../components/WhatIf';
import { activeRun, cancelRun, type ActiveRun } from '../engine/runner';
import { deleteRun, getRun } from '../lib/db';
import { humanise, monthLabel, num, percent, plural, seconds, when } from '../lib/format';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import {
  MODELS,
  MODEL_IDS,
  failed,
  modelBlurb,
  modelName,
  succeeded,
  type ModelId,
  type ModelResult,
  type Run,
} from '../lib/types';

const INK = 'var(--ink)';

/** Places a list of values at a starting position in an otherwise empty series. */
export function place(length: number, at: number, values: number[]): (number | null)[] {
  const out: (number | null)[] = new Array(length).fill(null);
  values.forEach((v, i) => (out[at + i] = v));
  return out;
}

function historyParts(run: Run) {
  const { y, filled } = run.prepared;
  const n = y.length;
  const total = n + run.horizon;
  return {
    n,
    total,
    history: { id: 'history', label: `Actual ${humanise(run.target)}`, color: INK, points: place(total, 0, y), width: 1.8 } as Line,
    hollow: filled.map((f, i) => (f ? { at: i, value: y[i] } : null)).filter((h) => h !== null),
  };
}

export function RunView({ id }: { id: string }) {
  const active = useStore(activeRun);
  const [stored, setStored] = useState<Run | null | undefined>(undefined);
  const live = active && active.run.id === id ? active : null;
  useEffect(() => {
    getRun(id).then((r) => setStored(r ?? null), () => setStored(null));
  }, [id, live?.run.status]);

  const run = live?.run ?? stored;
  if (run === undefined) return null;
  if (run === null) {
    return (
      <div class="empty">
        <strong>This run is not on this device</strong>
        It may have been deleted, or the link came from another browser. <a href="#/runs">See the run history</a>
      </div>
    );
  }
  if (run.status === 'running' && live) return <Running active={live} />;
  if (run.status !== 'done') {
    return (
      <>
        <header class="page-head">
          <a class="crumb" href={`#/dataset/${run.datasetId}`}>
            {run.datasetName}
          </a>
          <h1>Run cancelled</h1>
          <p class="lead">The models were stopped before they finished, and nothing was saved.</p>
        </header>
        <a class="btn primary" href={`#/dataset/${run.datasetId}`}>
          Back to the dataset
        </a>
      </>
    );
  }
  return <Results run={run} />;
}

/* ------------------------------------------------------------------ live fitting */

function Running({ active }: { active: ActiveRun }) {
  const { run, live } = active;
  const { n, total, history, hollow } = historyParts(run);
  const hasFactors = run.prepared.factors.length > 0;
  const lines: Line[] = [history];
  for (const id of MODEL_IDS) {
    const result = run.results[id];
    if (!succeeded(result)) continue;
    lines.push(
      { id, label: modelName(id, hasFactors), color: MODELS[id].color, points: place(total, n, result.forecast) },
      { id: `${id}-join`, label: '', color: MODELS[id].color, points: place(total, n - 1, [run.prepared.y[n - 1], result.forecast[0]]), silent: true },
    );
  }
  const finished = MODEL_IDS.filter((id) => run.results[id]).length;
  return (
    <>
      <header class="page-head">
        <a class="crumb" href={`#/dataset/${run.datasetId}`}>
          {run.datasetName}
        </a>
        <h1>Fitting four models on this device</h1>
        <p class="lead" role="status">
          {finished} of 4 finished. {plural(run.horizon, 'month')} ahead, {run.mode} testing. Each forecast is
          drawn as soon as its model is done.
        </p>
      </header>
      <Chart
        firstMonth={run.prepared.firstMonth}
        from={Math.max(0, n - 48)}
        to={total}
        lines={lines}
        zones={[{ from: n - 1, to: total - 1, label: 'Forecast' }]}
        hollow={hollow}
        hollowLabel="Filled-in month"
        label="Sales history and the forecasts finished so far"
      />
      <ul class="fits section">
        {MODEL_IDS.map((id) => {
          const state = live[id];
          const result = run.results[id];
          return (
            <li class="fit" key={id}>
              <span class="name">
                <span class="swatch" style={{ background: MODELS[id].color }} />
                {modelName(id, hasFactors)}
              </span>
              <div
                class="meter thin"
                role="progressbar"
                aria-label={`${MODELS[id].name} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(state.fraction * 100)}
              >
                <div style={{ width: `${state.fraction * 100}%`, background: MODELS[id].color }} />
              </div>
              <span class="msg">{state.message}</span>
              <span class="score">
                {succeeded(result) ? (
                  <>
                    MAPE {percent(result.metrics.mape)}
                    <br />
                    <span class="muted small">{seconds(result.seconds)}</span>
                  </>
                ) : state.state === 'failed' ? (
                  <span class="down">Failed</span>
                ) : state.state === 'queued' ? (
                  <span class="muted">Queued</span>
                ) : (
                  <span class="muted">{Math.round(state.fraction * 100)}%</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <div class="section">
        <button class="btn" onClick={cancelRun}>
          Cancel run
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ results */

const sig = (v: number) => (v === 0 ? '0' : Math.abs(v) >= 100 ? num(v, 0) : Number(v.toPrecision(3)).toString());

function Results({ run }: { run: Run }) {
  const hasFactors = run.prepared.factors.length > 0;
  const done = MODEL_IDS.filter((id) => succeeded(run.results[id]));
  const [selected, setSelected] = useState<ModelId>(run.best ?? MODEL_IDS[0]);
  const [compare, setCompare] = useState(false);
  const [allHistory, setAllHistory] = useState(false);
  const [asking, setAsking] = useState(false);
  const { n, total, history, hollow } = historyParts(run);
  const outcome = run.results[selected];
  const result = succeeded(outcome) ? outcome : null;
  const best = run.best && succeeded(run.results[run.best]) ? (run.results[run.best] as ModelResult) : null;
  const name = (id: ModelId) => modelName(id, hasFactors);
  const month = (i: number) => monthLabel(run.prepared.firstMonth + i);

  if (!best) {
    return (
      <>
        <header class="page-head">
          <a class="crumb" href={`#/dataset/${run.datasetId}`}>
            {run.datasetName}
          </a>
          <h1>None of the models could be fitted</h1>
        </header>
        <ul class="checks">
          {MODEL_IDS.map((id) => {
            const o = run.results[id];
            return (
              <li class="check blocker" key={id}>
                <span class="level">{MODELS[id].name}</span>
                <p>{failed(o) ? o.error : 'Did not run.'}</p>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  const lines: Line[] = [history];
  const bands: Band[] = [];
  const zones: Zone[] = [];
  if (result) {
    const color = MODELS[selected].color;
    const held = result.holdout;
    zones.push({ from: held.start, to: n - 1, label: 'Held back for testing' });
    lines.push(
      { id: 'backtest', label: 'Predicted when held back', color, points: place(total, held.start, held.predicted), dash: true },
      { id: 'forecast', label: `${MODELS[selected].name} forecast`, color, points: place(total, n, result.forecast), width: 2.4 },
      { id: 'join', label: '', color, points: place(total, n - 1, [run.prepared.y[n - 1], result.forecast[0]]), silent: true, width: 2.4 },
    );
    bands.push({
      color,
      lower: place(total, n, result.lower),
      upper: place(total, n, result.upper),
      label: result.band === 'model' ? '80% interval from the model' : '80% range from back-test error',
    });
  }
  zones.push({ from: n - 1, to: total - 1, label: 'Forecast' });
  if (compare) {
    for (const id of done) {
      if (id === selected) continue;
      const other = run.results[id] as ModelResult;
      lines.push({ id, label: MODELS[id].name, color: MODELS[id].color, points: place(total, n, other.forecast), faint: true, width: 1.6 });
    }
  }

  const metricKeys = ['mape', 'mae', 'rmse', 'r2'] as const;
  const bestOf = (key: (typeof metricKeys)[number]) => {
    const values = done.map((id) => (run.results[id] as ModelResult).metrics[key]).filter((v): v is number => v !== null);
    if (!values.length) return null;
    return key === 'r2' ? Math.max(...values) : Math.min(...values);
  };
  const windows = best.folds.length;
  const totalImportance = result?.driverKind === 'importance' ? result.drivers.reduce((s, v) => s + v, 0) : 0;

  return (
    <>
      <header class="page-head">
        <a class="crumb" href={`#/dataset/${run.datasetId}`}>
          {run.datasetName}
        </a>
        <h1>Forecast: {plural(run.horizon, 'month')} ahead</h1>
        <p class="verdict">
          {name(run.best!)} scored best. Tested on {windows === 1 ? `the last ${best.folds[0].months} months` : `${windows} windows of ${best.folds[0].months} months`}{' '}
          held back from it, its predictions were off by {percent(best.metrics.mape)} on average.
        </p>
        <p class="meta">
          <span>{month(n)} to {month(total - 1)}</span>
          <span>{run.mode === 'quick' ? 'Quick' : 'Thorough'} testing</span>
          <span>Fitted in {seconds(run.seconds)} on this device</span>
          <span>{when(run.createdAt)}</span>
        </p>
      </header>

      <div class="tabs" role="tablist" aria-label="Model">
        {MODEL_IDS.map((id) => {
          const o = run.results[id];
          return (
            <button
              key={id}
              role="tab"
              class="tab"
              aria-selected={selected === id}
              style={{ '--c': MODELS[id].color }}
              onClick={() => setSelected(id)}
            >
              <span class="t-name">
                {name(id)}
                {run.best === id && <span class="tag best">Best</span>}
              </span>
              <span class="t-score">{succeeded(o) ? `MAPE ${percent(o.metrics.mape)}` : 'Could not be fitted'}</span>
            </button>
          );
        })}
      </div>

      <div class="section" role="tabpanel" aria-label={name(selected)}>
        {result ? (
          <div class="stack">
            <div class="row spread">
              <h2>{name(selected)}</h2>
              <div class="row">
                <label class="row small">
                  <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.currentTarget.checked)} />
                  Overlay the other models
                </label>
                {n > 48 && (
                  <label class="row small">
                    <input type="checkbox" checked={allHistory} onChange={(e) => setAllHistory(e.currentTarget.checked)} />
                    Show all history
                  </label>
                )}
              </div>
            </div>
            <Chart
              firstMonth={run.prepared.firstMonth}
              from={allHistory ? 0 : Math.max(0, n - 48)}
              to={total}
              lines={lines}
              bands={bands}
              zones={zones}
              hollow={hollow}
              hollowLabel="Filled-in month"
              label={`${name(selected)}: history, back-test and forecast`}
            />
            <div class="split">
              <div class="about-model">
                <p>{modelBlurb(selected, hasFactors)}</p>
                <p class="muted">As fitted here: {result.summary}.</p>
                {hasFactors && (
                  <details>
                    <summary>What it learned about the external factors</summary>
                    <div class="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Factor</th>
                            <th class="n wrap">
                              {result.driverKind === 'importance'
                                ? 'Share of what the trees used'
                                : `Change in monthly ${humanise(run.target)} per 1 more`}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {run.prepared.factors.map((f, i) => (
                            <tr key={f}>
                              <th>{f}</th>
                              <td class="n">
                                {result.driverKind === 'importance'
                                  ? percent(totalImportance ? ((result.drivers[i] ?? 0) / totalImportance) * 100 : 0, 0)
                                  : sig(result.drivers[i] ?? 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th class="n">Forecast</th>
                      <th class="n">Low</th>
                      <th class="n">High</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.forecast.map((v, j) => (
                      <tr key={j}>
                        <th>{month(n + j)}</th>
                        <td class="n">{num(v)}</td>
                        <td class="n muted">{num(result.lower[j])}</td>
                        <td class="n muted">{num(result.upper[j])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div class="notice bad">
            <strong>{name(selected)} could not be fitted to this data</strong>
            {failed(outcome) ? outcome.error : 'It did not run.'} The other models are unaffected.
          </div>
        )}
      </div>

      <section class="section">
        <h2>All four models compared</h2>
        <p class="hint">
          Scores come from months the models never saw while being fitted
          {windows > 1 ? `, averaged over ${windows} rolling windows` : ''}. The best model is the one with the
          lowest MAPE, the average error as a percentage of actual sales.
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th class="n">MAPE</th>
                <th class="n">MAE</th>
                <th class="n">RMSE</th>
                <th class="n">R²</th>
                <th class="n">Time to fit</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_IDS.map((id) => {
                const o = run.results[id];
                if (!succeeded(o)) {
                  return (
                    <tr key={id}>
                      <th>{name(id)}</th>
                      <td colSpan={5} class="wrap muted">
                        Could not be fitted: {failed(o) ? o.error : 'did not run'}
                      </td>
                    </tr>
                  );
                }
                const cell = (key: (typeof metricKeys)[number], text: string) => (
                  <td class={`n ${o.metrics[key] !== null && o.metrics[key] === bestOf(key) ? 'top' : ''}`}>{text}</td>
                );
                return (
                  <tr key={id} class={run.best === id ? 'is-best' : ''}>
                    <th>
                      <button class="btn quiet" onClick={() => setSelected(id)}>
                        {name(id)}
                      </button>{' '}
                      {run.best === id && <span class="tag best">Best</span>}
                    </th>
                    {cell('mape', percent(o.metrics.mape, 2))}
                    {cell('mae', num(o.metrics.mae))}
                    {cell('rmse', num(o.metrics.rmse))}
                    {cell('r2', o.metrics.r2 === null ? 'n/a' : o.metrics.r2.toFixed(3))}
                    <td class="n">{seconds(o.seconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {windows > 1 && (
          <details style={{ marginTop: '0.6rem' }}>
            <summary>MAPE in each back-test window</summary>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    {best.folds.map((f) => (
                      <th class="n" key={f.start}>
                        {month(f.start)} to {month(f.start + f.months - 1)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {done.map((id) => (
                    <tr key={id}>
                      <th>{name(id)}</th>
                      {(run.results[id] as ModelResult).folds.map((f) => (
                        <td class="n" key={f.start}>
                          {percent(f.mape, 2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <WhatIf run={run} initialModel={result ? selected : run.best!} />

      <section class="section row">
        <a class="btn" href={`#/dataset/${run.datasetId}`}>
          Run again with other settings
        </a>
        <button class="btn danger" onClick={() => setAsking(true)}>
          Delete this run
        </button>
      </section>
      <Confirm
        open={asking}
        title="Delete this run?"
        confirmLabel="Delete run"
        danger
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          await deleteRun(run.id);
          if (activeRun.get()?.run.id === run.id) activeRun.set(null);
          navigate('/runs');
        }}
      >
        <p>Its forecasts and scores are removed from this browser. The dataset stays.</p>
      </Confirm>
    </>
  );
}
