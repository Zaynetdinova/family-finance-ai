import { describe, expect, it } from 'vitest';
import { compareScenarios, extraOrder, safeExtraPayment, simulatePayoff, type PlanDebt } from './payoff-plan';
import { estimatePayoff, percentToPpm } from './debts';
import { rub } from './fixtures';

const debt = (p: Partial<PlanDebt> & Pick<PlanDebt, 'id' | 'balance'>): PlanDebt => ({
  name: p.id, currency: 'RUB', annualRatePpm: percentToPpm('12'), minPayment: rub('1000'), priority: false, allowsPrepayment: true, prepaymentFeePpm: null, ...p,
});

// Classic three-debt example
const card = debt({ id: 'card', balance: rub('50000'), annualRatePpm: percentToPpm('29.9'), minPayment: rub('2500') });
const car = debt({ id: 'car', balance: rub('300000'), annualRatePpm: percentToPpm('14'), minPayment: rub('9000') });
const friend = debt({ id: 'friend', balance: rub('20000'), annualRatePpm: percentToPpm('0'), minPayment: rub('2000') });
const all = [card, car, friend];
const start = '2026-10-19';

/** Money conservation: everything paid = starting balances + interest + fees, and balances never go negative. */
function checkInvariants(plan: ReturnType<typeof simulatePayoff>) {
  const t = plan.totals;
  if (plan.complete) expect(t.paidTotal).toBe(t.startBalance + t.interestTotal + t.feesTotal);
  for (const m of plan.months) for (const l of m.lines) expect(l.balanceAfter >= 0n).toBe(true);
  for (let i = 1; i < plan.months.length; i++) {
    expect(plan.months[i]!.index).toBe(plan.months[i - 1]!.index + 1);
  }
}

describe('12. debt payoff plan', () => {
  it('orders extra money: avalanche by rate, snowball by balance, priorities first', () => {
    expect(extraOrder(all, 'avalanche').map((d) => d.id)).toEqual(['card', 'car', 'friend']);
    expect(extraOrder(all, 'snowball').map((d) => d.id)).toEqual(['friend', 'card', 'car']);
    expect(extraOrder([...all.slice(0, 2), { ...friend, priority: true }], 'avalanche').map((d) => d.id)).toEqual(['friend', 'card', 'car']);
  });

  it('single debt without extra matches the single-debt estimate', () => {
    const d = debt({ id: 'x', balance: rub('100000'), minPayment: rub('10000') });
    const plan = simulatePayoff([d], { strategy: 'avalanche', extraMonthly: 0n, startDate: start });
    const est = estimatePayoff({ balance: rub('100000'), annualRatePpm: percentToPpm('12'), monthlyPayment: rub('10000'), from: start });
    expect(est.status).toBe('ok');
    if (est.status !== 'ok') return;
    expect(plan.totals.months).toBe(est.months);
    expect(plan.totals.interestTotal).toBe(est.totalInterest);
    expect(plan.debts[0]!.payoffDate).toBe(est.closeDate);
    checkInvariants(plan);
  });

  it('first month numbers are exact', () => {
    const plan = simulatePayoff([debt({ id: 'x', balance: rub('100000'), minPayment: rub('10000') })], { strategy: 'avalanche', extraMonthly: rub('5000'), startDate: start });
    expect(plan.months[0]!.lines[0]).toEqual({ debtId: 'x', interest: rub('1000'), payment: rub('15000'), fee: 0n, balanceAfter: rub('86000') });
    expect(plan.months[0]!.date).toBe('2026-11-19');
  });

  it('avalanche never pays more interest than snowball; both beat minimum-only', () => {
    const c = compareScenarios(all, { extraMonthly: rub('10000'), startDate: start, strategy: 'avalanche' });
    for (const p of [c.minimum, c.avalanche, c.snowball]) checkInvariants(p);
    expect(c.avalanche.totals.interestTotal <= c.snowball.totals.interestTotal).toBe(true);
    expect(c.avalanche.totals.interestTotal < c.minimum.totals.interestTotal).toBe(true);
    expect(c.avalanche.totals.months!).toBeLessThan(c.minimum.totals.months!);
    // snowball closes the smallest debt first
    const first = (p: typeof c.snowball) => [...p.debts].sort((a, b) => a.payoffMonth! - b.payoffMonth!)[0]!.debtId;
    expect(first(c.snowball)).toBe('friend');
  });

  it('rolls over minimums of closed debts (snowball effect)', () => {
    const plan = simulatePayoff(all, { strategy: 'snowball', extraMonthly: rub('5000'), startDate: start });
    const closed = plan.debts.find((d) => d.debtId === 'friend')!.payoffMonth!;
    const before = plan.months[closed - 1]!.totalPayment;
    const after = plan.months[closed]!.totalPayment;
    // Total monthly outlay stays constant (minimums + extra) while debts remain
    expect(after).toBe(before);
    expect(after).toBe(rub('2500') + rub('9000') + rub('2000') + rub('5000'));
  });

  it('more extra money shortens the term and reduces interest', () => {
    const c = compareScenarios(all, { extraMonthly: rub('5000'), startDate: start, strategy: 'avalanche', delta: rub('5000') });
    expect(c.whatIf!.monthsSaved!).toBeGreaterThan(0);
    expect(c.whatIf!.interestSaved > 0n).toBe(true);
    checkInvariants(c.whatIf!.plan);
  });

  it('debts that forbid prepayment get only their minimum; prepayment fees are counted', () => {
    const locked = { ...card, allowsPrepayment: false };
    const plan = simulatePayoff([locked, car], { strategy: 'avalanche', extraMonthly: rub('10000'), startDate: start });
    expect(plan.months[0]!.lines.find((l) => l.debtId === 'card')!.payment).toBe(rub('2500'));
    expect(plan.assumptions.join(' ')).toContain('досрочное погашение не допускается');
    checkInvariants(plan);

    const withFee = simulatePayoff([{ ...car, prepaymentFeePpm: percentToPpm('1') }], { strategy: 'avalanche', extraMonthly: rub('10000'), startDate: start });
    expect(withFee.months[0]!.lines[0]!.fee).toBe(rub('100'));
    expect(withFee.totals.feesTotal > 0n).toBe(true);
    checkInvariants(withFee);
  });

  it('reports an incomplete plan when payments do not cover interest', () => {
    const plan = simulatePayoff([debt({ id: 'x', balance: rub('1000000'), annualRatePpm: percentToPpm('24'), minPayment: rub('5000') })], { strategy: 'minimum', extraMonthly: 0n, startDate: start, maxMonths: 120 });
    expect(plan.complete).toBe(false);
    expect(plan.totals.months).toBeNull();
    expect(plan.debts[0]!.payoffDate).toBeNull();
    expect(plan.assumptions.join(' ')).toContain('не все долги погашаются');
  });

  it('marks unknown rate / minimum / variable rate as assumptions', () => {
    const plan = simulatePayoff([debt({ id: 'x', balance: rub('10000'), annualRatePpm: null, minPayment: null, variableRate: true })], { strategy: 'avalanche', extraMonthly: rub('1000'), startDate: start });
    const a = plan.assumptions.join(' ');
    expect(a).toContain('ставка не указана');
    expect(a).toContain('минимальный платёж не указан');
    expect(a).toContain('плавающая ставка');
    expect(plan.totals.months).toBe(10);
    expect(plan.totals.interestTotal).toBe(0n);
  });

  it('final payments never exceed the balance; zero-rate debt closes in balance / payment months', () => {
    const plan = simulatePayoff([debt({ id: 'x', balance: rub('25000'), annualRatePpm: 0n, minPayment: rub('10000') })], { strategy: 'avalanche', extraMonthly: 0n, startDate: '2026-01-31' });
    expect(plan.months.map((m) => m.totalPayment)).toEqual([rub('10000'), rub('10000'), rub('5000')]);
    expect(plan.debts[0]!.payoffDate).toBe('2026-04-30');
    checkInvariants(plan);
  });

  it('rejects mixed currencies and negative extra', () => {
    expect(() => simulatePayoff([card, { ...car, currency: 'USD' }], { strategy: 'avalanche', extraMonthly: 0n, startDate: start })).toThrow();
    expect(() => simulatePayoff([card], { strategy: 'avalanche', extraMonthly: -1n, startDate: start })).toThrow();
  });
});

describe('safeExtraPayment', () => {
  it('keeps the reserve intact', () => {
    expect(safeExtraPayment({ avgFreeCashflow: rub('20000'), liquidBalance: rub('30000'), reserve: rub('100000'), requested: rub('10000') })).toMatchObject({ suggested: 0n });
  });
  it('suggests the average free cash flow and warns when the request exceeds it', () => {
    const r = safeExtraPayment({ avgFreeCashflow: rub('15000'), liquidBalance: rub('200000'), reserve: rub('100000'), requested: rub('30000') });
    expect(r.suggested).toBe(rub('15000'));
    expect(r.warnings[0]).toContain('больше, чем в среднем остаётся');
  });
  it('says so when history is too short or cash flow is negative', () => {
    expect(safeExtraPayment({ avgFreeCashflow: null, liquidBalance: 0n, reserve: 0n, requested: 0n }).suggested).toBeNull();
    expect(safeExtraPayment({ avgFreeCashflow: -rub('5000'), liquidBalance: rub('1'), reserve: 0n, requested: 0n }).suggested).toBe(0n);
  });
});
