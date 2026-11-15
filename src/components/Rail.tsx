import { useEffect, useState } from 'preact/hooks';
import { CREDIT, engine } from '../engine/install';
import { dataVersion, listDatasets, listRuns } from '../lib/db';
import { bytes } from '../lib/format';
import { useStore } from '../lib/store';

function useCounts() {
  const version = useStore(dataVersion);
  const [counts, setCounts] = useState({ datasets: 0, runs: 0, stored: 0 });
  const phase = useStore(engine).phase;
  useEffect(() => {
    let live = true;
    (async () => {
      const [datasets, runs, estimate] = await Promise.all([
        listDatasets(),
        listRuns(),
        navigator.storage?.estimate?.() ?? Promise.resolve({ usage: 0 }),
      ]);
      if (live) setCounts({ datasets: datasets.length, runs: runs.length, stored: estimate.usage ?? 0 });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [version, phase]);
  return counts;
}

export function engineLine(status: ReturnType<typeof engine.get>): { dot: string; text: string } {
  switch (status.phase) {
    case 'ready':
      return status.busy
        ? { dot: 'busy', text: 'Fitting models' }
        : { dot: 'ready', text: `Ready, ${status.workers} ${status.workers === 1 ? 'worker' : 'workers'}` };
    case 'starting':
      return { dot: 'busy', text: status.bootMessage || 'Starting' };
    case 'installing':
      return { dot: 'busy', text: 'Installing' };
    case 'absent':
      return { dot: '', text: 'Not installed' };
    case 'checking':
      return { dot: '', text: 'Checking' };
    default:
      return { dot: 'bad', text: 'Could not start' };
  }
}

export function Rail({ current }: { current: string }) {
  const status = useStore(engine);
  const counts = useCounts();
  const line = engineLine(status);
  const link = (href: string, label: string, key: string, count?: number) => (
    <a href={href} aria-current={current === key ? 'page' : undefined}>
      {label}
      {count ? <span class="count">{count}</span> : null}
    </a>
  );
  return (
    <aside class="rail">
      <a class="brand" href="#/">
        <img src="/favicon.svg" alt="" />
        Demand Forecasting
      </a>
      <nav class="nav" aria-label="Main">
        {link('#/', 'Datasets', 'datasets', counts.datasets)}
        {link('#/runs', 'Run history', 'runs', counts.runs)}
        {link('#/engine', 'Engine', 'engine')}
      </nav>
      <section class="device" aria-label="On this device">
        <h2>On this device</h2>
        <dl>
          <div>
            <dt>Rama's ML Engine</dt>
            <dd>
              <span class={`dot ${line.dot}`} />
              <span role="status">{line.text}</span>
            </dd>
          </div>
          <div>
            <dt>Browser storage in use</dt>
            <dd>{bytes(counts.stored)} stored here</dd>
          </div>
          <div>
            <dt>Sent to a server</dt>
            <dd>Nothing has left this device</dd>
          </div>
        </dl>
        <p class="credit">
          {CREDIT} <a href="#/licences">Licences</a>
        </p>
      </section>
    </aside>
  );
}
