export type ModelId = 'xgboost' | 'sarimax' | 'elasticnet' | 'holtwinters';
export const MODEL_IDS: ModelId[] = ['xgboost', 'sarimax', 'elasticnet', 'holtwinters'];
export type Mode = 'quick' | 'thorough';

export interface Mapping {
  date: string;
  target: string;
  factors: string[];
}

export interface Suggestion {
  label: string;
  factor: string;
  kind: 'percent' | 'add';
  value: number;
}

export interface Dataset {
  id: string;
  name: string;
  kind: 'user' | 'example';
  fileName?: string;
  createdAt: number;
  columns: string[];
  rows: string[][];
  mapping: Mapping;
  description?: string;
  category?: string;
  suggestion?: Suggestion;
}

/** How a factor's future values are assumed when the file does not give them. */
export type FutureRule = 'last' | 'seasonal';

/** A dataset turned into one clean monthly series, ready for the models. */
export interface Prepared {
  /** Month number (year * 12 + month) of the first month of history. */
  firstMonth: number;
  y: number[];
  /** True where a month was missing or unreadable and its value was filled in. */
  filled: boolean[];
  factors: string[];
  X: number[][];
  /** Factor values the file already gives for months after the history ends. */
  fileFuture: (number | null)[][];
  futureRule: FutureRule[];
  nonNegative: boolean;
}

export interface Metrics {
  mae: number;
  rmse: number;
  mape: number | null;
  r2: number | null;
}

export interface ModelResult {
  model: ModelId;
  metrics: Metrics;
  folds: (Metrics & { start: number; months: number })[];
  holdout: { start: number; predicted: number[] };
  forecast: number[];
  lower: number[];
  upper: number[];
  band: 'model' | 'backtest';
  summary: string;
  settings: unknown;
  drivers: number[];
  driverKind: 'per-unit' | 'importance';
  seconds: number;
}

export interface ModelFailure {
  model: ModelId;
  error: string;
}

export type ModelOutcome = ModelResult | ModelFailure;
export const failed = (o: ModelOutcome | undefined): o is ModelFailure => !!o && 'error' in o;
export const succeeded = (o: ModelOutcome | undefined): o is ModelResult => !!o && 'forecast' in o;

export interface Run {
  id: string;
  datasetId: string;
  datasetName: string;
  target: string;
  createdAt: number;
  mode: Mode;
  horizon: number;
  prepared: Prepared;
  /** Baseline future values of the factors, one row per forecast month. */
  xFuture: number[][];
  results: Partial<Record<ModelId, ModelOutcome>>;
  best: ModelId | null;
  status: 'running' | 'done' | 'cancelled';
  seconds: number;
  suggestion?: Suggestion;
}

export interface ModelInfo {
  id: ModelId;
  name: string;
  color: string;
  blurb: string;
}

export const MODELS: Record<ModelId, ModelInfo> = {
  xgboost: {
    id: 'xgboost',
    name: 'XGBoost',
    color: 'var(--m-xgboost)',
    blurb:
      'Gradient-boosted decision trees. Learns how sales change from the same month a year earlier, using month of year and the change in each external factor.',
  },
  sarimax: {
    id: 'sarimax',
    name: 'SARIMAX',
    color: 'var(--m-sarimax)',
    blurb:
      'Seasonal ARIMA with regressors. Models how each month depends on recent months and on the same month last year, with the external factors as regressors.',
  },
  elasticnet: {
    id: 'elasticnet',
    name: 'Elastic Net',
    color: 'var(--m-elasticnet)',
    blurb:
      'Regularised linear regression on a trend, month of year and the external factors. The penalty shrinks weak effects towards zero.',
  },
  holtwinters: {
    id: 'holtwinters',
    name: 'Holt-Winters',
    color: 'var(--m-holtwinters)',
    blurb:
      'Exponential smoothing of level, trend and seasonality, using the sales history only.',
  },
};

export const HW_WITH_FACTORS = {
  name: 'Holt-Winters with external factors',
  blurb:
    'Fitted in two parts: a linear regression estimates the effect of the external factors, and Holt-Winters forecasts what the regression leaves over. The forecast is the two added together.',
};

/** Display name of a model for a run: Holt-Winters is named for what it really is. */
export function modelName(id: ModelId, hasFactors: boolean): string {
  return id === 'holtwinters' && hasFactors ? HW_WITH_FACTORS.name : MODELS[id].name;
}
export function modelBlurb(id: ModelId, hasFactors: boolean): string {
  return id === 'holtwinters' && hasFactors ? HW_WITH_FACTORS.blurb : MODELS[id].blurb;
}
