'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Currency } from '@/lib/finance/money';
import { formatMinor } from '@/lib/finance/money';

export interface IncomeExpensePoint {
  label: string;
  income: number; // major units, for drawing only
  expense: number;
}

const fmt = (v: number, c: Currency) => formatMinor(BigInt(Math.round(v * 100)), c);
const compact = (v: number) => new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

export function IncomeExpenseChart({ data, currency, height = 260 }: { data: IncomeExpensePoint[]; currency: Currency; height?: number }) {
  const [table, setTable] = useState(false);
  const empty = data.every((d) => d.income === 0 && d.expense === 0);

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs text-text-secondary underline">
          {table ? 'Показать график' : 'Показать таблицей'}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-text-muted"><th className="py-1 pr-3">Период</th><th className="py-1 pr-3">Доходы</th><th className="py-1">Расходы</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-t border-border tabular">
                  <td className="py-1 pr-3">{d.label}</td><td className="py-1 pr-3">{fmt(d.income, currency)}</td><td className="py-1">{fmt(d.expense, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={`Доходы и расходы по периодам, ${currency}${empty ? ': операций нет' : ''}`} style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" minTickGap={12} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} width={44} tickFormatter={compact} />
              <Tooltip
                cursor={{ fill: 'var(--surface-muted)' }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
                      <p className="mb-1 font-medium">{label}</p>
                      {payload.map((p) => (
                        <p key={String(p.dataKey)} className="tabular flex items-center gap-2">
                          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
                          <span className="text-text-secondary">{p.name}:</span> {fmt(Number(p.value), currency)}
                        </p>
                      ))}
                    </div>
                  ) : null
                }
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} iconType="square" />
              <Bar dataKey="income" name="Доходы" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="expense" name="Расходы" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
