'use client';
import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMinor, type Currency } from '@/lib/finance/money';

export interface BalanceSeriesPoint {
  label: string;
  minimum: number | null;
  avalanche: number | null;
  snowball: number | null;
}

const SERIES = [
  { key: 'avalanche', name: 'Лавина', color: 'var(--series-1)' },
  { key: 'snowball', name: 'Снежный ком', color: 'var(--series-2)' },
  { key: 'minimum', name: 'Только минимальные', color: 'var(--series-3)' },
] as const;

const fmt = (v: number, c: Currency) => formatMinor(BigInt(Math.round(v * 100)), c);
const compact = (v: number) => new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

/** Remaining total debt by month under each strategy (values in major units, for drawing only). */
export function BalanceChart({ data, currency }: { data: BalanceSeriesPoint[]; currency: Currency }) {
  const [table, setTable] = useState(false);
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs text-text-secondary underline">{table ? 'Показать график' : 'Показать таблицей'}</button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-text-muted"><th className="py-1 pr-3">Месяц</th>{SERIES.map((s) => <th key={s.key} className="py-1 pr-3">{s.name}</th>)}</tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="tabular border-t border-border">
                  <td className="py-1 pr-3">{d.label}</td>
                  {SERIES.map((s) => <td key={s.key} className="py-1 pr-3">{d[s.key] === null ? '—' : fmt(d[s.key]!, currency)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={`Остаток долга по месяцам для трёх стратегий, ${currency}`} style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--grid)' }} minTickGap={24} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={60} tickFormatter={compact} />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      {payload.map((p) => (
                        <p key={String(p.dataKey)} className="tabular flex items-center gap-2">
                          <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: p.color }} />
                          <span className="text-text-secondary">{p.name}:</span> {fmt(Number(p.value), currency)}
                        </p>
                      ))}
                    </div>
                  ) : null
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => <span style={{ color: 'var(--text-secondary)' }}>{v}</span>} />
              {SERIES.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
