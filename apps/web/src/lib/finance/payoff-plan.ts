import { type Currency, type Minor, divRound } from './money';
import { type IsoDate, addMonthsKeepDay } from './dates';

export type Strategy = 'avalanche' | 'snowball' | 'minimum';

export interface PlanDebt {
  id: string;
  name: string;
  currency: Currency;
  balance: Minor;
  /** Annual rate in parts per million (12.5% → 125000); null = unknown. */
  annualRatePpm: bigint | null;
  minPayment: Minor | null;
  /** User-marked priority: receives extra money before the strategy order. */
  priority: boolean;
  allowsPrepayment: boolean;
  /** Fee charged on early (extra) repayment, in ppm of the prepaid amount; null = none known. */
  prepaymentFeePpm: bigint | null;
  variableRate?: boolean;
}

export interface PlanOptions {
  strategy: Strategy;
  /** Money per month on top of all minimum payments. */
  extraMonthly: Minor;
  startDate: IsoDate;
  maxMonths?: number;
}

export interface MonthDebtLine {
  debtId: string;
  interest: Minor;
  payment: Minor;
  fee: Minor;
  balanceAfter: Minor;
}

export interface PlanMonth {
  index: number; // 1-based
  date: IsoDate;
  lines: MonthDebtLine[];
  totalPayment: Minor;
  totalBalance: Minor;
}

export interface DebtOutcome {
  debtId: string;
  name: string;
  payoffMonth: number | null;
  payoffDate: IsoDate | null;
  interestTotal: Minor;
  feesTotal: Minor;
  paidTotal: Minor;
}

export interface PayoffPlan {
  strategy: Strategy;
  currency: Currency;
  extraMonthly: Minor;
  complete: boolean;
  months: PlanMonth[];
  debts: DebtOutcome[];
  /** Order in which extra money is directed. */
  order: string[];
  totals: { months: number | null; interestTotal: Minor; feesTotal: Minor; paidTotal: Minor; startBalance: Minor };
  /** Every simplification the numbers depend on. Non-empty → the plan is approximate. */
  assumptions: string[];
}

const PPM = 1_000_000n;

/** Strategy order for extra money: user priorities first, then avalanche (rate ↓) or snowball (balance ↑). */
export function extraOrder(debts: PlanDebt[], strategy: Strategy): PlanDebt[] {
  const rate = (d: PlanDebt) => d.annualRatePpm ?? -1n;
  const cmp = (a: PlanDebt, b: PlanDebt): number => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    if (strategy === 'snowball') {
      if (a.balance !== b.balance) return a.balance < b.balance ? -1 : 1;
      return rate(a) > rate(b) ? -1 : rate(a) < rate(b) ? 1 : 0;
    }
    if (rate(a) !== rate(b)) return rate(a) > rate(b) ? -1 : 1;
    return a.balance < b.balance ? -1 : a.balance > b.balance ? 1 : 0;
  };
  return [...debts].sort(cmp);
}

/**
 * Month-by-month repayment simulation.
 * Each month: interest accrues (balance × annual rate / 12), every debt gets its minimum payment,
 * then the extra amount plus minimums freed by closed debts goes to debts in strategy order.
 * The "minimum" strategy pays minimums only (no extra, no rollover) and serves as a baseline.
 */
export function simulatePayoff(input: PlanDebt[], opts: PlanOptions): PayoffPlan {
  const debts = input.filter((d) => d.balance > 0n);
  const currencies = new Set(debts.map((d) => d.currency));
  if (currencies.size > 1) throw new Error('All debts in a plan must use the same currency');
  if (opts.extraMonthly < 0n) throw new Error('Extra payment cannot be negative');
  const currency = debts[0]?.currency ?? 'RUB';
  const maxMonths = opts.maxMonths ?? 600;
  const extra = opts.strategy === 'minimum' ? 0n : opts.extraMonthly;

  const assumptions: string[] = [
    'Проценты начисляются раз в месяц как остаток × годовая ставка / 12; банк может считать по дням, поэтому суммы приблизительные.',
  ];
  for (const d of debts) {
    if (d.annualRatePpm === null) assumptions.push(`«${d.name}»: ставка не указана — проценты не учитываются.`);
    if (d.minPayment === null) assumptions.push(`«${d.name}»: минимальный платёж не указан — принят равным 0.`);
    if (d.variableRate) assumptions.push(`«${d.name}»: плавающая ставка — расчёт по текущей ставке.`);
    if (!d.allowsPrepayment && extra > 0n) assumptions.push(`«${d.name}»: досрочное погашение не допускается — дополнительные деньги на него не направляются.`);
    if (d.prepaymentFeePpm && d.prepaymentFeePpm > 0n && extra > 0n) assumptions.push(`«${d.name}»: учтена комиссия за досрочное погашение.`);
  }

  const order = extraOrder(debts, opts.strategy).map((d) => d.id);
  const byId = new Map(debts.map((d) => [d.id, d]));
  const bal = new Map(debts.map((d) => [d.id, d.balance]));
  const out = new Map<string, DebtOutcome>(debts.map((d) => [d.id, { debtId: d.id, name: d.name, payoffMonth: null, payoffDate: null, interestTotal: 0n, feesTotal: 0n, paidTotal: 0n }]));
  const months: PlanMonth[] = [];
  let freed = 0n; // minimums of debts closed in earlier months (rolled over)

  for (let m = 1; m <= maxMonths; m++) {
    if ([...bal.values()].every((b) => b === 0n)) break;
    const date = addMonthsKeepDay(opts.startDate, m);
    const lines = new Map<string, MonthDebtLine>();
    let pool = extra + (opts.strategy === 'minimum' ? 0n : freed);

    // 1. interest, 2. minimum payment
    for (const d of debts) {
      let b = bal.get(d.id)!;
      if (b === 0n) continue;
      const interest = d.annualRatePpm ? divRound(b * d.annualRatePpm, 12n * PPM) : 0n;
      b += interest;
      const due = d.minPayment ?? 0n;
      const pay = due < b ? due : b;
      b -= pay;
      if (opts.strategy !== 'minimum' && due > pay) pool += due - pay; // unused part of a final minimum
      bal.set(d.id, b);
      lines.set(d.id, { debtId: d.id, interest, payment: pay, fee: 0n, balanceAfter: b });
    }

    // 3. extra money in strategy order
    for (const id of order) {
      if (pool === 0n) break;
      const d = byId.get(id)!;
      const b = bal.get(id)!;
      if (b === 0n || !d.allowsPrepayment) continue;
      const fee = d.prepaymentFeePpm ?? 0n;
      // amount p such that p − fee(p) clears the balance
      const needed = fee > 0n ? (b * PPM + (PPM - fee) - 1n) / (PPM - fee) : b;
      const p = pool < needed ? pool : needed;
      const feeAmt = fee > 0n ? divRound(p * fee, PPM) : 0n;
      const reduce = p - feeAmt > b ? b : p - feeAmt;
      bal.set(id, b - reduce);
      pool -= p;
      const line = lines.get(id)!;
      line.payment += p;
      line.fee += feeAmt;
      line.balanceAfter = b - reduce;
    }

    let totalPayment = 0n;
    for (const line of lines.values()) {
      const o = out.get(line.debtId)!;
      o.interestTotal += line.interest;
      o.feesTotal += line.fee;
      o.paidTotal += line.payment;
      totalPayment += line.payment;
      if (line.balanceAfter === 0n && o.payoffMonth === null) {
        o.payoffMonth = m;
        o.payoffDate = date;
        freed += byId.get(line.debtId)!.minPayment ?? 0n;
      }
    }
    months.push({ index: m, date, lines: [...lines.values()], totalPayment, totalBalance: [...bal.values()].reduce((a, b) => a + b, 0n) });
  }

  const outcomes = debts.map((d) => out.get(d.id)!);
  const complete = outcomes.every((o) => o.payoffMonth !== null);
  if (!complete) assumptions.push(`За ${maxMonths} мес. не все долги погашаются: платежей не хватает на проценты.`);
  return {
    strategy: opts.strategy,
    currency,
    extraMonthly: extra,
    complete,
    months,
    debts: outcomes,
    order,
    totals: {
      months: complete ? Math.max(0, ...outcomes.map((o) => o.payoffMonth!)) : null,
      interestTotal: outcomes.reduce((a, o) => a + o.interestTotal, 0n),
      feesTotal: outcomes.reduce((a, o) => a + o.feesTotal, 0n),
      paidTotal: outcomes.reduce((a, o) => a + o.paidTotal, 0n),
      startBalance: debts.reduce((a, d) => a + d.balance, 0n),
    },
    assumptions,
  };
}

export interface ScenarioComparison {
  minimum: PayoffPlan;
  avalanche: PayoffPlan;
  snowball: PayoffPlan;
  /** The chosen strategy with extra + delta, to show what an additional payment changes. */
  whatIf: { delta: Minor; plan: PayoffPlan; monthsSaved: number | null; interestSaved: Minor } | null;
}

export function compareScenarios(debts: PlanDebt[], opts: { extraMonthly: Minor; startDate: IsoDate; strategy: Exclude<Strategy, 'minimum'>; delta?: Minor }): ScenarioComparison {
  const run = (strategy: Strategy, extra: Minor) => simulatePayoff(debts, { strategy, extraMonthly: extra, startDate: opts.startDate });
  const avalanche = run('avalanche', opts.extraMonthly);
  const snowball = run('snowball', opts.extraMonthly);
  const chosen = opts.strategy === 'avalanche' ? avalanche : snowball;
  let whatIf = null;
  if (opts.delta && opts.delta > 0n) {
    const plan = run(opts.strategy, opts.extraMonthly + opts.delta);
    whatIf = {
      delta: opts.delta,
      plan,
      monthsSaved: chosen.totals.months !== null && plan.totals.months !== null ? chosen.totals.months - plan.totals.months : null,
      interestSaved: chosen.totals.interestTotal - plan.totals.interestTotal,
    };
  }
  return { minimum: run('minimum', 0n), avalanche, snowball, whatIf };
}

/**
 * How much extra per month is safe to direct to debts. Uses the average free cash flow of
 * recent months (income − expenses − principal of current debt payments) and keeps the
 * reserve intact: while savings are below the reserve, the suggestion is 0.
 */
export function safeExtraPayment(opts: { avgFreeCashflow: Minor | null; liquidBalance: Minor; reserve: Minor; requested: Minor }): {
  suggested: Minor | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (opts.liquidBalance < opts.reserve) {
    warnings.push('Остатки на счетах меньше минимального резерва: сначала пополните резерв, досрочные платежи сейчас не рекомендуются.');
    return { suggested: 0n, warnings };
  }
  if (opts.avgFreeCashflow === null) {
    warnings.push('Недостаточно истории (нужен хотя бы один полный месяц), чтобы оценить, сколько безопасно направлять на долги.');
    return { suggested: null, warnings };
  }
  const suggested = opts.avgFreeCashflow > 0n ? opts.avgFreeCashflow : 0n;
  if (suggested === 0n) warnings.push('В последние месяцы расходы и обязательные платежи съедали весь доход: дополнительных денег на долги нет.');
  else if (opts.requested > suggested) warnings.push('Указанная сумма больше, чем в среднем остаётся после всех расходов: план может оказаться невыполнимым.');
  return { suggested, warnings };
}
