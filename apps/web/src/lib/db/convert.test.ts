import { describe, expect, it } from 'vitest';
import { toMinor, toRate, txFromRow } from './convert';
import type { TransactionRow } from './types';

const row = (p: Partial<TransactionRow> = {}): TransactionRow => ({
  id: 't1', household_id: 'h', created_by: 'u', type: 'expense', status: 'confirmed', amount: 8500.1, currency: 'RUB',
  account_id: 'a', transfer_account_id: null, transfer_amount: null, category_id: null, occurred_on: '2026-10-01',
  counterparty: null, comment: null, base_currency: null, fx_rate: null, fx_rate_date: null, fx_rate_source: null,
  base_amount: null, debt_id: null, principal_amount: null, interest_amount: null, fee_amount: null, refund_of_id: null,
  source: 'web', raw_message: null, external_message_id: null, created_at: '2026-10-01T00:00:00Z', ...p,
});

describe('db conversion', () => {
  it('converts numbers and strings without float drift', () => {
    expect(toMinor(0.1 + 0.2)).toBe(30n);
    expect(toMinor('120000.00')).toBe(12_000_000n);
    expect(toMinor(8500.1)).toBe(850_010n);
    expect(toRate(90.1234567891)).toBe(901234567891n);
  });
  it('maps a row with and without an FX snapshot', () => {
    expect(txFromRow(row()).fx).toBeNull();
    const t = txFromRow(row({ currency: 'USD', amount: 35, base_currency: 'RUB', fx_rate: 90, fx_rate_date: '2026-10-01', base_amount: 3150 }));
    expect(t.fx).toMatchObject({ baseCurrency: 'RUB', baseAmount: 315_000n, rate: 900_000_000_000n });
  });
  it('picks debt direction for debt payments', () => {
    const t = txFromRow(row({ type: 'debt_payment', debt_id: 'd1' }), new Map([['d1', 'owed_to_me']]));
    expect(t.debtDirection).toBe('owed_to_me');
  });
});
