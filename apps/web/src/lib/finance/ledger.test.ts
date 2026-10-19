import { describe, expect, it } from 'vitest';
import { accountBalances, balancesByCurrency, flowOf } from './ledger';
import { accounts, rub, tx } from './fixtures';
import { parseRate } from './money';

const base = { mode: 'base', currency: 'RUB' } as const;

describe('ledger rules', () => {
  it('5. a transfer between own accounts is neither income nor expense', () => {
    const t = tx({ type: 'transfer', amount: rub('20000'), accountId: 'acc-save', transferAccountId: 'acc-card', transferAmount: rub('20000') });
    expect(flowOf(t, base)).toEqual({ income: 0n, expense: 0n, debtPrincipal: 0n, interestAndFees: 0n });
    const bal = accountBalances(accounts, [t]);
    expect(bal.get('acc-save')!.balance).toBe(rub('280000'));
    expect(bal.get('acc-card')!.balance).toBe(rub('70000'));
    // total RUB wealth unchanged
    expect(balancesByCurrency(bal).get('RUB')).toBe(rub('350000'));
  });

  it('cross-currency transfer credits the stated amount, not the debited one', () => {
    const t = tx({ type: 'transfer', amount: rub('9000'), accountId: 'acc-card', transferAccountId: 'acc-usd', transferAmount: rub('100') });
    const bal = accountBalances(accounts, [t]);
    expect(bal.get('acc-card')!.balance).toBe(rub('41000'));
    expect(bal.get('acc-usd')!.balance).toBe(rub('100'));
  });

  it('6. a refund reduces net expenses and is not income', () => {
    const f = flowOf(tx({ type: 'refund', amount: rub('1500') }), base)!;
    expect(f.income).toBe(0n);
    expect(f.expense).toBe(-rub('1500'));
    expect(accountBalances(accounts, [tx({ type: 'refund', amount: rub('1500') })]).get('acc-card')!.balance).toBe(rub('51500'));
  });

  it('7. loan payment: only interest is an expense; the full amount leaves the account', () => {
    const t = tx({ type: 'debt_payment', amount: rub('10000'), principal: rub('6000'), interest: rub('4000'), fee: 0n, categoryId: 'c-debt' });
    expect(flowOf(t, base)).toEqual({ income: 0n, expense: rub('4000'), debtPrincipal: rub('6000'), interestAndFees: rub('4000') });
    expect(accountBalances(accounts, [t]).get('acc-card')!.balance).toBe(rub('40000'));
  });

  it('payment received on a debt owed to me: principal is not income, interest is', () => {
    const t = tx({ type: 'debt_payment', amount: rub('10000'), principal: rub('9000'), interest: rub('1000'), fee: 0n, debtDirection: 'owed_to_me' });
    expect(flowOf(t, base)).toEqual({ income: rub('1000'), expense: 0n, debtPrincipal: rub('9000'), interestAndFees: 0n });
    expect(accountBalances(accounts, [t]).get('acc-card')!.balance).toBe(rub('60000'));
  });

  it('debt payment in foreign currency: parts sum to the stored base amount (no rounding leak)', () => {
    const fx = { baseCurrency: 'RUB' as const, rate: parseRate('91.3333333333'), rateDate: '2026-09-10', baseAmount: 91_333_33n };
    const t = tx({ type: 'debt_payment', currency: 'USD', accountId: 'acc-usd', amount: rub('1000'), principal: rub('333.33'), interest: rub('666.67'), fee: 0n, fx });
    const f = flowOf(t, base)!;
    expect(f.debtPrincipal + f.interestAndFees).toBe(91_333_33n);
  });

  it('ignores cancelled/draft transactions everywhere', () => {
    const t = tx({ type: 'expense', amount: rub('999'), status: 'cancelled' });
    expect(flowOf(t, base)).toBeNull();
    expect(accountBalances(accounts, [t]).get('acc-card')!.balance).toBe(rub('50000'));
  });

  it('foreign-currency transaction without FX snapshot cannot enter base totals', () => {
    expect(flowOf(tx({ type: 'expense', currency: 'USD', accountId: 'acc-usd', amount: rub('10') }), base)).toBeNull();
    // ...but is visible in its own currency
    expect(flowOf(tx({ type: 'expense', currency: 'USD', accountId: 'acc-usd', amount: rub('10') }), { mode: 'original', currency: 'USD' })!.expense).toBe(rub('10'));
  });
});
