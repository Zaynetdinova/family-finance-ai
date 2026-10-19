import { type Minor, parseAmount, parseRate } from '@/lib/finance/money';
import type { RateRow } from '@/lib/finance/fx';
import type { AccountRef, CategoryRef, LedgerTx } from '@/lib/finance/types';
import type { DebtSchedule } from '@/lib/finance/debts';
import type { AccountRow, CategoryRow, DebtRow, ExchangeRateRow, Numeric, TransactionRow } from './types';

/** numeric → minor units. Goes through a fixed-precision string, never through float math. */
export function toMinor(v: Numeric): Minor {
  return parseAmount(typeof v === 'number' ? v.toFixed(2) : v);
}

export function toMinorOrNull(v: Numeric | null | undefined): Minor | null {
  return v === null || v === undefined ? null : toMinor(v);
}

export function toRate(v: Numeric): bigint {
  return parseRate(typeof v === 'number' ? v.toFixed(10) : v);
}

export function txFromRow(r: TransactionRow, debtDirection?: Map<string, 'owed_by_me' | 'owed_to_me'>): LedgerTx {
  const hasFx = r.base_currency && r.fx_rate !== null && r.fx_rate_date && r.base_amount !== null;
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    amount: toMinor(r.amount),
    currency: r.currency,
    accountId: r.account_id,
    transferAccountId: r.transfer_account_id,
    transferAmount: toMinorOrNull(r.transfer_amount),
    categoryId: r.category_id,
    occurredOn: r.occurred_on,
    counterparty: r.counterparty,
    principal: toMinorOrNull(r.principal_amount),
    interest: toMinorOrNull(r.interest_amount),
    fee: toMinorOrNull(r.fee_amount),
    debtDirection: r.debt_id ? (debtDirection?.get(r.debt_id) ?? 'owed_by_me') : null,
    fx: hasFx
      ? {
          baseCurrency: r.base_currency!,
          rate: toRate(r.fx_rate!),
          rateDate: r.fx_rate_date!,
          baseAmount: toMinor(r.base_amount!),
        }
      : null,
  };
}

export const accountRef = (a: AccountRow): AccountRef => ({
  id: a.id,
  name: a.name,
  currency: a.currency,
  openingBalance: toMinor(a.opening_balance),
});

export const categoryRef = (c: CategoryRow): CategoryRef => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  parentId: c.parent_id,
  isFixed: c.is_fixed,
});

export const rateRow = (r: ExchangeRateRow): RateRow => ({
  base: r.base_currency,
  quote: r.quote_currency,
  rate: toRate(r.rate),
  date: r.rate_date,
  source: r.source,
});

export const debtSchedule = (d: DebtRow): DebtSchedule => ({
  id: d.id,
  name: d.name,
  currency: d.currency,
  direction: d.direction,
  status: d.status,
  minPayment: toMinorOrNull(d.min_payment),
  paymentDay: d.payment_day,
  dueDate: d.due_date,
});
