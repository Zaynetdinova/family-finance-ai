import { describe, expect, it } from 'vitest';
import { debtInputSchema } from './schema';

const ok = { name: 'Ипотека', direction: 'owed_by_me', kind: 'mortgage', currency: 'RUB', originalAmount: '5000000', currentBalance: '4800000,50', interestRate: '9,5', paymentDay: '15' };

describe('debtInputSchema', () => {
  it('accepts a valid debt and coerces the payment day', () => {
    const r = debtInputSchema.safeParse(ok);
    expect(r.success && r.data.paymentDay).toBe(15);
  });
  it('rejects balance above the original amount, bad days and reversed dates', () => {
    expect(debtInputSchema.safeParse({ ...ok, currentBalance: '5000001' }).success).toBe(false);
    expect(debtInputSchema.safeParse({ ...ok, paymentDay: '32' }).success).toBe(false);
    expect(debtInputSchema.safeParse({ ...ok, openedOn: '2026-05-01', dueDate: '2026-04-01' }).success).toBe(false);
    expect(debtInputSchema.safeParse({ ...ok, interestRate: '-3' }).success).toBe(false);
    expect(debtInputSchema.safeParse({ ...ok, currency: 'EUR' }).success).toBe(false);
  });
});
