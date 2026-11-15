import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { engine } from '../engine/install';
import { runWhatIf, type WhatIfResult } from '../engine/runner';
import { futureSource } from '../lib/checks';
import { humanise, monthLabel, num, percent, signed } from '../lib/format';
import { useStore } from '../lib/store';
import { MODELS, MODEL_IDS, modelName, succeeded, type ModelId, type Run } from '../lib/types';
import { Chart, type Line } from './Chart';

interface Adjust {
  kind: 'percent' | 'add';
  value: number;
}

const place = (length: number, at: number, values: number[]) => {
  const out: (number | null)[] = new Array(length).fill(null);
  values.forEach((v, i) => (out[at + i] = v));
  return out;
};

export function WhatIf({ run, initialModel }: { run: Run; initialModel: ModelId }) {
  const { factors } = run.prepared;
  const status = useStore(engine);
  const available = MODEL_IDS.filter((id) => succeeded(run.results[id]));
  const [model, setModel] = useState<ModelId>(initialModel);
  const [adjust, setAdjust] = useState<Adjust[]>(() => factors.map(() => ({ kind: 'percent', value: 0 })));
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [result, setResult] = useState<(WhatIfResult & { model: ModelId }) | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const sequence = useRef(0);

  const scenario = useMemo(
    () =>
      run.xFuture.map((row, j) =>
        row.map((base, f) => {
          const key = `${j}:${f}`;
          if (key in overrides) return overrides[key];
          const a = adjust[f];
          return a.kind === 'percent' ? base * (1 + a.value / 100) : base + a.value;
        }),
      ),
    [run.xFuture, adjust, overrides],
  );
  const changed = scenario.some((row, j) => row.some((v, f) => Math.abs(v - run.xFuture[j][f]) > 1e-9));
  const ready = status.phase === 'ready';

  useEffect(() => {
    if (!changed) {
      setResult(null);
      setError('');
      return;
    }
    if (!ready) return;
    const mine = ++sequence.current;
    const timer = setTimeout(() => {
      setWorking(true);
      runWhatIf(run, model, scenario).then(
        (r) => {
          if (mine !== sequence.current) return;
          setResult({ ...r, model });
          setError('');
          setWorking(false);
        },
        (err: Error) => {
          if (mine !== sequence.current) return;
          setError(err.message);
          setWorking(false);
        },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [scenario, model, ready, changed]);

  if (!factors.length) {
    return (
      <section class="section">
        <h2>What-if</h2>
        <div class="empty">
          <strong>Not available for this dataset</strong>
          A what-if changes the future values of external factors, such as price, and this dataset has none. The
          forecasts above use the sales history only.
        </div>
      </section>
    );
  }

  const n = run.prepared.y.length;
  const total = n + run.horizon;
  const month = (i: number) => monthLabel(run.prepared.firstMonth + i);
  const sources = futureSource(run.prepared, run.horizon);
  const reset = () => {
    setAdjust(factors.map(() => ({ kind: 'percent', value: 0 })));
    setOverrides({});
  };
  const setOne = (f: number, part: Partial<Adjust>) => {
    setAdjust((all) => all.map((a, i) => (i === f ? { ...a, ...part } : a)));
    setOverrides((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.endsWith(`:${f}`))));
  };
  const suggestion = run.suggestion && factors.includes(run.suggestion.factor) ? run.suggestion : null;
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const show = result && result.model === model && changed ? result : null;

  const lines: Line[] = [
    { id: 'history', label: `Actual ${humanise(run.target)}`, color: 'var(--ink)', points: place(total, 0, run.prepared.y), width: 1.8 },
  ];
  if (show) {
    const last = run.prepared.y[n - 1];
    lines.push(
      { id: 'baseline', label: 'Baseline forecast', color: '#7b8f93', points: place(total, n, show.baseline), dash: true },
      { id: 'scenario', label: 'What-if forecast', color: MODELS[model].color, points: place(total, n, show.scenario), width: 2.4 },
      { id: 'join', label: '', color: MODELS[model].color, points: place(total, n - 1, [last, show.scenario[0]]), silent: true, width: 2.4 },
    );
  }

  return (
    <section class="section">
      <h2>What-if</h2>
      <p class="hint">
        Change the future values of the external factors and see how one model's forecast responds. The
        baseline is the forecast above; the difference is what your change does.
      </p>
      <div class="split">
        <div class="panel stack">
          <label class="field">
            Model
            <select value={model} onChange={(e) => setModel(e.currentTarget.value as ModelId)}>
              {available.map((id) => (
                <option key={id} value={id}>
                  {modelName(id, true)}
                  {run.best === id ? ' (best)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div>
            <h3>Change over the {run.horizon} forecast months</h3>
            <div class="whatif-grid">
              {factors.map((f, i) => (
                <div class="adjust" key={f}>
                  <span class="f-name">{f}</span>
                  <select
                    aria-label={`How to change ${f}`}
                    value={adjust[i].kind}
                    onChange={(e) => setOne(i, { kind: e.currentTarget.value as Adjust['kind'] })}
                  >
                    <option value="percent">by percent</option>
                    <option value="add">by amount</option>
                  </select>
                  <input
                    type="number"
                    step="any"
                    aria-label={`Change ${f} ${adjust[i].kind === 'percent' ? 'by percent' : 'by amount'}`}
                    value={adjust[i].value}
                    onInput={(e) => {
                      const v = Number(e.currentTarget.value);
                      if (Number.isFinite(v)) setOne(i, { value: v });
                    }}
                  />
                  <span class="f-src">Baseline: {sources[i]}.</span>
                </div>
              ))}
            </div>
          </div>
          <div class="row">
            {suggestion && (
              <button
                class="btn"
                onClick={() => {
                  setOverrides({});
                  setAdjust(
                    factors.map((f) =>
                      f === suggestion.factor ? { kind: suggestion.kind, value: suggestion.value } : { kind: 'percent', value: 0 },
                    ),
                  );
                }}
              >
                Try: {suggestion.label}
              </button>
            )}
            <button class="btn quiet" onClick={reset} disabled={!changed}>
              Reset to baseline
            </button>
          </div>
          <details>
            <summary>Edit month by month</summary>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    {factors.map((f) => (
                      <th class="n" key={f}>
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scenario.map((row, j) => (
                    <tr key={j}>
                      <th>{month(n + j)}</th>
                      {row.map((v, f) => (
                        <td class="n" key={f}>
                          <input
                            type="number"
                            step="any"
                            class={`cell-input ${Math.abs(v - run.xFuture[j][f]) > 1e-9 ? 'edited' : ''}`}
                            aria-label={`${factors[f]} in ${month(n + j)}`}
                            value={Number(v.toPrecision(8))}
                            onChange={(e) => {
                              const next = Number(e.currentTarget.value);
                              if (e.currentTarget.value !== '' && Number.isFinite(next)) {
                                setOverrides((o) => ({ ...o, [`${j}:${f}`]: next }));
                              }
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <div class="stack" aria-live="polite">
          {!changed ? (
            <div class="empty">
              <strong>Nothing changed yet</strong>
              Enter a change on the left{suggestion ? `, or use "Try: ${suggestion.label}"` : ''}. The result appears
              here as you type.
            </div>
          ) : error ? (
            <div class="notice bad">
              <strong>The what-if could not be calculated</strong>
              {error}
            </div>
          ) : !ready ? (
            <div class="notice warn">The engine is starting. The what-if will run as soon as it is ready.</div>
          ) : !show ? (
            <p class="muted">Calculating on this device…</p>
          ) : (
            <>
              <dl class="totals">
                <div>
                  <dt>Baseline, {run.horizon} months</dt>
                  <dd>{num(sum(show.baseline))}</dd>
                </div>
                <div>
                  <dt>What-if</dt>
                  <dd>{num(sum(show.scenario))}</dd>
                </div>
                <div>
                  <dt>Difference</dt>
                  <dd class={sum(show.scenario) - sum(show.baseline) < 0 ? 'down' : 'up'}>
                    {signed(sum(show.scenario) - sum(show.baseline))}{' '}
                    <span class="small">
                      ({signed(((sum(show.scenario) - sum(show.baseline)) / (sum(show.baseline) || 1)) * 100, 1)}%)
                    </span>
                  </dd>
                </div>
              </dl>
              <p class="muted small">
                {modelName(model, true)}
                {working ? ', recalculating…' : show.refitted ? ', fitted again for this what-if with the same settings.' : '.'}
              </p>
            </>
          )}
        </div>
      </div>

      {show && (
        <div class="stack" style={{ marginTop: '1.2rem' }}>
          <Chart
            firstMonth={run.prepared.firstMonth}
            from={Math.max(0, n - 24)}
            to={total}
            lines={lines}
            zones={[{ from: n - 1, to: total - 1, label: 'Forecast' }]}
            label="Baseline forecast against the what-if forecast"
          />
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th class="n">Baseline</th>
                  <th class="n">What-if</th>
                  <th class="n">Difference</th>
                  <th class="n">Change</th>
                </tr>
              </thead>
              <tbody>
                {show.baseline.map((b, j) => {
                  const d = show.scenario[j] - b;
                  return (
                    <tr key={j}>
                      <th>{month(n + j)}</th>
                      <td class="n">{num(b)}</td>
                      <td class="n">{num(show.scenario[j])}</td>
                      <td class={`n ${d < 0 ? 'down' : d > 0 ? 'up' : ''}`}>{signed(d)}</td>
                      <td class="n">{b ? `${signed((d / b) * 100, 1)}%` : percent(null)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <td class="n">{num(sum(show.baseline))}</td>
                  <td class="n">{num(sum(show.scenario))}</td>
                  <td class="n">{signed(sum(show.scenario) - sum(show.baseline))}</td>
                  <td class="n">
                    {signed(((sum(show.scenario) - sum(show.baseline)) / (sum(show.baseline) || 1)) * 100, 1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
