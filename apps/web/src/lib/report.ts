import 'server-only';
import { addDays } from '@/lib/finance/dates';
import { previousComparableRange } from '@/lib/finance/dates';
import { resolvePeriod, type ResolvedPeriod } from '@/lib/finance/period';
import { summarize, forecastMonthEnd, type PeriodSummary } from '@/lib/finance/summary';
import { comparePeriods } from '@/lib/finance/compare';
import { detectUnusual } from '@/lib/finance/anomalies';
import { accountBalances } from '@/lib/finance/ledger';
import { isCurrency, type Currency } from '@/lib/finance/money';
import type { View } from '@/lib/finance/ledger';
import type { LedgerTx } from '@/lib/finance/types';
import { accountRef, categoryRef, txFromRow } from '@/lib/db/convert';
import { loadTransactions, type AppContext } from '@/lib/db/queries';
import type { DebtPaymentRow } from '@/lib/db/types';

export type SearchParams = Record<string, string | string[] | undefined>;
export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function debtDirections(ctx: AppContext) {
  return new Map(ctx.debts.map((d) => [d.id, d.direction] as const));
}

export function parseView(cur: string | undefined, base: Currency): View {
  return cur && isCurrency(cur) ? { mode: 'original', currency: cur } : { mode: 'base', currency: base };
}

export function categoryNamer(ctx: AppContext) {
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  return (id: string | null): string => {
    if (!id) return 'Без категории';
    const c = byId.get(id);
    if (!c) return 'Без категории';
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };
}

export async function loadReport(ctx: AppContext, sp: SearchParams) {
  const period: ResolvedPeriod = resolvePeriod({ period: one(sp.period), from: one(sp.from), to: one(sp.to) }, ctx.today);
  const view = parseView(one(sp.cur), ctx.household.base_currency);
  const user = one(sp.user);
  const userId = user && ctx.members.some((m) => m.userId === user) ? user : null;
  const prevRange = previousComparableRange(period, ctx.today);

  // Previous period + 180 days of history for the "unusual expense" baseline.
  const since = [prevRange.from, addDays(period.from, -180)].sort()[0]!;
  const dirs = debtDirections(ctx);
  const txs: LedgerTx[] = (await loadTransactions(ctx, { from: since, to: period.to, userId })).map((r) => txFromRow(r, dirs));
  const categories = ctx.categories.map(categoryRef);

  const current: PeriodSummary = summarize(txs, { range: period, view, asOf: ctx.today, categories });
  const previous: PeriodSummary = summarize(txs, { range: prevRange, view, asOf: ctx.today, categories });
  return {
    period,
    view,
    userId,
    prevRange,
    txs,
    categories,
    current,
    previous,
    comparison: comparePeriods(current, previous),
    forecast: period.key === 'month' ? forecastMonthEnd(current) : null,
    unusual: detectUnusual(txs, { range: period, view }),
    categoryName: categoryNamer(ctx),
  };
}

/** Current balance of every account (all confirmed history, in the account's own currency). */
export async function loadBalances(ctx: AppContext) {
  const rows = await loadTransactions(ctx, { from: '1900-01-01', to: '2999-12-31' });
  const dirs = debtDirections(ctx);
  const txs = rows.map((r) => txFromRow(r, dirs));
  return accountBalances(ctx.accounts.filter((a) => !a.is_archived).map(accountRef), txs);
}

export async function loadDebtPayments(ctx: AppContext, since: string): Promise<DebtPaymentRow[]> {
  const ids = ctx.debts.map((d) => d.id);
  if (!ids.length) return [];
  const { data, error } = await ctx.supabase
    .from('debt_payments')
    .select('*')
    .in('debt_id', ids)
    .gte('paid_on', since)
    .order('paid_on', { ascending: false });
  if (error) throw new Error(`debt_payments: ${error.message}`);
  return (data ?? []) as DebtPaymentRow[];
}

import type { BudgetLimitRow, BudgetRow } from '@/lib/db/types';

/** Budget (and its category limits) for the calendar month containing `monthStart`. */
export async function loadBudget(ctx: AppContext, monthStart: string, currency: Currency) {
  const { data: b, error } = await ctx.supabase
    .from('budgets')
    .select('*')
    .eq('household_id', ctx.household.id)
    .eq('month', monthStart)
    .eq('currency', currency)
    .maybeSingle();
  if (error) throw new Error(`budgets: ${error.message}`);
  if (!b) return null;
  const { data: limits, error: e2 } = await ctx.supabase.from('budget_limits').select('*').eq('budget_id', (b as BudgetRow).id);
  if (e2) throw new Error(`budget_limits: ${e2.message}`);
  return { budget: b as BudgetRow, limits: (limits ?? []) as BudgetLimitRow[] };
}
