import { type Currency, type Minor, convertMinor } from './money';
import type { LedgerTx } from './types';

/**
 * How one transaction affects the *reports* (not account balances).
 * The core accounting rules live here:
 *  - transfer between own accounts: no income, no expense
 *  - debt_payment on a debt I owe: only interest + fees are expense; principal reduces the debt
 *  - debt_payment on a debt owed to me: principal is not income; interest + fees received are income
 *  - refund: reduces expenses (net spend), it is not income
 */
export interface Flow {
  income: Minor;
  /** May be negative for refunds. */
  expense: Minor;
  /** Principal repaid (positive); never counted as expense or income. */
  debtPrincipal: Minor;
  /** Interest and fees paid on debts (already included in `expense`). */
  interestAndFees: Minor;
}

export type View =
  | { mode: 'base'; currency: Currency }      // everything converted to the reporting currency
  | { mode: 'original'; currency: Currency }; // only transactions that were made in this currency

export const ZERO_FLOW: Flow = { income: 0n, expense: 0n, debtPrincipal: 0n, interestAndFees: 0n };

/** Amount of `part` in the view currency, or null when it cannot be converted without a rate. */
function toView(tx: LedgerTx, view: View): ((part: Minor) => Minor) | null {
  if (tx.currency === view.currency) return (p) => p;
  if (view.mode === 'original') return null;
  if (!tx.fx || tx.fx.baseCurrency !== view.currency) return null;
  const rate = tx.fx.rate;
  return (p) => convertMinor(p, rate);
}

/** Returns null when the transaction doesn't belong in this view or lacks an FX snapshot. */
export function flowOf(tx: LedgerTx, view: View): Flow | null {
  if (tx.status !== 'confirmed') return null;
  const conv = toView(tx, view);
  if (!conv) return null;

  // For foreign-currency amounts the stored base_amount is authoritative for the whole;
  // parts are converted separately and the principal absorbs the rounding remainder.
  const whole = tx.currency === view.currency ? tx.amount : tx.fx!.baseAmount;

  switch (tx.type) {
    case 'income':
      return { ...ZERO_FLOW, income: whole };
    case 'expense':
      return { ...ZERO_FLOW, expense: whole };
    case 'refund':
      return { ...ZERO_FLOW, expense: -whole };
    case 'transfer':
      return { ...ZERO_FLOW };
    case 'debt_payment': {
      const interest = conv(tx.interest ?? 0n);
      const fee = conv(tx.fee ?? 0n);
      const principal = whole - interest - fee;
      if (principal < 0n) return null; // inconsistent data; DB constraint should prevent it
      const charges = interest + fee;
      return tx.debtDirection === 'owed_to_me'
        ? { income: charges, expense: 0n, debtPrincipal: principal, interestAndFees: 0n }
        : { income: 0n, expense: charges, debtPrincipal: principal, interestAndFees: charges };
    }
  }
}

/**
 * Change of one account's balance caused by a transaction, in the account's own currency.
 * Unlike reports, transfers and the full debt payment (principal included) do move money.
 */
export function accountDelta(tx: LedgerTx, accountId: string): Minor {
  if (tx.status !== 'confirmed') return 0n;
  switch (tx.type) {
    case 'income':
    case 'refund':
      return tx.accountId === accountId ? tx.amount : 0n;
    case 'expense':
      return tx.accountId === accountId ? -tx.amount : 0n;
    case 'debt_payment':
      if (tx.accountId !== accountId) return 0n;
      return tx.debtDirection === 'owed_to_me' ? tx.amount : -tx.amount;
    case 'transfer': {
      let d = 0n;
      if (tx.accountId === accountId) d -= tx.amount;
      if (tx.transferAccountId === accountId) d += tx.transferAmount ?? tx.amount;
      return d;
    }
  }
}

export function accountBalances(
  accounts: { id: string; currency: Currency; openingBalance?: Minor }[],
  txs: LedgerTx[],
): Map<string, { currency: Currency; balance: Minor }> {
  const out = new Map<string, { currency: Currency; balance: Minor }>();
  for (const a of accounts) {
    let bal = a.openingBalance ?? 0n;
    for (const tx of txs) bal += accountDelta(tx, a.id);
    out.set(a.id, { currency: a.currency, balance: bal });
  }
  return out;
}

/** Balances grouped by currency — never summed across currencies. */
export function balancesByCurrency(balances: Map<string, { currency: Currency; balance: Minor }>): Map<Currency, Minor> {
  const out = new Map<Currency, Minor>();
  for (const { currency, balance } of balances.values()) out.set(currency, (out.get(currency) ?? 0n) + balance);
  return out;
}
