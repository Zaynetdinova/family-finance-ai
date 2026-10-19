import 'server-only';
import type { AppContext } from '@/lib/db/queries';
import { loadTransactions } from '@/lib/db/queries';
import { toMinor, toMinorOrNull, txFromRow } from '@/lib/db/convert';
import { debtDirections, loadBalances } from '@/lib/report';
import { addMonths, endOfMonth, startOfMonth } from '@/lib/finance/dates';
import { summarize } from '@/lib/finance/summary';
import { divRound, type Currency, type Minor } from '@/lib/finance/money';
import { percentToPpm } from '@/lib/finance/debts';
import type { PlanDebt } from '@/lib/finance/payoff-plan';

export function planDebts(ctx: AppContext, currency: Currency): PlanDebt[] {
  return ctx.debts
    .filter((d) => d.status === 'active' && d.direction === 'owed_by_me' && d.currency === currency)
    .map((d) => ({
      id: d.id,
      name: d.name,
      currency: d.currency,
      balance: toMinor(d.current_balance),
      annualRatePpm: d.interest_rate === null ? null : percentToPpm(String(d.interest_rate)),
      minPayment: toMinorOrNull(d.min_payment),
      priority: d.priority,
      allowsPrepayment: d.allows_prepayment,
      prepaymentFeePpm: null,
      variableRate: d.rate_type === 'variable',
    }));
}

/**
 * Average monthly free cash flow in `currency` over up to 3 complete months:
 * income − expenses (interest included) − principal repaid. Only operations in that currency
 * are used, so no conversion is involved. null when there is no complete month with data.
 */
export async function averageFreeCashflow(ctx: AppContext, currency: Currency): Promise<{ value: Minor | null; months: number }> {
  const thisMonth = startOfMonth(ctx.today);
  const from = addMonths(thisMonth, -3);
  const dirs = debtDirections(ctx);
  const txs = (await loadTransactions(ctx, { from, to: endOfMonth(addMonths(thisMonth, -1)) })).map((r) => txFromRow(r, dirs));
  const values: Minor[] = [];
  for (let k = 1; k <= 3; k++) {
    const m = addMonths(thisMonth, -k);
    const s = summarize(txs, { range: { from: m, to: endOfMonth(m) }, view: { mode: 'original', currency }, asOf: ctx.today });
    if (s.hasData) values.push(s.income - s.expense - s.debtPrincipalPaid);
  }
  return { value: values.length ? divRound(values.reduce((a, b) => a + b, 0n), BigInt(values.length)) : null, months: values.length };
}

export async function liquidBalance(ctx: AppContext, currency: Currency): Promise<Minor> {
  const balances = await loadBalances(ctx);
  let sum = 0n;
  for (const b of balances.values()) if (b.currency === currency) sum += b.balance;
  return sum;
}
