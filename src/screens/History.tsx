import { useEffect, useState } from 'preact/hooks';
import { Confirm } from '../components/Confirm';
import { dataVersion, deleteRun, listRuns } from '../lib/db';
import { percent, plural, seconds, when } from '../lib/format';
import { useStore } from '../lib/store';
import { MODELS, succeeded, type Run } from '../lib/types';

export function History() {
  const version = useStore(dataVersion);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [doomed, setDoomed] = useState<Run | null>(null);
  useEffect(() => {
    listRuns().then(setRuns, () => setRuns([]));
  }, [version]);

  return (
    <>
      <header class="page-head">
        <h1>Run history</h1>
        <p class="lead">
          Every finished forecast is kept in this browser, with the data it was fitted on, so you can reopen it
          later, with or without a network.
        </p>
      </header>
      {runs === null ? null : runs.length === 0 ? (
        <div class="empty">
          <strong>No runs yet</strong>
          Open a dataset and run a forecast. It will be listed here. <a href="#/">Go to datasets</a>
        </div>
      ) : (
        <ul class="list">
          {runs.map((r) => {
            const best = r.best ? r.results[r.best] : undefined;
            return (
              <li key={r.id}>
                <div class="what">
                  <a href={`#/run/${r.id}`}>{r.datasetName}</a>
                  <div class="muted small">
                    {when(r.createdAt)}. {plural(r.horizon, 'month')} ahead, {r.mode}, fitted in {seconds(r.seconds)}.
                    {r.best && succeeded(best)
                      ? ` Best: ${MODELS[r.best].name}, MAPE ${percent(best.metrics.mape)}.`
                      : ' No model could be fitted.'}
                  </div>
                </div>
                <div class="row">
                  <a class="btn" href={`#/run/${r.id}`}>
                    Open
                  </a>
                  <button class="btn danger" onClick={() => setDoomed(r)} aria-label={`Delete run of ${r.datasetName} from ${when(r.createdAt)}`}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Confirm
        open={!!doomed}
        title="Delete this run?"
        confirmLabel="Delete run"
        danger
        onCancel={() => setDoomed(null)}
        onConfirm={async () => {
          if (doomed) await deleteRun(doomed.id);
          setDoomed(null);
        }}
      >
        <p>
          The run of {doomed?.datasetName} from {doomed ? when(doomed.createdAt) : ''} is removed from this
          browser. The dataset stays.
        </p>
      </Confirm>
    </>
  );
}
