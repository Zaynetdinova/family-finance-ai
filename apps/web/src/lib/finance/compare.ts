import { type Minor, ratioBp } from './money';
import { daysInRange } from './dates';
import type { PeriodSummary } from './summary';

export interface Delta {
  current: Minor;
  previous: Minor;
  diff: Minor;
  /** Change in basis points of the previous value; null when previous is 0 (undefined %). */
  changeBp: number | null;
}

export type Comparison =
  | {
      comparable: true;
      income: Delta;
      expense: Delta;
      net: Delta;
      categories: ({ categoryId: string | null } & Delta & { isNew: boolean; disappeared: boolean })[];
      /** Either period is still in progress: the comparison is preliminary. */
      provisional: boolean;
    }
  | { comparable: false; reason: 'no_previous_data' | 'no_current_data' | 'different_length' | 'different_currency' };

function delta(current: Minor, previous: Minor): Delta {
  const diff = current - previous;
  return { current, previous, diff, changeBp: previous === 0n ? null : ratioBp(diff, previous < 0n ? -previous : previous) };
}

/**
 * Compare two period summaries. Refuses (comparable: false) rather than producing a
 * misleading number: missing history, different lengths or different currency views.
 */
export function comparePeriods(current: PeriodSummary, previous: PeriodSummary): Comparison {
  if (current.view.currency !== previous.view.currency || current.view.mode !== previous.view.mode) {
    return { comparable: false, reason: 'different_currency' };
  }
  if (!current.hasData) return { comparable: false, reason: 'no_current_data' };
  if (!previous.hasData) return { comparable: false, reason: 'no_previous_data' };

  // A finished full month may be compared with any other full calendar month; otherwise lengths must match
  // (use previousComparableRange to build the previous range).
  // For a period in progress only the elapsed days carry data, so that is its effective length.
  const lenCur = current.provisional ? current.elapsedDays : daysInRange(current.range.from, current.range.to);
  const lenPrev = previous.provisional ? previous.elapsedDays : daysInRange(previous.range.from, previous.range.to);
  const bothMonths = !current.provisional && !previous.provisional && isFullMonth(current) && isFullMonth(previous);
  if (lenCur !== lenPrev && !bothMonths) return { comparable: false, reason: 'different_length' };

  const ids = new Set([...current.byCategory, ...previous.byCategory].map((c) => c.categoryId));
  const get = (s: PeriodSummary, id: string | null) => s.byCategory.find((c) => c.categoryId === id)?.expense ?? 0n;
  const categories = [...ids]
    .map((id) => {
      const cur = get(current, id);
      const prev = get(previous, id);
      return { categoryId: id, ...delta(cur, prev), isNew: prev === 0n && cur !== 0n, disappeared: cur === 0n && prev !== 0n };
    })
    .sort((a, b) => (a.diff < b.diff ? 1 : a.diff > b.diff ? -1 : 0));

  return {
    comparable: true,
    income: delta(current.income, previous.income),
    expense: delta(current.expense, previous.expense),
    net: delta(current.net, previous.net),
    categories,
    provisional: current.provisional || previous.provisional,
  };
}

function isFullMonth(s: PeriodSummary): boolean {
  const { from, to } = s.range;
  const d = new Date(`${to}T00:00:00Z`);
  const next = new Date(d.getTime() + 86_400_000);
  return from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7) && next.getUTCDate() === 1;
}
