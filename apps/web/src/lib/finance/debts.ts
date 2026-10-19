import { type Currency, type Minor, divRound, ratioBp } from './money';
import { type IsoDate, addDays, addMonths, addMonthsKeepDay, endOfMonth, startOfMonth } from './dates';
import type { DebtDirection } from './types';

/** Annual percent such as "12.5" → parts per million of the annual rate (125000). */
export function percentToPpm(percent: string | number): bigint {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(percent));
  if (!m) throw new Error(`Invalid percent: ${percent}`);
  return BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0') || '0');
}

export type PayoffEstimate =
  | { status: 'ok'; months: number; totalInterest: Minor; closeDate: IsoDate; approximate: true }
  | { status: 'never'; monthlyInterest: Minor }
  | { status: 'insufficient_data'; missing: ('payment' | 'rate')[] };

/**
 * Rough payoff of ONE debt at a constant monthly payment, monthly compounding of
 * annualRate/12. Ignores fees, day-count conventions and rate changes, therefore always
 * labelled approximate. Multi-debt strategies live in `payoff-plan`.
 */
export function estimatePayoff(opts: {
  balance: Minor;
  annualRatePpm: bigint | null;
  monthlyPayment: Minor | null;
  from: IsoDate;
  maxMonths?: number;
}): PayoffEstimate {
  const missing: ('payment' | 'rate')[] = [];
  if (opts.monthlyPayment === null || opts.monthlyPayment <= 0n) missing.push('payment');
  if (opts.annualRatePpm === null) missing.push('rate');
  if (missing.length) return { status: 'insufficient_data', missing };
  const payment = opts.monthlyPayment!;
  const ppm = opts.annualRatePpm!;
  let balance = opts.balance;
  if (balance <= 0n) return { status: 'ok', months: 0, totalInterest: 0n, closeDate: opts.from, approximate: true };

  const firstInterest = divRound(balance * ppm, 12_000_000n);
  if (payment <= firstInterest) return { status: 'never', monthlyInterest: firstInterest };

  let months = 0;
  let total = 0n;
  const max = opts.maxMonths ?? 1200;
  while (balance > 0n && months < max) {
    const interest = divRound(balance * ppm, 12_000_000n);
    total += interest;
    balance = balance + interest - (payment < balance + interest ? payment : balance + interest);
    months++;
  }
  return { status: 'ok', months, totalInterest: total, closeDate: addMonthsKeepDay(opts.from, months), approximate: true };
}

/** Repayment progress in basis points; null if the original amount is unknown/zero. */
export function repaidBp(original: Minor, current: Minor): number | null {
  if (original <= 0n) return null;
  const repaid = original - current;
  return ratioBp(repaid < 0n ? 0n : repaid, original);
}

export interface DebtSchedule {
  id: string;
  name: string;
  currency: Currency;
  direction: DebtDirection;
  status: 'active' | 'closed';
  minPayment: Minor | null;
  paymentDay: number | null;
  dueDate: IsoDate | null;
}

export interface UpcomingPayment {
  debtId: string;
  name: string;
  currency: Currency;
  amount: Minor;
  date: IsoDate;
  overdue: boolean;
}

function dayInMonth(monthStart: IsoDate, day: number): IsoDate {
  const last = Number(endOfMonth(monthStart).slice(8));
  return `${monthStart.slice(0, 8)}${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * Next mandatory payments of debts I owe within `horizonDays`. A payment dated earlier in
 * the current month with nothing paid that month is reported as overdue. Payment days
 * beyond a month's length (e.g. 31) fall on the last day of that month.
 */
export function upcomingPayments(
  debts: DebtSchedule[],
  payments: { debtId: string; paidOn: IsoDate }[],
  today: IsoDate,
  horizonDays = 30,
): UpcomingPayment[] {
  const horizon = addDays(today, horizonDays);
  const thisMonth = startOfMonth(today);
  const out: UpcomingPayment[] = [];
  for (const d of debts) {
    if (d.status !== 'active' || d.direction !== 'owed_by_me' || !d.paymentDay || !d.minPayment) continue;
    const paidThisMonth = payments.some((p) => p.debtId === d.id && startOfMonth(p.paidOn) === thisMonth);
    for (let i = 0; i < 3; i++) {
      const month = addMonths(thisMonth, i);
      const date = dayInMonth(month, d.paymentDay);
      if (d.dueDate && date > d.dueDate) break;
      if (i === 0 && paidThisMonth) continue;
      if (date > horizon) break;
      if (date < today && i > 0) continue;
      out.push({ debtId: d.id, name: d.name, currency: d.currency, amount: d.minPayment, date, overdue: date < today });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
