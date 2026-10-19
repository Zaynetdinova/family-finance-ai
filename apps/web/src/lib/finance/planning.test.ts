import { describe, expect, it } from 'vitest';
import { resolvePeriod, todayIn } from './period';
import { defaultBucket, timeSeries } from './series';
import { detectUnusual, median } from './anomalies';
import { estimatePayoff, percentToPpm, repaidBp, upcomingPayments, type DebtSchedule } from './debts';
import { availableToSave, goalProgress, limitStatus, rollUpByCategory } from './budget';
import { rub, tx } from './fixtures';

const base = { mode: 'base', currency: 'RUB' } as const;

describe('period', () => {
  const today = '2026-10-18'; // Sunday
  it('resolves presets', () => {
    expect(resolvePeriod({ period: 'month' }, today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolvePeriod({ period: 'prev_month' }, today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolvePeriod({ period: 'week' }, today)).toMatchObject({ from: '2026-10-12', to: '2026-10-18' });
    expect(resolvePeriod({ period: '30d' }, today)).toMatchObject({ from: '2026-09-19', to: '2026-10-18' });
    expect(resolvePeriod({ period: 'year' }, today)).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
  });
  it('validates custom ranges and falls back to the month', () => {
    expect(resolvePeriod({ period: 'custom', from: '2026-10-05', to: '2026-10-09' }, today)).toMatchObject({ key: 'custom', from: '2026-10-05' });
    expect(resolvePeriod({ period: 'custom', from: '2026-10-09', to: '2026-10-05' }, today).key).toBe('month');
    expect(resolvePeriod({ period: 'custom', from: 'x', to: 'y' }, today).key).toBe('month');
    expect(resolvePeriod({ period: 'bogus' }, today).key).toBe('month');
  });
  it('computes today in a time zone', () => {
    const now = new Date('2026-10-18T23:30:00Z');
    expect(todayIn('UTC', now)).toBe('2026-10-18');
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-19');
    expect(todayIn('Not/AZone', now)).toBe('2026-10-18');
  });
});

describe('timeSeries', () => {
  const txs = [
    tx({ type: 'income', amount: rub('100'), occurredOn: '2026-10-01' }),
    tx({ type: 'expense', amount: rub('30'), occurredOn: '2026-10-02' }),
    tx({ type: 'expense', amount: rub('20'), occurredOn: '2026-10-09' }),
    tx({ type: 'transfer', amount: rub('999'), accountId: 'a', transferAccountId: 'b', occurredOn: '2026-10-09' }),
  ];
  const range = { from: '2026-10-01', to: '2026-10-14' };
  it('keeps empty days as zeros', () => {
    const d = timeSeries(txs, { range, bucket: 'day', view: base });
    expect(d).toHaveLength(14);
    expect(d[2]).toEqual({ start: '2026-10-03', income: 0n, expense: 0n });
  });
  it('groups by ISO week, clipping the first bucket to the range', () => {
    const w = timeSeries(txs, { range, bucket: 'week', view: base });
    expect(w.map((p) => [p.start, p.income, p.expense])).toEqual([
      ['2026-10-01', rub('100'), rub('30')],
      ['2026-10-05', 0n, rub('20')],
      ['2026-10-12', 0n, 0n],
    ]);
  });
  it('groups by month and picks buckets by length', () => {
    const m = timeSeries(txs, { range: { from: '2026-09-15', to: '2026-11-10' }, bucket: 'month', view: base });
    expect(m.map((p) => p.start)).toEqual(['2026-09-15', '2026-10-01', '2026-11-01']);
    expect(m[1]!.expense).toBe(rub('50'));
    expect([defaultBucket(7), defaultBucket(90), defaultBucket(365)]).toEqual(['day', 'week', 'month']);
  });
});

describe('detectUnusual', () => {
  const cafe = (amount: string, d: string) => tx({ type: 'expense', amount: rub(amount), categoryId: 'c-cafe', occurredOn: d });
  const history = ['500', '600', '550', '480', '620'].map((a, i) => cafe(a, `2026-08-0${i + 1}`));
  it('flags an expense far above the category median when history is sufficient', () => {
    const big = cafe('9000', '2026-10-05');
    const r = detectUnusual([...history, big, cafe('700', '2026-10-06')], { range: { from: '2026-10-01', to: '2026-10-31' }, view: base });
    expect(r.map((x) => x.id)).toEqual([big.id]);
    expect(r[0]!.median).toBe(rub('550'));
  });
  it('does not flag anything on a short history', () => {
    const r = detectUnusual([...history.slice(0, 3), cafe('9000', '2026-10-05')], { range: { from: '2026-10-01', to: '2026-10-31' }, view: base });
    expect(r).toEqual([]);
  });
  it('computes the median of even and odd lists', () => {
    expect(median([3n, 1n, 2n])).toBe(2n);
    expect(median([1n, 2n, 3n, 4n])).toBe(3n); // 2.5 rounded half up
  });
});

describe('debts', () => {
  it('parses percent exactly', () => {
    expect(percentToPpm('12.5')).toBe(125_000n);
    expect(percentToPpm('0')).toBe(0n);
  });
  it('estimates payoff with interest and labels it approximate', () => {
    // 100 000 at 12% / 12 = 1% monthly, 10 000 per month → 11 payments
    const e = estimatePayoff({ balance: rub('100000'), annualRatePpm: percentToPpm('12'), monthlyPayment: rub('10000'), from: '2026-10-18' });
    expect(e).toMatchObject({ status: 'ok', months: 11, approximate: true, closeDate: '2027-09-18' });
    if (e.status === 'ok') {
      expect(e.totalInterest).toBeGreaterThan(rub('5000'));
      expect(e.totalInterest).toBeLessThan(rub('6000'));
    }
  });
  it('zero rate pays off in balance / payment months', () => {
    const e = estimatePayoff({ balance: rub('30000'), annualRatePpm: 0n, monthlyPayment: rub('10000'), from: '2026-01-31' });
    expect(e).toMatchObject({ status: 'ok', months: 3, totalInterest: 0n, closeDate: '2026-04-30' });
  });
  it('says "never" when the payment does not cover interest, and asks for missing data', () => {
    expect(estimatePayoff({ balance: rub('1000000'), annualRatePpm: percentToPpm('12'), monthlyPayment: rub('5000'), from: '2026-10-18' }).status).toBe('never');
    expect(estimatePayoff({ balance: rub('1000'), annualRatePpm: null, monthlyPayment: null, from: '2026-10-18' })).toEqual({ status: 'insufficient_data', missing: ['payment', 'rate'] });
  });
  it('computes repayment progress', () => {
    expect(repaidBp(rub('100000'), rub('75000'))).toBe(2500);
    expect(repaidBp(0n, 0n)).toBeNull();
  });

  const debt = (p: Partial<DebtSchedule>): DebtSchedule => ({
    id: 'd1', name: 'Ипотека', currency: 'RUB', direction: 'owed_by_me', status: 'active', minPayment: rub('30000'), paymentDay: 25, dueDate: null, ...p,
  });
  it('lists upcoming payments in the horizon', () => {
    const r = upcomingPayments([debt({})], [], '2026-10-18', 30);
    expect(r.map((p) => p.date)).toEqual(['2026-10-25']);
    expect(r[0]!.overdue).toBe(false);
  });
  it('skips a month that is already paid, reports unpaid past dates as overdue', () => {
    expect(upcomingPayments([debt({})], [{ debtId: 'd1', paidOn: '2026-10-10' }], '2026-10-18', 30).map((p) => p.date)).toEqual([]);
    const late = upcomingPayments([debt({ paymentDay: 5 })], [], '2026-10-18', 30);
    expect(late[0]).toMatchObject({ date: '2026-10-05', overdue: true });
    expect(late[1]).toMatchObject({ date: '2026-11-05', overdue: false });
  });
  it('clamps day 31 to the end of short months and ignores closed/owed-to-me/finished debts', () => {
    expect(upcomingPayments([debt({ paymentDay: 31 })], [], '2026-11-01', 60).map((p) => p.date)).toEqual(['2026-11-30', '2026-12-31']);
    expect(upcomingPayments([debt({ status: 'closed' }), debt({ direction: 'owed_to_me' })], [], '2026-10-18')).toEqual([]);
    expect(upcomingPayments([debt({ dueDate: '2026-10-20' })], [], '2026-10-18', 60)).toEqual([]); // loan ends before the next payment day
  });
});

describe('budget & goals', () => {
  it('flags warning at 80% and exceeded above the limit', () => {
    expect(limitStatus(rub('10000'), rub('7000')).state).toBe('ok');
    expect(limitStatus(rub('10000'), rub('8000'))).toMatchObject({ state: 'warning', usedBp: 8000 });
    expect(limitStatus(rub('10000'), rub('10000')).state).toBe('warning');
    expect(limitStatus(rub('10000'), rub('10500'))).toMatchObject({ state: 'exceeded', remaining: -rub('500') });
    expect(limitStatus(0n, rub('1')).state).toBe('exceeded');
    expect(limitStatus(0n, 0n).state).toBe('ok');
  });
  it('available to save never goes negative and reports the shortfall', () => {
    expect(availableToSave({ income: rub('120000'), expense: rub('50000'), upcomingMandatory: rub('30000'), reserve: rub('10000') })).toEqual({ available: rub('30000'), shortfall: 0n });
    expect(availableToSave({ income: rub('50000'), expense: rub('50000'), upcomingMandatory: rub('30000'), reserve: 0n })).toEqual({ available: 0n, shortfall: rub('30000') });
  });
  it('goal progress and required monthly saving', () => {
    const g = goalProgress({ target: rub('120000'), current: rub('30000'), targetDate: '2027-04-18', today: '2026-10-18' });
    expect(g.progressBp).toBe(2500);
    expect(g.remaining).toBe(rub('90000'));
    expect(g.monthsLeft).toBe(6);
    expect(g.requiredPerMonth).toBe(rub('15000'));
    expect(goalProgress({ target: rub('10'), current: rub('15'), targetDate: null, today: '2026-10-18' })).toMatchObject({ achieved: true, progressBp: 10000, requiredPerMonth: null });
    expect(goalProgress({ target: rub('10'), current: 0n, targetDate: '2026-01-01', today: '2026-10-18' }).monthsLeft).toBeNull();
  });
});

describe('rollUpByCategory', () => {
  it('adds sub-category spend to its parent', () => {
    const cats = [{ id: 'transport' }, { id: 'taxi', parentId: 'transport' }, { id: 'food' }];
    const m = rollUpByCategory([
      { categoryId: 'taxi', expense: rub('300') },
      { categoryId: 'transport', expense: rub('200') },
      { categoryId: 'food', expense: rub('50') },
      { categoryId: null, expense: rub('999') },
    ], cats);
    expect(m.get('transport')).toBe(rub('500'));
    expect(m.get('taxi')).toBe(rub('300'));
    expect(m.get('food')).toBe(rub('50'));
    expect(m.size).toBe(3);
  });
});
