import { type Minor, ratioBp, divRound } from './money';
import { type DateRange, type IsoDate, daysInRange, diffDays, endOfMonth, startOfMonth } from './dates';
import { type View, flowOf } from './ledger';
import type { CategoryRef, LedgerTx } from './types';

export interface CategoryTotal {
  categoryId: string | null;
  /** Net of refunds. */
  expense: Minor;
  /** Share of total expense in basis points; null when total expense is zero. */
  shareBp: number | null;
}

export interface PeriodSummary {
  range: DateRange;
  view: View;
  /** True if at least one confirmed transaction exists in the range, even if it nets to zero.
   *  Distinguishes "spent 0" from "no data". */
  hasData: boolean;
  txCount: number;
  income: Minor;
  expense: Minor;
  net: Minor;
  /** (income - expense) / income in basis points; null when there is no income. */
  savingsRateBp: number | null;
  debtPrincipalPaid: Minor;
  interestAndFeesPaid: Minor;
  byCategory: CategoryTotal[];
  fixedExpense: Minor;
  variableExpense: Minor;
  /** Days that have elapsed (or the full length for a finished period). */
  elapsedDays: number;
  avgDailyExpense: Minor | null;
  largestExpenses: { id: string; amount: Minor; categoryId: string | null; occurredOn: IsoDate; counterparty: string | null }[];
  /** Foreign-currency transactions without an FX snapshot; excluded from every total above. */
  unconverted: { count: number; ids: string[] };
  /** The period has not ended yet: all figures are preliminary. */
  provisional: boolean;
}

export interface SummarizeOptions {
  range: DateRange;
  view: View;
  /** Today in the user's time zone. Drives `provisional` and the daily average. */
  asOf: IsoDate;
  categories?: CategoryRef[];
  topN?: number;
}

export function summarize(txs: LedgerTx[], opts: SummarizeOptions): PeriodSummary {
  const { range, view, asOf } = opts;
  const fixedIds = new Set((opts.categories ?? []).filter((c) => c.isFixed).map((c) => c.id));
  // sub-categories inherit fixed-ness from their parent
  for (const c of opts.categories ?? []) {
    if (c.parentId && fixedIds.has(c.parentId)) fixedIds.add(c.id);
  }

  let income = 0n, expense = 0n, principal = 0n, charges = 0n, fixed = 0n, count = 0;
  const cat = new Map<string | null, Minor>();
  const unconverted: string[] = [];
  const expenseTxs: { tx: LedgerTx; amount: Minor }[] = [];

  for (const tx of txs) {
    if (tx.status !== 'confirmed' || tx.occurredOn < range.from || tx.occurredOn > range.to) continue;
    const flow = flowOf(tx, view);
    if (!flow) {
      // Only report as unconverted when it is a conversion problem, not simply another currency in 'original' view
      if (view.mode === 'base') unconverted.push(tx.id);
      continue;
    }
    count++;
    income += flow.income;
    expense += flow.expense;
    principal += flow.debtPrincipal;
    charges += flow.interestAndFees;
    if (flow.expense !== 0n) {
      const key = tx.categoryId ?? null;
      cat.set(key, (cat.get(key) ?? 0n) + flow.expense);
      if (key && fixedIds.has(key)) fixed += flow.expense;
      if (tx.type === 'expense') expenseTxs.push({ tx, amount: flow.expense });
    }
  }

  const finished = asOf > range.to;
  const effectiveEnd = asOf < range.to ? (asOf < range.from ? range.from : asOf) : range.to;
  const elapsedDays = asOf < range.from ? 0 : daysInRange(range.from, effectiveEnd);

  const byCategory: CategoryTotal[] = [...cat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, expense: amount, shareBp: ratioBp(amount, expense) }))
    .sort((a, b) => (a.expense < b.expense ? 1 : a.expense > b.expense ? -1 : 0));

  const largest = expenseTxs
    .sort((a, b) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0))
    .slice(0, opts.topN ?? 10)
    .map(({ tx, amount }) => ({
      id: tx.id,
      amount,
      categoryId: tx.categoryId ?? null,
      occurredOn: tx.occurredOn,
      counterparty: tx.counterparty ?? null,
    }));

  return {
    range,
    view,
    hasData: count > 0,
    txCount: count,
    income,
    expense,
    net: income - expense,
    savingsRateBp: income > 0n ? ratioBp(income - expense, income) : null,
    debtPrincipalPaid: principal,
    interestAndFeesPaid: charges,
    byCategory,
    fixedExpense: fixed,
    variableExpense: expense - fixed,
    elapsedDays,
    avgDailyExpense: elapsedDays > 0 && count > 0 ? divRound(expense, BigInt(elapsedDays)) : null,
    largestExpenses: largest,
    unconverted: { count: unconverted.length, ids: unconverted },
    provisional: !finished,
  };
}

export interface MonthForecast {
  /** Expense so far plus the average daily expense for the remaining days. */
  projectedExpense: Minor;
  remainingDays: number;
  basedOnDays: number;
}

/**
 * Naive run-rate forecast of month-end expenses. Returns null when the history is too short
 * to say anything (default < 7 elapsed days) or the month is over.
 */
export function forecastMonthEnd(summary: PeriodSummary, minDays = 7): MonthForecast | null {
  const { range } = summary;
  if (!summary.provisional || !summary.hasData || summary.avgDailyExpense === null) return null;
  if (summary.elapsedDays < minDays) return null;
  const monthEnd = endOfMonth(startOfMonth(range.from));
  const end = range.to < monthEnd ? range.to : monthEnd;
  const remaining = Math.max(0, diffDays(range.from, end) + 1 - summary.elapsedDays);
  return {
    projectedExpense: summary.expense + summary.avgDailyExpense * BigInt(remaining),
    remainingDays: remaining,
    basedOnDays: summary.elapsedDays,
  };
}
