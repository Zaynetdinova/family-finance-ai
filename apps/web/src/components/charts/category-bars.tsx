import { type Currency, type Minor, formatMinor } from '@/lib/finance/money';
import { pct } from '@/lib/format';

export interface CategoryBarItem {
  id: string | null;
  name: string;
  amount: Minor;
  shareBp: number | null;
}

const SLOTS = 7; // the 8th colour is reserved for "Other"

/** Expense by category as horizontal bars. Colour follows the category's rank slot; labels carry identity. */
export function CategoryBars({ items, currency }: { items: CategoryBarItem[]; currency: Currency }) {
  const positive = items.filter((i) => i.amount > 0n);
  if (!positive.length) return <p className="text-sm text-text-muted">Расходов в этом периоде нет.</p>;
  const top = positive.slice(0, SLOTS);
  const rest = positive.slice(SLOTS);
  const rows = rest.length
    ? [...top, { id: 'other', name: `Другое (${rest.length})`, amount: rest.reduce((s, r) => s + r.amount, 0n), shareBp: rest.reduce((s, r) => s + (r.shareBp ?? 0), 0) }]
    : top;
  const max = rows.reduce((m, r) => (r.amount > m ? r.amount : m), 0n);

  return (
    <ul className="flex flex-col gap-3" aria-label="Расходы по категориям">
      {rows.map((r, i) => {
        const width = max > 0n ? Number((r.amount * 10000n) / max) / 100 : 0;
        const color = r.id === 'other' ? 'var(--series-other)' : `var(--series-${i + 1})`;
        return (
          <li key={r.id ?? 'none'} className="text-sm">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate">{r.name}</span>
              <span className="tabular shrink-0 text-text-secondary">
                {formatMinor(r.amount, currency)} <span className="text-text-muted">· {pct(r.shareBp)}</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-muted" aria-hidden>
              <div className="h-2 rounded-full" style={{ width: `${Math.max(width, 1)}%`, background: color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
