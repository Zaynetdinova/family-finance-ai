import { describe, expect, it } from 'vitest';
import { buildTransaction, type BuildEnv } from './build';
import { transactionInputSchema, type TransactionInput } from './schema';
import { parseRate } from '@/lib/finance/money';

const ids = { rub: '11111111-1111-4111-8111-111111111111', save: '22222222-2222-4222-8222-222222222222', usd: '33333333-3333-4333-8333-333333333333', debt: '44444444-4444-4444-8444-444444444444', cat: '55555555-5555-4555-8555-555555555555' };
const env: BuildEnv = {
  householdId: 'h', userId: 'u', baseCurrency: 'RUB',
  accounts: [{ id: ids.rub, currency: 'RUB' }, { id: ids.save, currency: 'RUB' }, { id: ids.usd, currency: 'USD' }],
  debts: [{ id: ids.debt, currency: 'RUB' }],
  rates: [{ base: 'USD', quote: 'RUB', rate: parseRate('90'), date: '2026-10-15', source: 'test' }],
};
const input = (p: Partial<TransactionInput>): TransactionInput =>
  transactionInputSchema.parse({ type: 'expense', amount: '100', accountId: ids.rub, occurredOn: '2026-10-16', ...p });

describe('buildTransaction', () => {
  it('takes the currency from the account and snapshots identity FX for the base currency', () => {
    const r = buildTransaction(input({ amount: '8500,50', categoryId: ids.cat }), env);
    expect(r.ok && r.row).toMatchObject({ amount: '8500.50', currency: 'RUB', base_currency: 'RUB', fx_rate: '1.0000000000', base_amount: '8500.50', category_id: ids.cat });
  });
  it('stores rate, rate date and base amount for foreign currency', () => {
    const r = buildTransaction(input({ type: 'income', amount: '2000', accountId: ids.usd }), env);
    expect(r.ok && r.row).toMatchObject({ currency: 'USD', fx_rate: '90.0000000000', fx_rate_date: '2026-10-15', base_amount: '180000.00', fx_rate_source: 'test' });
  });
  it('saves without a snapshot (with a warning) when no rate is available', () => {
    const r = buildTransaction(input({ accountId: ids.usd, occurredOn: '2026-01-01' }), env);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row).toMatchObject({ base_currency: null, fx_rate: null, base_amount: null });
      expect(r.warnings).toHaveLength(1);
    }
  });
  it('keeps the stored snapshot when only the comment changes, re-snapshots when the amount changes', () => {
    const fx = { baseCurrency: 'RUB' as const, rate: parseRate('80'), rateDate: '2026-10-01', source: 'old', baseAmount: 800_000n };
    const existing = { amount: 10_000n, currency: 'USD' as const, occurredOn: '2026-10-16', fx };
    const same = buildTransaction(input({ accountId: ids.usd, amount: '100', comment: 'x' }), { ...env, existing });
    expect(same.ok && same.row).toMatchObject({ fx_rate: '80.0000000000', fx_rate_source: 'old' });
    const changed = buildTransaction(input({ accountId: ids.usd, amount: '200' }), { ...env, existing });
    expect(changed.ok && changed.row).toMatchObject({ fx_rate: '90.0000000000' });
  });
  it('transfer: same currency needs no destination amount; cross-currency does; same account is rejected', () => {
    const ok = buildTransaction(input({ type: 'transfer', amount: '20000', transferAccountId: ids.save, categoryId: ids.cat }), env);
    expect(ok.ok && ok.row).toMatchObject({ type: 'transfer', transfer_amount: '20000.00', category_id: null });
    const need = buildTransaction(input({ type: 'transfer', amount: '9000', transferAccountId: ids.usd }), env);
    expect(need).toEqual({ ok: false, fieldErrors: { transferAmount: expect.any(String) } });
    const cross = buildTransaction(input({ type: 'transfer', amount: '9000', transferAccountId: ids.usd, transferAmount: '100' }), env);
    expect(cross.ok && cross.row).toMatchObject({ transfer_amount: '100.00' });
    expect(buildTransaction(input({ type: 'transfer', transferAccountId: ids.rub }), env).ok).toBe(false);
  });
  it('debt payment: principal is derived from the total, and the split must add up', () => {
    const r = buildTransaction(input({ type: 'debt_payment', amount: '10000', debtId: ids.debt, interest: '4000' }), env);
    expect(r.ok && r.row).toMatchObject({ principal_amount: '6000.00', interest_amount: '4000.00', fee_amount: '0.00', category_id: null, debt_id: ids.debt });
    expect(buildTransaction(input({ type: 'debt_payment', amount: '1000', debtId: ids.debt, interest: '4000' }), env).ok).toBe(false);
    expect(buildTransaction(input({ type: 'debt_payment', amount: '10000', debtId: ids.debt, principal: '5000', interest: '4000' }), env).ok).toBe(false);
    expect(buildTransaction(input({ type: 'debt_payment', amount: '10000', debtId: ids.debt, accountId: ids.usd }), env).ok).toBe(false);
  });
  it('rejects unknown accounts and zero amounts', () => {
    expect(buildTransaction(input({ accountId: '99999999-9999-4999-8999-999999999999' }), env).ok).toBe(false);
    expect(buildTransaction(input({ amount: '0' }), env).ok).toBe(false);
  });
});

describe('transactionInputSchema', () => {
  it('rejects bad amounts, dates and ids', () => {
    expect(transactionInputSchema.safeParse({ type: 'expense', amount: '1.234', accountId: ids.rub, occurredOn: '2026-10-16' }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ type: 'expense', amount: '-5', accountId: ids.rub, occurredOn: '2026-10-16' }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ type: 'expense', amount: '5', accountId: 'nope', occurredOn: '2026-10-16' }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ type: 'expense', amount: '5', accountId: ids.rub, occurredOn: '2026-02-31' }).success).toBe(false);
    expect(transactionInputSchema.safeParse({ type: 'hack', amount: '5', accountId: ids.rub, occurredOn: '2026-10-16' }).success).toBe(false);
  });
});
