import { describe, expect, it } from 'vitest';
import { forecastMonthEnd, summarize } from './summary';
import { comparePeriods } from './compare';
import { previousComparableRange } from './dates';
import { categories, rub, tx } from './fixtures';
import { parseRate } from './money';
import { findPossibleDuplicates, telegramExternalId } from './dedupe';

const base = { mode: 'base', currency: 'RUB' } as const;
const sept = { from: '2026-09-01', to: '2026-09-30' };
const oct = { from: '2026-10-01', to: '2026-10-31' };

const septTxs = [
  tx({ type: 'income', amount: rub('120000'), categoryId: 'c-salary', occurredOn: '2026-09-05' }),
  tx({ type: 'expense', amount: rub('30000'), categoryId: 'c-home', occurredOn: '2026-09-06' }),
  tx({ type: 'expense', amount: rub('20000'), categoryId: 'c-food', occurredOn: '2026-09-10' }),
  tx({ type: 'expense', amount: rub('5000'), categoryId: 'c-cafe', occurredOn: '2026-09-12' }),
  tx({ type: 'refund', amount: rub('1500'), categoryId: 'c-food', occurredOn: '2026-09-13' }),
  tx({ type: 'transfer', amount: rub('50000'), accountId: 'acc-save', transferAccountId: 'acc-card', transferAmount: rub('50000'), occurredOn: '2026-09-14' }),
  tx({ type: 'debt_payment', amount: rub('10000'), principal: rub('6000'), interest: rub('4000'), fee: 0n, categoryId: 'c-debt', occurredOn: '2026-09-15' }),
  tx({ type: 'expense', amount: rub('999'), occurredOn: '2026-09-16', status: 'cancelled' }),
];

describe('summarize', () => {
  const s = summarize(septTxs, { range: sept, view: base, asOf: '2026-10-18', categories });

  it('9. monthly summary: exact totals without double counting', () => {
    expect(s.income).toBe(rub('120000'));
    // 30000 + 20000 + 5000 − 1500 refund + 4000 interest; principal, transfer and cancelled excluded
    expect(s.expense).toBe(rub('57500'));
    expect(s.net).toBe(rub('62500'));
    expect(s.debtPrincipalPaid).toBe(rub('6000'));
    expect(s.interestAndFeesPaid).toBe(rub('4000'));
    expect(s.savingsRateBp).toBe(5208); // 62500 / 120000 = 52.08%
    expect(s.provisional).toBe(false);
    expect(s.unconverted.count).toBe(0);
  });

  it('splits by category with refunds netted and sorts descending', () => {
    expect(s.byCategory.map((c) => [c.categoryId, c.expense])).toEqual([
      ['c-home', rub('30000')], ['c-food', rub('18500')], ['c-cafe', rub('5000')], ['c-debt', rub('4000')],
    ]);
    expect(s.byCategory[0]!.shareBp).toBe(5217);
  });

  it('separates fixed and variable expenses', () => {
    expect(s.fixedExpense).toBe(rub('34000')); // housing 30000 + loan interest 4000
    expect(s.variableExpense).toBe(rub('23500'));
  });

  it('computes average daily expense over the full finished month', () => {
    expect(s.elapsedDays).toBe(30);
    expect(s.avgDailyExpense).toBe(rub('1916.67'));
  });

  it('lists only real expenses among the largest', () => {
    expect(s.largestExpenses.map((e) => e.amount)).toEqual([rub('30000'), rub('20000'), rub('5000')]);
  });

  it('distinguishes zero from no data', () => {
    const empty = summarize([], { range: sept, view: base, asOf: '2026-10-18' });
    expect(empty.hasData).toBe(false);
    expect(empty.avgDailyExpense).toBeNull();
    expect(empty.savingsRateBp).toBeNull();
    const zero = summarize([tx({ type: 'income', amount: rub('1'), occurredOn: '2026-09-02' })], { range: sept, view: base, asOf: '2026-10-18' });
    expect(zero.hasData).toBe(true);
    expect(zero.expense).toBe(0n);
  });

  it('marks a month in progress as provisional and uses elapsed days', () => {
    const cur = summarize([tx({ type: 'expense', amount: rub('9000'), occurredOn: '2026-10-03' })], { range: oct, view: base, asOf: '2026-10-09' });
    expect(cur.provisional).toBe(true);
    expect(cur.elapsedDays).toBe(9);
    expect(cur.avgDailyExpense).toBe(rub('1000'));
    expect(forecastMonthEnd(cur)).toMatchObject({ projectedExpense: rub('31000'), remainingDays: 22 });
  });

  it('does not forecast from a too-short history', () => {
    const cur = summarize([tx({ type: 'expense', amount: rub('9000'), occurredOn: '2026-10-02' })], { range: oct, view: base, asOf: '2026-10-03' });
    expect(forecastMonthEnd(cur)).toBeNull();
  });

  it('keeps currencies apart in original view and flags unconverted foreign amounts in base view', () => {
    const usd = tx({ type: 'expense', currency: 'USD', accountId: 'acc-usd', amount: rub('35'), occurredOn: '2026-09-20' });
    const withFx = { ...usd, id: 'x2', fx: { baseCurrency: 'RUB' as const, rate: parseRate('90'), rateDate: '2026-09-20', baseAmount: rub('3150') } };
    const all = [...septTxs, usd, withFx];
    const b = summarize(all, { range: sept, view: base, asOf: '2026-10-18', categories });
    expect(b.expense).toBe(rub('57500') + rub('3150'));
    expect(b.unconverted.ids).toEqual([usd.id]);
    const u = summarize(all, { range: sept, view: { mode: 'original', currency: 'USD' }, asOf: '2026-10-18' });
    expect(u.expense).toBe(rub('70'));
    expect(u.unconverted.count).toBe(0);
  });
});

describe('comparePeriods', () => {
  const sSept = summarize(septTxs, { range: sept, view: base, asOf: '2026-11-01', categories });

  it('10. compares two finished months with exact deltas', () => {
    const octTxs = [
      tx({ type: 'income', amount: rub('120000'), categoryId: 'c-salary', occurredOn: '2026-10-05' }),
      tx({ type: 'expense', amount: rub('30000'), categoryId: 'c-home', occurredOn: '2026-10-06' }),
      tx({ type: 'expense', amount: rub('34500'), categoryId: 'c-food', occurredOn: '2026-10-10' }),
      tx({ type: 'expense', amount: rub('3000'), categoryId: 'c-other', occurredOn: '2026-10-11' }),
    ];
    const sOct = summarize(octTxs, { range: oct, view: base, asOf: '2026-11-01', categories });
    const c = comparePeriods(sOct, sSept);
    expect(c.comparable).toBe(true);
    if (!c.comparable) return;
    expect(c.expense).toMatchObject({ current: rub('67500'), previous: rub('57500'), diff: rub('10000'), changeBp: 1739 });
    expect(c.provisional).toBe(false);
    const food = c.categories.find((x) => x.categoryId === 'c-food')!;
    expect(food).toMatchObject({ diff: rub('16000'), changeBp: 8649 });
    expect(c.categories.find((x) => x.categoryId === 'c-other')).toMatchObject({ isNew: true, changeBp: null });
    expect(c.categories.find((x) => x.categoryId === 'c-cafe')).toMatchObject({ disappeared: true });
  });

  it('13. refuses to compare when the previous period has no data', () => {
    const cur = summarize([tx({ type: 'expense', amount: rub('5'), occurredOn: '2026-10-05' })], { range: oct, view: base, asOf: '2026-11-01' });
    const prev = summarize([], { range: sept, view: base, asOf: '2026-11-01' });
    expect(comparePeriods(cur, prev)).toEqual({ comparable: false, reason: 'no_previous_data' });
  });

  it('a previous period with data but zero expense is comparable (percent undefined, not infinite)', () => {
    const prev = summarize([tx({ type: 'income', amount: rub('100'), occurredOn: '2026-09-05' })], { range: sept, view: base, asOf: '2026-11-01' });
    const cur = summarize([tx({ type: 'expense', amount: rub('50'), occurredOn: '2026-10-05' })], { range: oct, view: base, asOf: '2026-11-01' });
    const c = comparePeriods(cur, prev);
    expect(c.comparable).toBe(true);
    if (c.comparable) expect(c.expense.changeBp).toBeNull();
  });

  it('does not compare different lengths or currency views', () => {
    const week = summarize(septTxs, { range: { from: '2026-09-01', to: '2026-09-07' }, view: base, asOf: '2026-11-01' });
    expect(comparePeriods(week, sSept)).toEqual({ comparable: false, reason: 'different_length' });
    const usd = summarize(septTxs, { range: sept, view: { mode: 'original', currency: 'USD' }, asOf: '2026-11-01' });
    expect(comparePeriods(sSept, usd)).toEqual({ comparable: false, reason: 'different_currency' });
  });

  it('a month in progress is compared with the same number of days of the previous month', () => {
    const asOf = '2026-10-09';
    const prevRange = previousComparableRange(oct, asOf);
    expect(prevRange).toEqual({ from: '2026-09-01', to: '2026-09-09', truncated: false });
    const cur = summarize([tx({ type: 'expense', amount: rub('9000'), occurredOn: '2026-10-03' })], { range: oct, view: base, asOf });
    const prev = summarize(septTxs, { range: prevRange, view: base, asOf });
    const c = comparePeriods(cur, prev);
    expect(c.comparable).toBe(true);
    if (c.comparable) expect(c.provisional).toBe(true);
    // comparing against the full previous month would be wrong
    expect(comparePeriods(cur, sSept)).toEqual({ comparable: false, reason: 'different_length' });
  });

  it('a week in progress is compared with the same elapsed days of the previous week', () => {
    expect(previousComparableRange({ from: '2026-10-12', to: '2026-10-18' }, '2026-10-14')).toEqual({ from: '2026-10-05', to: '2026-10-07', truncated: false });
  });

  it('previous range for non-month periods is the preceding range of equal length', () => {
    expect(previousComparableRange({ from: '2026-10-12', to: '2026-10-18' }, '2026-10-18')).toMatchObject({ from: '2026-10-05', to: '2026-10-11' });
  });
});

describe('duplicates', () => {
  it('8. the same Telegram message always yields the same idempotency key', () => {
    expect(telegramExternalId(123, 456)).toBe(telegramExternalId('123', '456'));
    expect(telegramExternalId(123, 456)).not.toBe(telegramExternalId(123, 457));
  });
  it('flags possible duplicates entered separately, without touching them', () => {
    const a = tx({ type: 'expense', amount: rub('1200'), occurredOn: '2026-09-10' });
    const b = tx({ type: 'expense', amount: rub('1200'), occurredOn: '2026-09-11' });
    const c = tx({ type: 'expense', amount: rub('1200'), occurredOn: '2026-09-25' });
    const d = tx({ type: 'expense', amount: rub('1201'), occurredOn: '2026-09-10' });
    const groups = findPossibleDuplicates([a, b, c, d]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((t) => t.id)).toEqual([a.id, b.id]);
  });
});
