// Runs in a background worker. Loads the Python runtime and libraries from this
// site's /engine/ folder and fits models on request. It never sends data anywhere:
// its only network requests are GETs for the engine files.
import source from './forecast_engine.py?raw';

interface Scope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  location: Location;
  addEventListener(type: 'unhandledrejection', listener: (event: PromiseRejectionEvent) => void): void;
}
const scope = self as unknown as Scope;

interface PyProxy {
  run_json(spec: string, report: (fraction: number, message: string) => void): string;
  what_if_json(spec: string, report: (fraction: number, message: string) => void): string;
  forget(prefix: string): void;
}
interface Pyodide {
  loadPackage(names: string[], options?: object): Promise<unknown>;
  runPython(code: string): { toJs(options?: object): unknown };
  pyimport(name: string): unknown;
  FS: { writeFile(path: string, data: string): void };
  _module: { HEAPU8: Uint8Array };
}

const LIBRARIES = ['numpy', 'pandas', 'scikit-learn', 'statsmodels', 'xgboost'];
const quiet = { messageCallback: () => undefined };

// The runtime can fail in the background without rejecting the promise we wait on
// (for example when its WebAssembly file cannot be fetched). Catch that here, so the
// app can say so instead of waiting for ever.
let started = false;
scope.addEventListener('unhandledrejection', (event) => {
  if (started) return;
  event.preventDefault();
  scope.postMessage({ type: 'fatal', message: explain(event.reason) });
});

const booted: Promise<{ pyodide: Pyodide; api: PyProxy } | null> = (async () => {
  try {
    scope.postMessage({ type: 'boot', message: 'Starting the Python runtime' });
    const url = `${scope.location.origin}/engine/pyodide.mjs`;
    const { loadPyodide } = await import(/* @vite-ignore */ url);
    const pyodide: Pyodide = await loadPyodide({ indexURL: '/engine/' });
    scope.postMessage({ type: 'boot', message: 'Loading the libraries' });
    await pyodide.loadPackage(LIBRARIES, quiet);
    pyodide.FS.writeFile('/home/pyodide/forecast_engine.py', source);
    scope.postMessage({ type: 'boot', message: 'Warming up the models' });
    const versions = pyodide
      .runPython(
        `
import sys, numpy, pandas, sklearn, statsmodels, xgboost
import statsmodels.tsa.statespace.sarimax, statsmodels.tsa.holtwinters, sklearn.linear_model, sklearn.model_selection
{"Python": sys.version.split()[0], "NumPy": numpy.__version__, "pandas": pandas.__version__,
 "scikit-learn": sklearn.__version__, "statsmodels": statsmodels.__version__, "XGBoost": xgboost.__version__}
`,
      )
      .toJs({ dict_converter: Object.fromEntries }) as Record<string, string>;
    const api = pyodide.pyimport('forecast_engine') as PyProxy;
    started = true;
    scope.postMessage({
      type: 'ready',
      versions,
      memoryMB: Math.round(pyodide._module.HEAPU8.length / 1048576),
    });
    return { pyodide, api };
  } catch (err) {
    scope.postMessage({ type: 'fatal', message: explain(err) });
    return null;
  }
})();

function explain(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/memory|allocation|out of bounds/i.test(text)) {
    return 'This device does not have enough free memory to start the engine. Close other tabs or apps and try again.';
  }
  if (/fetch|network|load|import/i.test(text)) {
    return 'An engine file could not be loaded. If the network is off, the copy saved in this browser is incomplete: reconnect and restart the engine, or remove it and install it again.';
  }
  return text.split('\n').slice(-2).join(' ').trim() || 'The engine could not start.';
}

/** The last line of a Python traceback is the part worth showing. */
function pythonError(err: unknown): string {
  const lines = String(err instanceof Error ? err.message : err).trim().split('\n');
  return lines[lines.length - 1].replace(/^\w+(\.\w+)*(Error|Exception|Warning):\s*/, '') || 'The model failed.';
}

scope.onmessage = async (event) => {
  const { type, id, spec } = event.data;
  const engine = await booted;
  if (!engine) return;
  if (type === 'forget') return engine.api.forget('');
  let last = 0;
  const report = (fraction: number, message: string) => {
    const now = performance.now();
    if (fraction < 1 && now - last < 40) return; // at most ~25 updates a second
    last = now;
    scope.postMessage({ type: 'progress', id, fraction, message });
  };
  try {
    const text =
      type === 'run'
        ? engine.api.run_json(JSON.stringify(spec), report)
        : engine.api.what_if_json(JSON.stringify(spec), report);
    scope.postMessage({ type: 'result', id, result: JSON.parse(text) });
  } catch (err) {
    scope.postMessage({ type: 'error', id, message: pythonError(err) });
  }
};
