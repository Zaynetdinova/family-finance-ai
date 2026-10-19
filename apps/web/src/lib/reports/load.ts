import 'server-only';
import { loadRecentRates, type AppContext } from '@/lib/db/queries';
import { debtSchedule, rateRow, toMinor } from '@/lib/db/convert';
import type { GoalRow } from '@/lib/db/types';
import { loadBudget, loadDebtPayments, loadReport } from '@/lib/report';
import { addDays, addMonths, endOfMonth, startOfMonth } from '@/lib/finance/dates';
import { upcomingPayments } from '@/lib/finance/debts';
import { availableToSave, goalProgress, limitStatus, rollUpByCategory } from '@/lib/finance/budget';
import { findPossibleDuplicates } from '@/lib/finance/dedupe';
import { sumInCurrency } from '@/lib/finance/fx';
import { summarize } from '@/lib/finance/summary';
import { divRound, CURRENCIES, type Currency } from '@/lib/finance/money';
import { monthName, rangeLabel } from '@/lib/format';
import { structuredCompletion, type OpenAiConfig } from '@/lib/ai/openai';
import { narrativeSchema } from '@/lib/ai/schemas';
import { NARRATIVE_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { numbersGrounded } from '@/lib/ai/grounding';
import { buildReport, renderReport, type ReportKind, type ReportInput } from './build';

const PERIOD: Record<ReportKind | 'monthly_closed', string> = { daily: 'today', weekly: 'week', monthly: 'month', monthly_closed: 'prev_month' };

/** Gathers every figure a report needs. `closed` = the previous complete month (scheduled monthly report). */
export async function collectReportInput(ctx: AppContext, kind: ReportKind, opts: { closed?: boolean } = {}): Promise<ReportInput> {
  const key = kind === 'monthly' && opts.closed ? 'monthly_closed' : kind;
  const report = await loadReport(ctx, { period: PERIOD[key] });
  const base = ctx.household.base_currency;
  const [budget, payments, rateRows, goalsRes] = await Promise.all([
    loadBudget(ctx, startOfMonth(report.period.from), base),
    loadDebtPayments(ctx, addDays(ctx.today, -62)),
    loadRecentRates(ctx),
    ctx.supabase.from('financial_goals').select('*').eq('household_id', ctx.household.id).eq('status', 'active'),
  ]);
  if (goalsRes.error) throw new Error(goalsRes.error.message);

  const { current, categories, categoryName } = report;
  const spent = rollUpByCategory(current.byCategory, categories);
  const limits = (budget?.limits ?? []).map((l) => {
    const st = limitStatus(toMinor(l.limit_amount), spent.get(l.category_id) ?? 0n);
    return { name: categoryName(l.category_id), state: st.state, usedBp: st.usedBp, spent: spent.get(l.category_id) ?? 0n, limit: toMinor(l.limit_amount) };
  });

  const horizon = kind === 'weekly' ? 7 : 30;
  const upcoming = upcomingPayments(ctx.debts.map(debtSchedule), payments.map((p) => ({ debtId: p.debt_id, paidOn: p.paid_on })), ctx.today, horizon);

  const owed = ctx.debts.filter((d) => d.status === 'active' && d.direction === 'owed_by_me');
  const totals = new Map<Currency, bigint>();
  for (const d of owed) totals.set(d.currency, (totals.get(d.currency) ?? 0n) + toMinor(d.current_balance));
  const highest = owed.filter((d) => d.interest_rate !== null).sort((a, b) => Number(b.interest_rate) - Number(a.interest_rate))[0];

  // Available after mandatory payments still due this month (only meaningful for the current month).
  let available = null;
  if (kind === 'monthly' && !opts.closed) {
    const monthEnd = endOfMonth(ctx.today);
    const due = sumInCurrency(upcoming.filter((p) => p.date <= monthEnd).map((p) => ({ currency: p.currency, amount: p.amount })), base, rateRows.map(rateRow), ctx.today);
    available = availableToSave({ income: current.income, expense: current.expense, upcomingMandatory: due.total, reserve: 0n });
  }

  // Next-month forecast: average expense of up to three complete months before the report month.
  const complete: bigint[] = [];
  for (let k = 1; k <= 3; k++) {
    const from = addMonths(startOfMonth(report.period.from), -k + (opts.closed ? 1 : 0));
    if (from >= startOfMonth(ctx.today)) continue;
    const sm = summarize(report.txs, { range: { from, to: endOfMonth(from) }, view: report.view, asOf: ctx.today });
    if (sm.hasData) complete.push(sm.expense);
  }

  const goals = (goalsRes.data as GoalRow[]).map((g) => {
    const p = goalProgress({ target: toMinor(g.target_amount), current: toMinor(g.current_amount), targetDate: g.target_date, today: ctx.today });
    return { name: g.name, currency: g.currency, progressBp: p.progressBp, requiredPerMonth: p.requiredPerMonth, achieved: p.achieved };
  });

  return {
    kind,
    currency: report.view.currency,
    periodLabel: kind === 'monthly' ? monthName(report.period.from) : rangeLabel(report.period.from, report.period.to),
    previousLabel: rangeLabel(report.prevRange.from, report.prevRange.to),
    summary: current,
    comparison: report.comparison,
    categoryName,
    limits,
    dailyLimit: kind === 'daily' && budget?.budget.daily_limit != null ? toMinor(budget.budget.daily_limit) : null,
    upcoming,
    unusual: report.unusual,
    duplicateGroups: findPossibleDuplicates(report.txs.filter((t) => t.occurredOn >= report.period.from && t.occurredOn <= report.period.to)).length,
    goals,
    debtTotals: CURRENCIES.filter((c) => totals.has(c)).map((c) => ({ currency: c, amount: totals.get(c)! })),
    available,
    nextMonthForecast: complete.length ? { expense: divRound(complete.reduce((a, b) => a + b, 0n), BigInt(complete.length)), months: complete.length } : null,
    highestRateDebt: highest ? { name: highest.name, rate: String(highest.interest_rate) } : null,
  };
}

export interface GeneratedReport {
  html: string;
  ai: 'used' | 'rejected_ungrounded' | 'failed' | 'disabled' | 'skipped';
  usage?: { model: string; tokensIn: number | null; tokensOut: number | null };
  error?: string;
}

/**
 * Facts are computed by code; the model only phrases a summary and recommendations from
 * them. If its text contains numbers that are not in the facts, it is discarded and the
 * rule-based recommendations are used instead.
 */
export async function generateReport(input: ReportInput, ai: OpenAiConfig | null, esc: (s: string) => string): Promise<GeneratedReport> {
  const built = buildReport(input);
  if (!input.summary.hasData || input.kind === 'daily') return { html: renderReport(built, null, esc), ai: 'skipped' };
  if (!ai) return { html: renderReport(built, null, esc), ai: 'disabled' };

  const res = await structuredCompletion(ai, {
    name: 'report_narrative',
    schema: narrativeSchema,
    system: NARRATIVE_SYSTEM_PROMPT,
    user: `ФАКТЫ:\n${built.facts}\n\nПравила рекомендаций из программы (можно использовать):\n${built.recommendations.join('\n') || '—'}`,
  });
  if (!res.ok) return { html: renderReport(built, null, esc), ai: 'failed', error: res.error, usage: res.usage };
  const text = [res.value.summary, ...res.value.recommendations].join('\n');
  if (!numbersGrounded(text, `${built.facts}\n${built.recommendations.join('\n')}`)) {
    return { html: renderReport(built, null, esc), ai: 'rejected_ungrounded', usage: res.usage };
  }
  return { html: renderReport(built, res.value, esc), ai: 'used', usage: res.usage };
}
