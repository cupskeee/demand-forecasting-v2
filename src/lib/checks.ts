// Turns an imported table plus the chosen columns into one clean monthly series,
// and reports anything wrong with it in plain words.
import { parseNumber } from './csv';
import { monthParser } from './dates';
import { monthLabel, plural } from './format';
import type { FutureRule, Mapping, Prepared } from './types';

export interface Issue {
  level: 'blocker' | 'warning' | 'info';
  title: string;
  detail: string;
}

export interface Analysis {
  issues: Issue[];
  blocked: boolean;
  prepared: Prepared | null;
  months: number;
  maxHorizon: number;
  futureMonths: number;
}

export interface ColumnProfile {
  name: string;
  dateShare: number;
  numberShare: number;
  distinct: number;
}

export const MIN_MONTHS = 12;

export function profileColumns(columns: string[], rows: string[][]): ColumnProfile[] {
  return columns.map((name, c) => {
    const values = rows.map((r) => r[c]).filter((v) => v !== '');
    const parse = monthParser(values);
    const dates = values.filter((v) => parse(v) !== null).length;
    const numbers = values.filter((v) => parseNumber(v) !== null).length;
    return {
      name,
      dateShare: values.length ? dates / values.length : 0,
      numberShare: values.length ? numbers / values.length : 0,
      distinct: new Set(values).size,
    };
  });
}

/** Proposes the date column, the sales column and the external factors. */
export function proposeMapping(columns: string[], rows: string[][]): Mapping {
  const profiles = profileColumns(columns, rows);
  const dateName = /date|month|period|time|bulan|tanggal|periode/i;
  const targetName = /sales|demand|volume|qty|quantity|units|sold|revenue|penjualan|jual/i;
  const dateLike = profiles.filter((p) => p.dateShare >= 0.8);
  const date =
    dateLike.find((p) => dateName.test(p.name)) ??
    dateLike.sort((a, b) => b.dateShare - a.dateShare || b.distinct - a.distinct)[0] ??
    profiles.find((p) => dateName.test(p.name));
  const numeric = profiles.filter((p) => p !== date && p.numberShare >= 0.8 && p.distinct > 1);
  const target = numeric.find((p) => targetName.test(p.name)) ?? numeric[0];
  return {
    date: date?.name ?? '',
    target: target?.name ?? '',
    factors: numeric.filter((p) => p !== target).map((p) => p.name),
  };
}

/** Fills gaps by drawing a straight line between the known values either side. */
function interpolate(values: (number | null)[]): number[] {
  const out = values.slice() as number[];
  const known = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (!known.length) return values.map(() => 0);
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) continue;
    const before = known.filter((k) => k < i).pop();
    const after = known.find((k) => k > i);
    if (before === undefined) out[i] = values[after!]!;
    else if (after === undefined) out[i] = values[before]!;
    else {
      const t = (i - before) / (after - before);
      out[i] = values[before]! + t * (values[after]! - values[before]!);
    }
  }
  return out;
}

/** Decides how to assume a factor's future: hold the last value, or repeat last year. */
function chooseRule(series: number[]): FutureRule {
  const n = series.length;
  if (n < 24) return 'last';
  let seasonal = 0;
  let last = 0;
  for (let t = n - 12; t < n; t++) {
    seasonal += Math.abs(series[t] - series[t - 12]);
    last += Math.abs(series[t] - series[n - 13]);
  }
  return seasonal < last ? 'seasonal' : 'last';
}

const examples = (items: string[]) =>
  items.slice(0, 3).join(', ') + (items.length > 3 ? ` and ${items.length - 3} more` : '');

export function analyse(columns: string[], rows: string[][], mapping: Mapping): Analysis {
  const issues: Issue[] = [];
  const fail = (title: string, detail: string): Analysis => {
    issues.push({ level: 'blocker', title, detail });
    return { issues, blocked: true, prepared: null, months: 0, maxHorizon: 0, futureMonths: 0 };
  };
  const dateCol = columns.indexOf(mapping.date);
  const targetCol = columns.indexOf(mapping.target);
  if (dateCol < 0 || targetCol < 0) {
    return fail(
      'Choose the columns first',
      'Pick which column holds the month and which holds sales. The checks run as soon as both are set.',
    );
  }
  if (dateCol === targetCol) {
    return fail('Date and sales are the same column', 'Choose a different column for one of them.');
  }

  // Dates
  const parse = monthParser(rows.map((r) => r[dateCol]));
  const unreadable: string[] = [];
  let undated = 0;
  let hasDayParts = false;
  const byMonth = new Map<number, string[][]>();
  rows.forEach((row, i) => {
    const raw = row[dateCol];
    if (raw === '') return void undated++;
    const month = parse(raw);
    if (month === null) return void unreadable.push(`"${raw}" (row ${i + 2})`);
    if (/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(raw)) hasDayParts = true;
    byMonth.set(month, [...(byMonth.get(month) ?? []), row]);
  });
  if (unreadable.length) {
    return fail(
      `${plural(unreadable.length, 'date')} could not be read as a month`,
      `For example ${examples(unreadable)}. Use one row per month, with dates like 2024-03, 03/2024 or Mar 2024.`,
    );
  }
  if (!byMonth.size) return fail('No dates found', `The column "${mapping.date}" is empty.`);
  const repeated = [...byMonth].filter(([, r]) => r.length > 1).map(([m]) => m).sort((a, b) => a - b);
  if (repeated.length) {
    const share = repeated.length / byMonth.size;
    return fail(
      `${plural(repeated.length, 'month')} appear${repeated.length === 1 ? 's' : ''} more than once`,
      `${examples(repeated.map(monthLabel))}. ` +
        (hasDayParts && share > 0.5
          ? 'The dates look daily or weekly, not monthly. Add the rows up to one total per month and import again.'
          : 'This usually means the file holds several products or regions. This app forecasts one sales series per dataset, so import a file with one row per month.'),
    );
  }
  if (undated) {
    issues.push({
      level: 'warning',
      title: `${plural(undated, 'row')} without a date ${undated === 1 ? 'was' : 'were'} ignored`,
      detail: 'Every row needs a month to be placed on the timeline.',
    });
  }

  // Sales history: from the first to the last month that has a sales number.
  const ordered = [...byMonth].map(([month, r]) => ({ month, row: r[0] })).sort((a, b) => a.month - b.month);
  const fileOrder = rows.filter((r) => r[dateCol] !== '').map((r) => parse(r[dateCol])!);
  const sorted = fileOrder.every((m, i) => i === 0 || fileOrder[i - 1] <= m);
  const withSales = ordered.filter((o) => parseNumber(o.row[targetCol]) !== null);
  if (!withSales.length) {
    return fail(
      'No sales numbers found',
      `The column "${mapping.target}" has no values that can be read as numbers. Choose another sales column.`,
    );
  }
  const first = withSales[0].month;
  const last = withSales[withSales.length - 1].month;
  const n = last - first + 1;
  const rowAt = new Map(ordered.map((o) => [o.month, o.row]));

  const rawY: (number | null)[] = [];
  const absent: number[] = [];
  const badSales: string[] = [];
  for (let m = first; m <= last; m++) {
    const row = rowAt.get(m);
    if (!row) {
      absent.push(m);
      rawY.push(null);
      continue;
    }
    const value = parseNumber(row[targetCol]);
    if (value === null) badSales.push(row[targetCol] === '' ? `${monthLabel(m)} (blank)` : `${monthLabel(m)} ("${row[targetCol]}")`);
    rawY.push(value);
  }
  const gaps = absent.length + badSales.length;
  if (n < MIN_MONTHS) {
    return fail(
      'Too little history to forecast',
      `There ${n === 1 ? 'is' : 'are'} ${plural(n, 'month')} of sales, from ${monthLabel(first)} to ${monthLabel(last)}. The models need at least ${MIN_MONTHS} months, and work much better with three years or more.`,
    );
  }
  if (gaps / n > 0.3) {
    return fail(
      'Too many months have no sales number',
      `${gaps} of the ${n} months between ${monthLabel(first)} and ${monthLabel(last)} are missing or unreadable. A forecast built on that many filled-in values would not mean much.`,
    );
  }
  if (absent.length) {
    issues.push({
      level: 'warning',
      title: `${plural(absent.length, 'month is', 'months are')} missing`,
      detail: `${examples(absent.map(monthLabel))}. Each one is filled with a straight line between the months either side, and marked on the chart.`,
    });
  }
  if (badSales.length) {
    issues.push({
      level: 'warning',
      title: `${plural(badSales.length, 'sales value is', 'sales values are')} not a number`,
      detail: `${examples(badSales)}. ${badSales.length === 1 ? 'It is' : 'They are'} filled the same way as a missing month.`,
    });
  }
  if (!sorted) {
    issues.push({
      level: 'info',
      title: 'Rows were not in date order',
      detail: 'They have been sorted by month. The stored file is unchanged.',
    });
  }

  // External factors
  const future = ordered.filter((o) => o.month > last);
  const futureLast = future.length ? future[future.length - 1].month : last;
  const factors: string[] = [];
  const columnsX: number[][] = [];
  const columnsFuture: (number | null)[][] = [];
  for (const name of mapping.factors) {
    const col = columns.indexOf(name);
    if (col < 0 || col === dateCol || col === targetCol) continue;
    const values: (number | null)[] = [];
    const bad: string[] = [];
    for (let m = first; m <= last; m++) {
      const row = rowAt.get(m);
      const value = row ? parseNumber(row[col]) : null;
      if (row && value === null && row[col] !== '') bad.push(`"${row[col]}"`);
      values.push(value);
    }
    const known = values.filter((v) => v !== null).length;
    if (!known) {
      issues.push({
        level: 'blocker',
        title: `"${name}" has no numbers`,
        detail: bad.length
          ? `Its values (${examples([...new Set(bad)])}) are text. External factors must be numeric: untick this column, or recode it as numbers such as 0 and 1.`
          : 'The column is empty for the months with sales. Untick it to continue.',
      });
      continue;
    }
    const holes = n - known - absent.length;
    if (holes > 0) {
      issues.push({
        level: 'warning',
        title: `"${name}" has ${plural(holes, 'blank or unreadable value')}`,
        detail:
          (bad.length ? `For example ${examples([...new Set(bad)])}. ` : '') +
          'They are filled from the nearest months with values.',
      });
    }
    factors.push(name);
    columnsX.push(interpolate(values));
    const ahead: (number | null)[] = [];
    for (let m = last + 1; m <= futureLast; m++) {
      const row = rowAt.get(m);
      ahead.push(row ? parseNumber(row[col]) : null);
    }
    columnsFuture.push(ahead);
  }

  const y = interpolate(rawY);
  if (n < 24) {
    issues.push({
      level: 'warning',
      title: 'Less than two years of history',
      detail: `With ${n} months the models cannot learn a yearly pattern, so they run without seasonality. Expect rougher forecasts.`,
    });
  } else if (n < 36) {
    issues.push({
      level: 'info',
      title: 'Less than three years of history',
      detail: `With ${n} months, SARIMAX runs without its seasonal part and XGBoost has few examples to learn from.`,
    });
  }
  if (new Set(y).size === 1) {
    issues.push({
      level: 'warning',
      title: 'Sales never change',
      detail: 'Every month has the same value, so there is nothing for the models to learn and the accuracy scores will be empty.',
    });
  }
  const nonNegative = y.every((v) => v >= 0);
  if (!nonNegative) {
    issues.push({
      level: 'info',
      title: 'Some sales values are negative',
      detail: 'Forecasts are allowed to go below zero for this dataset.',
    });
  }
  const futureMonths = futureLast - last;
  const givenAhead = factors.filter((_, f) => columnsFuture[f].some((v) => v !== null));
  if (futureMonths > 0 && givenAhead.length) {
    issues.push({
      level: 'info',
      title: `${plural(futureMonths, 'future month')} of planned factor values found`,
      detail: `Rows after ${monthLabel(last)} have no sales but give values for ${examples(givenAhead)}. The forecast uses them as its baseline.`,
    });
  }

  const blocked = issues.some((i) => i.level === 'blocker');
  const X = y.map((_, t) => columnsX.map((c) => c[t]));
  const fileFuture = Array.from({ length: futureMonths }, (_, j) => columnsFuture.map((c) => c[j]));
  const prepared: Prepared = {
    firstMonth: first,
    y,
    filled: rawY.map((v) => v === null),
    factors,
    X,
    fileFuture,
    futureRule: columnsX.map(chooseRule),
    nonNegative,
  };
  return {
    issues,
    blocked,
    prepared: blocked ? null : prepared,
    months: n,
    maxHorizon: Math.max(1, Math.min(24, Math.floor(n / 3))),
    futureMonths,
  };
}

/** Baseline future values of every factor: the file's where given, the rule elsewhere. */
export function futureValues(prepared: Prepared, horizon: number): number[][] {
  const n = prepared.y.length;
  const out: number[][] = Array.from({ length: horizon }, () => []);
  prepared.factors.forEach((_, f) => {
    const series = prepared.X.map((row) => row[f]);
    for (let j = 0; j < horizon; j++) {
      const given = prepared.fileFuture[j]?.[f];
      const value =
        given !== null && given !== undefined
          ? given
          : prepared.futureRule[f] === 'seasonal'
            ? series[n + j - 12]
            : series[n + j - 1];
      series.push(value);
      out[j][f] = value;
    }
  });
  return out;
}

/** Where each factor's future values come from, for display. */
export function futureSource(prepared: Prepared, horizon: number): string[] {
  return prepared.factors.map((_, f) => {
    let fromFile = 0;
    for (let j = 0; j < horizon; j++) {
      const v = prepared.fileFuture[j]?.[f];
      if (v !== null && v !== undefined) fromFile++;
    }
    const rule = prepared.futureRule[f] === 'seasonal' ? 'repeats the same month last year' : 'holds its last value';
    if (fromFile === horizon) return 'planned values from the file';
    if (fromFile > 0) return `planned values from the file for ${plural(fromFile, 'month')}, then ${rule}`;
    return rule;
  });
}
