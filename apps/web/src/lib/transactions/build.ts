import { amountToString, parseAmount, rateToString as rateString, type Currency } from '@/lib/finance/money';
import { snapshotFx, type FxSnapshot, type RateRow } from '@/lib/finance/fx';
import type { TransactionInput } from './schema';

export interface BuildEnv {
  householdId: string;
  userId: string;
  baseCurrency: Currency;
  accounts: { id: string; currency: Currency }[];
  debts: { id: string; currency: Currency }[];
  rates: RateRow[];
  /** When editing: keep the stored snapshot unless amount, currency or date changed. */
  existing?: { amount: bigint; currency: Currency; occurredOn: string; fx: FxSnapshot | null };
}

export type BuildResult =
  | { ok: true; row: Record<string, unknown>; warnings: string[] }
  | { ok: false; fieldErrors: Record<string, string> };

const A = (v: bigint | null) => (v === null ? null : amountToString(v));

/**
 * Turns validated form input into a `transactions` row. Money rules live here and in the
 * database constraints, never in the browser: currency comes from the account (not from
 * the client), the FX snapshot comes from stored rates, a debt payment is split exactly.
 */
export function buildTransaction(input: TransactionInput, env: BuildEnv): BuildResult {
  const errors: Record<string, string> = {};
  const account = env.accounts.find((a) => a.id === input.accountId);
  if (!account) return { ok: false, fieldErrors: { accountId: 'Счёт не найден' } };

  const amount = parseAmount(input.amount);
  if (amount <= 0n) errors.amount = 'Сумма должна быть больше нуля';

  let transferAccountId: string | null = null;
  let transferAmount: bigint | null = null;
  let debtId: string | null = null;
  let principal: bigint | null = null;
  let interest: bigint | null = null;
  let fee: bigint | null = null;

  if (input.type === 'transfer') {
    const dest = env.accounts.find((a) => a.id === input.transferAccountId);
    if (!dest) errors.transferAccountId = 'Выберите счёт зачисления';
    else if (dest.id === account.id) errors.transferAccountId = 'Счета списания и зачисления совпадают';
    else {
      transferAccountId = dest.id;
      if (dest.currency === account.currency) transferAmount = amount;
      else if (!input.transferAmount) errors.transferAmount = `Укажите, сколько ${dest.currency} поступило на счёт`;
      else {
        transferAmount = parseAmount(input.transferAmount);
        if (transferAmount <= 0n) errors.transferAmount = 'Сумма должна быть больше нуля';
      }
    }
  }

  if (input.type === 'debt_payment') {
    const debt = env.debts.find((d) => d.id === input.debtId);
    if (!debt) errors.debtId = 'Выберите долг';
    else if (debt.currency !== account.currency) errors.accountId = `Долг в ${debt.currency}: выберите счёт в той же валюте`;
    else {
      debtId = debt.id;
      interest = input.interest ? parseAmount(input.interest) : 0n;
      fee = input.fee ? parseAmount(input.fee) : 0n;
      principal = input.principal ? parseAmount(input.principal) : amount - interest - fee;
      if (principal < 0n) errors.interest = 'Проценты и комиссии больше суммы платежа';
      else if (principal + interest + fee !== amount) errors.principal = 'Основной долг + проценты + комиссии должны равняться сумме платежа';
    }
  }

  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };

  // FX snapshot
  const warnings: string[] = [];
  let fx: FxSnapshot | null = null;
  const unchanged =
    env.existing && env.existing.amount === amount && env.existing.currency === account.currency && env.existing.occurredOn === input.occurredOn;
  if (unchanged && env.existing!.fx) fx = env.existing!.fx;
  else {
    fx = snapshotFx(amount, account.currency, env.baseCurrency, env.rates, input.occurredOn);
    if (!fx) {
      warnings.push(`Нет курса ${account.currency}→${env.baseCurrency} на ${input.occurredOn}. Операция сохранена в исходной валюте и не войдёт в суммы в ${env.baseCurrency}, пока курс не появится.`);
    }
  }

  const noCategory = input.type === 'transfer' || input.type === 'debt_payment';
  return {
    ok: true,
    warnings,
    row: {
      household_id: env.householdId,
      type: input.type,
      status: input.status,
      amount: A(amount),
      currency: account.currency,
      account_id: account.id,
      transfer_account_id: transferAccountId,
      transfer_amount: A(transferAmount),
      category_id: noCategory ? null : (input.categoryId ?? null),
      occurred_on: input.occurredOn,
      counterparty: input.counterparty ?? null,
      comment: input.comment ?? null,
      base_currency: fx ? fx.baseCurrency : null,
      fx_rate: fx ? rateString(fx.rate) : null,
      fx_rate_date: fx ? fx.rateDate : null,
      fx_rate_source: fx ? fx.source : null,
      base_amount: fx ? amountToString(fx.baseAmount) : null,
      debt_id: debtId,
      principal_amount: A(principal),
      interest_amount: A(interest),
      fee_amount: A(fee),
    },
  };
}

