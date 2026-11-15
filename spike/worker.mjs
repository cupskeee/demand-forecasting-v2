// Step 1 proof: load the engine in a worker, fit all four models, report timings.
import { loadPyodide } from '/engine/pyodide.mjs';

const say = (text) => self.postMessage({ type: 'log', text });
const ms = (from) => Math.round(performance.now() - from);

// A small, fixed monthly dataset: 60 months, trend, yearly season, two factors.
function dataset() {
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const y = [], X = [];
  for (let t = 0; t < 72; t++) {
    const price = 10 + 0.05 * t + (t % 12 === 0 ? 0.5 : 0) + rand() * 0.3;
    const promo = rand() < 0.25 ? 1 : 0;
    const season = 12 * Math.sin((2 * Math.PI * (t % 12)) / 12);
    X.push([price, promo]);
    if (t < 60) y.push(200 + 1.2 * t + season - 6 * (price - 10) + 15 * promo + (rand() - 0.5) * 8);
  }
  return { y, X: X.slice(0, 60), X_future: X.slice(60) };
}

try {
  const timings = {};
  let t = performance.now();
  const pyodide = await loadPyodide({ indexURL: '/engine/' });
  timings.runtimeMs = ms(t);
  say(`runtime ready in ${timings.runtimeMs} ms`);

  t = performance.now();
  await pyodide.loadPackage(['numpy', 'pandas', 'scikit-learn', 'statsmodels', 'xgboost']);
  timings.packagesMs = ms(t);
  say(`packages loaded in ${timings.packagesMs} ms`);

  t = performance.now();
  const source = await (await fetch('/src/engine/forecast_engine.py')).text();
  pyodide.FS.writeFile('/home/pyodide/forecast_engine.py', source);
  const engine = pyodide.pyimport('forecast_engine');
  const versions = pyodide.runPython(`
import numpy, pandas, sklearn, statsmodels, xgboost, sys
{"python": sys.version.split()[0], "numpy": numpy.__version__, "pandas": pandas.__version__,
 "scikit-learn": sklearn.__version__, "statsmodels": statsmodels.__version__, "xgboost": xgboost.__version__}
`).toJs({ dict_converter: Object.fromEntries });
  timings.importMs = ms(t);
  say(`libraries imported in ${timings.importMs} ms`);

  const data = dataset();
  const models = {};
  for (const mode of ['quick', 'thorough']) {
    for (const model of ['xgboost', 'sarimax', 'elasticnet', 'holtwinters']) {
      t = performance.now();
      const spec = { ...data, factors: ['price', 'promo'], horizon: 12, mode, m0: 0, model, key: `spike:${mode}:${model}` };
      const out = engine.run_model(pyodide.toPy(spec), () => {}).toJs({ dict_converter: Object.fromEntries });
      const took = ms(t);
      if (mode === 'quick' && timings.firstForecastMs === undefined) timings.firstForecastMs = Math.round(performance.now());
      models[`${mode}:${model}`] = {
        ms: took, mape: +out.metrics.mape.toFixed(2), r2: +out.metrics.r2.toFixed(3),
        summary: out.summary, forecast: out.forecast.slice(0, 3).map((v) => +v.toFixed(1)),
      };
      say(`${mode} ${model}: ${took} ms, MAPE ${out.metrics.mape.toFixed(2)}%, ${out.summary}`);
    }
  }
  // What-if on each model: price up 5 percent.
  const whatIf = {};
  for (const model of ['xgboost', 'sarimax', 'elasticnet', 'holtwinters']) {
    const spec = { ...data, factors: ['price', 'promo'], horizon: 12, mode: 'quick', m0: 0, model, key: `spike:quick:${model}`,
      X_scenario: data.X_future.map(([p, q]) => [p * 1.05, q]) };
    const out = engine.what_if(pyodide.toPy(spec), () => {}).toJs({ dict_converter: Object.fromEntries });
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    whatIf[model] = +(((sum(out.scenario) - sum(out.baseline)) / sum(out.baseline)) * 100).toFixed(2);
  }
  say(`what-if, price +5%: change in 12-month total, percent: ${JSON.stringify(whatIf)}`);
  const heapMB = Math.round(pyodide._module.HEAPU8.length / 1048576);
  self.postMessage({ type: 'done', result: { versions, timings, models, whatIf, wasmHeapMB: heapMB } });
} catch (err) {
  self.postMessage({ type: 'error', text: String(err && err.stack || err) });
}
