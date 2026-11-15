// Starts a forecast, tracks each model live, and saves the finished run.
import { futureValues } from '../lib/checks';
import { newId, putRun } from '../lib/db';
import { createStore } from '../lib/store';
import {
  MODEL_IDS,
  succeeded,
  type Dataset,
  type Mode,
  type ModelId,
  type ModelOutcome,
  type ModelResult,
  type Prepared,
  type Run,
} from '../lib/types';
import { Cancelled, cancelRuns, forgetModels, submit } from './pool';

export interface LiveModel {
  state: 'queued' | 'running' | 'done' | 'failed';
  fraction: number;
  message: string;
}
export interface ActiveRun {
  run: Run;
  live: Record<ModelId, LiveModel>;
}

export const activeRun = createStore<ActiveRun | null>(null);

function specFor(run: Run, model: ModelId) {
  const p = run.prepared;
  return {
    model,
    key: `${run.id}:${model}`,
    y: p.y,
    factors: p.factors,
    X: p.X,
    X_future: run.xFuture,
    horizon: run.horizon,
    mode: run.mode,
    m0: ((p.firstMonth % 12) + 12) % 12,
    non_negative: p.nonNegative,
  };
}

/** The best model is the one with the lowest MAPE (RMSE when MAPE cannot be computed). */
export function pickBest(results: Run['results']): ModelId | null {
  const done = MODEL_IDS.map((id) => results[id]).filter(succeeded);
  if (!done.length) return null;
  const score = (r: ModelResult) => r.metrics.mape ?? Number.POSITIVE_INFINITY;
  const useRmse = done.every((r) => r.metrics.mape === null);
  done.sort((a, b) => (useRmse ? a.metrics.rmse - b.metrics.rmse : score(a) - score(b)));
  return done[0].model;
}

export function startRun(dataset: Dataset, prepared: Prepared, horizon: number, mode: Mode): string {
  cancelRuns();
  forgetModels();
  const started = performance.now();
  const run: Run = {
    id: newId(),
    datasetId: dataset.id,
    datasetName: dataset.name,
    target: dataset.mapping.target,
    createdAt: Date.now(),
    mode,
    horizon,
    prepared,
    xFuture: futureValues(prepared, horizon),
    results: {},
    best: null,
    status: 'running',
    seconds: 0,
    suggestion: dataset.suggestion,
  };
  const live = Object.fromEntries(
    MODEL_IDS.map((id) => [id, { state: 'queued', fraction: 0, message: 'Waiting for a free worker' }]),
  ) as Record<ModelId, LiveModel>;
  activeRun.set({ run, live });

  const mine = () => activeRun.get()?.run.id === run.id;
  const update = (model: ModelId, part: Partial<LiveModel>, outcome?: ModelOutcome) => {
    if (!mine()) return;
    activeRun.set((current) => {
      const c = current!;
      const results = outcome ? { ...c.run.results, [model]: outcome } : c.run.results;
      return {
        run: { ...c.run, results },
        live: { ...c.live, [model]: { ...c.live[model], ...part } },
      };
    });
  };

  const jobs = MODEL_IDS.map((model) =>
    submit<ModelResult>('run', specFor(run, model), (fraction, message) =>
      update(model, { state: 'running', fraction, message }),
    ).then(
      (result) => update(model, { state: 'done', fraction: 1, message: 'Done' }, result),
      (err: Error) => {
        if (err instanceof Cancelled) throw err;
        update(model, { state: 'failed', message: err.message }, { model, error: err.message });
      },
    ),
  );

  Promise.all(jobs).then(
    async () => {
      if (!mine()) return;
      const current = activeRun.get()!;
      const finished: Run = {
        ...current.run,
        status: 'done',
        best: pickBest(current.run.results),
        seconds: (performance.now() - started) / 1000,
      };
      activeRun.set({ ...current, run: finished });
      await putRun(finished);
    },
    () => {
      if (!mine()) return;
      activeRun.set((c) => (c ? { ...c, run: { ...c.run, status: 'cancelled' } } : c));
    },
  );
  return run.id;
}

export function cancelRun() {
  cancelRuns();
}

export interface WhatIfResult {
  baseline: number[];
  scenario: number[];
  refitted: boolean;
}

export function runWhatIf(run: Run, model: ModelId, scenario: number[][]): Promise<WhatIfResult> {
  const result = run.results[model];
  return submit<WhatIfResult>('whatif', {
    ...specFor(run, model),
    settings: succeeded(result) ? result.settings : null,
    X_scenario: scenario,
  });
}
