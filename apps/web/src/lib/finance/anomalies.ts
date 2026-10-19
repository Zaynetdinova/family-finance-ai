import { type Minor, divRound } from './money';
import type { DateRange } from './dates';
import { type View, flowOf } from './ledger';
import type { LedgerTx } from './types';

export interface UnusualExpense {
  id: string;
  categoryId: string;
  amount: Minor;
  /** Median of earlier expenses in the same category. */
  median: Minor;
  occurredOn: string;
}

export function median(values: Minor[]): Minor {
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : divRound(s[mid - 1]! + s[mid]!, 2n);
}

/**
 * Expenses in `range` that are much larger than that category usually costs:
 * amount > factor × median of earlier expenses in the same category. Needs at least
 * `minHistory` earlier expenses in the category, otherwise nothing is flagged — short
 * histories do not support confident claims.
 */
export function detectUnusual(
  txs: LedgerTx[],
  opts: { range: DateRange; view: View; factor?: number; minHistory?: number },
): UnusualExpense[] {
  const factor = BigInt(opts.factor ?? 3);
  const minHistory = opts.minHistory ?? 5;
  const items = txs
    .filter((t) => t.type === 'expense' && t.categoryId)
    .map((t) => ({ tx: t, amount: flowOf(t, opts.view)?.expense }))
    .filter((x): x is { tx: LedgerTx; amount: Minor } => x.amount !== undefined && x.amount > 0n)
    .sort((a, b) => (a.tx.occurredOn < b.tx.occurredOn ? -1 : 1));

  const history = new Map<string, Minor[]>();
  const out: UnusualExpense[] = [];
  for (const { tx, amount } of items) {
    const cat = tx.categoryId!;
    const past = history.get(cat) ?? [];
    if (tx.occurredOn >= opts.range.from && tx.occurredOn <= opts.range.to && past.length >= minHistory) {
      const med = median(past);
      if (med > 0n && amount > factor * med) {
        out.push({ id: tx.id, categoryId: cat, amount, median: med, occurredOn: tx.occurredOn });
      }
    }
    past.push(amount);
    history.set(cat, past);
  }
  return out.sort((a, b) => (a.amount < b.amount ? 1 : -1));
}
