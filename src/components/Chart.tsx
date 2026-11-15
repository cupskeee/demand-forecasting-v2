import { useEffect, useRef, useState } from 'preact/hooks';
import { monthLabel, num } from '../lib/format';

export interface Line {
  id: string;
  label: string;
  color: string;
  /** One value per month position; null where the line has nothing. */
  points: (number | null)[];
  dash?: boolean;
  faint?: boolean;
  width?: number;
  /** Leave the line out of the hover box (used for helper segments). */
  silent?: boolean;
}
export interface Band {
  color: string;
  lower: (number | null)[];
  upper: (number | null)[];
  label: string;
}
export interface Zone {
  from: number;
  to: number;
  label: string;
  /** Used when the zone is too narrow for the full label. */
  short?: string;
}
interface Props {
  /** Month number of position 0. */
  firstMonth: number;
  /** Positions shown: [from, to). */
  from: number;
  to: number;
  lines: Line[];
  bands?: Band[];
  zones?: Zone[];
  /** Positions drawn as hollow points (filled-in months). */
  hollow?: { at: number; value: number }[];
  hollowLabel?: string;
  label: string;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) [min, max] = [min - 1, max + 1];
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.5; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

export function Chart({ firstMonth, from, to, lines, bands = [], zones = [], hollow = [], hollowLabel, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current!;
    const observer = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth - 2)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = width < 520 ? 250 : 340;
  const pad = { left: 52, right: 14, top: 22, bottom: 28 };
  const count = Math.max(2, to - from);
  const values: number[] = [];
  for (const line of lines) for (let i = from; i < to; i++) if (line.points[i] != null) values.push(line.points[i]!);
  for (const band of bands) {
    for (let i = from; i < to; i++) {
      if (band.lower[i] != null) values.push(band.lower[i]!);
      if (band.upper[i] != null) values.push(band.upper[i]!);
    }
  }
  const lo = Math.min(...values, Infinity);
  const hi = Math.max(...values, -Infinity);
  const ticks = niceTicks(Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 1);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (i: number) => pad.left + ((i - from) / (count - 1)) * (width - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * (height - pad.top - pad.bottom);

  const path = (points: (number | null)[]) => {
    let d = '';
    let pen = false;
    for (let i = from; i < to; i++) {
      const v = points[i];
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const area = (band: Band) => {
    const idx: number[] = [];
    for (let i = from; i < to; i++) if (band.lower[i] != null && band.upper[i] != null) idx.push(i);
    if (idx.length < 2) return '';
    return (
      idx.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(band.upper[i]!).toFixed(1)}`).join('') +
      idx.reverse().map((i) => `L${x(i).toFixed(1)},${y(band.lower[i]!).toFixed(1)}`).join('') +
      'Z'
    );
  };

  // Year labels on Januaries; for short spans, a label every few months.
  const every = count > 60 ? 12 : count > 30 ? 6 : 3;
  const xTicks: number[] = [];
  for (let i = from; i < to; i++) if ((firstMonth + i) % every === 0) xTicks.push(i);

  const onMove = (event: PointerEvent) => {
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const i = Math.round(from + ((px - pad.left) / (width - pad.left - pad.right)) * (count - 1));
    setHover(i >= from && i < to ? i : null);
  };
  const shown = hover === null ? [] : lines.filter((l) => !l.silent && l.points[hover] != null);
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) + 12, 8), width - 190);

  return (
    <div class="chart" ref={box}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        height={height}
        role="img"
        aria-label={label}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {zones.map((zone) => {
          const a = Math.max(zone.from, from);
          const b = Math.min(zone.to, to - 1);
          if (b <= a) return null;
          return (
            <g key={zone.label}>
              <rect class="zone" x={x(a)} y={pad.top} width={x(b) - x(a)} height={height - pad.top - pad.bottom} />
              <text class="zone-label" x={x(a) + 5} y={pad.top - 7}>
                {[zone.label, zone.short ?? ''].find((t) => t.length * 6 + 8 <= x(b) - x(a)) ?? ''}
              </text>
            </g>
          );
        })}
        {ticks.map((t) => (
          <g key={t}>
            <line class="grid" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
            <text x={pad.left - 8} y={y(t) + 4} text-anchor="end">
              {num(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <g key={i}>
            <line class="axis" x1={x(i)} x2={x(i)} y1={height - pad.bottom} y2={height - pad.bottom + 4} />
            <text x={x(i)} y={height - 8} text-anchor="middle">
              {every === 12 ? Math.floor((firstMonth + i) / 12) : monthLabel(firstMonth + i)}
            </text>
          </g>
        ))}
        <line class="axis" x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} />
        {bands.map((band) => (
          <path key={band.label} d={area(band)} fill={band.color} opacity="0.16" />
        ))}
        {lines.map((line) => (
          <path
            key={line.id}
            d={path(line.points)}
            fill="none"
            stroke={line.color}
            stroke-width={line.width ?? 2}
            stroke-dasharray={line.dash ? '5 4' : undefined}
            stroke-linejoin="round"
            stroke-linecap="round"
            opacity={line.faint ? 0.45 : 1}
          />
        ))}
        {hollow
          .filter((h) => h.at >= from && h.at < to)
          .map((h) => (
            <circle key={h.at} cx={x(h.at)} cy={y(h.value)} r="3.5" fill="#fff" stroke="var(--ink)" stroke-width="1.5" />
          ))}
        {hover !== null && (
          <g>
            <line class="axis" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} stroke-dasharray="3 3" />
            {shown.map((l) => (
              <circle key={l.id} cx={x(hover)} cy={y(l.points[hover]!)} r="3.5" fill={l.color} stroke="#fff" stroke-width="1.5" />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && shown.length > 0 && (
        <div class="tip" style={{ left: `${tipLeft}px` }}>
          <strong>{monthLabel(firstMonth + hover)}</strong>
          {shown.map((l) => (
            <div key={l.id}>
              <span>
                <i style={{ '--c': l.color }} />
                {l.label}
              </span>
              <span>{num(l.points[hover]!)}</span>
            </div>
          ))}
        </div>
      )}
      <div class="legend">
        {lines
          .filter((l) => !l.silent)
          .map((l) => (
            <span key={l.id}>
              <i class={l.dash ? 'dash' : ''} style={{ '--c': l.color }} />
              {l.label}
            </span>
          ))}
        {bands.map((b) => (
          <span key={b.label}>
            <i class="band" style={{ '--c': b.color }} />
            {b.label}
          </span>
        ))}
        {hollow.length > 0 && hollowLabel && (
          <span>
            <i class="pt" style={{ '--c': 'var(--ink)' }} />
            {hollowLabel}
          </span>
        )}
      </div>
    </div>
  );
}
