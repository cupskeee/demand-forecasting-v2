const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mar 2024" from a month number (year * 12 + month, January = 0). */
export function monthLabel(month: number): string {
  return `${MONTHS[((month % 12) + 12) % 12]} ${Math.floor(month / 12)}`;
}
export function monthShort(month: number): string {
  return MONTHS[((month % 12) + 12) % 12];
}

/** A number with a sensible amount of precision for its size. */
export function num(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  const d = digits ?? (abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3);
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function signed(value: number, digits?: number): string {
  const text = num(Math.abs(value), digits);
  if (text === '0') return '0';
  return (value < 0 ? '−' : '+') + text;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(digits)}%`;
}

/** Sizes in decimal units (1 MB = 1,000,000 bytes), the same as the engine manifest script. */
export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(0)} kB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e9).toFixed(2)} GB`;
}

export function seconds(s: number): string {
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

export function when(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Turns "retail_price_idr" into "retail price idr" for display. */
export function humanise(column: string): string {
  return column.replace(/[_\-]+/g, ' ').trim();
}
