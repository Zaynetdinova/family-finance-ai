import 'server-only';
import { addDays, startOfMonth } from '@/lib/finance/dates';
import { upcomingPayments } from '@/lib/finance/debts';
import { limitStatus, rollUpByCategory } from '@/lib/finance/budget';
import { debtSchedule, toMinor } from '@/lib/db/convert';
import { loadBudget, loadDebtPayments, loadReport } from '@/lib/report';
import { collectReportInput, generateReport } from '@/lib/reports/load';
import { openAiConfigFromEnv } from '@/lib/ai/openai';
import { esc } from '@/lib/telegram/format';
import type { JobRender } from './run';

export const jobRender: JobRender = {
  async report(ctx, kind, closedMonth) {
    const r = await generateReport(await collectReportInput(ctx, kind, { closed: closedMonth }), openAiConfigFromEnv(), esc);
    return r.html;
  },
  async upcoming(ctx) {
    const payments = await loadDebtPayments(ctx, addDays(ctx.today, -62));
    return upcomingPayments(ctx.debts.map(debtSchedule), payments.map((p) => ({ debtId: p.debt_id, paidOn: p.paid_on })), ctx.today, 31);
  },
  async limits(ctx) {
    const base = ctx.household.base_currency;
    const budget = await loadBudget(ctx, startOfMonth(ctx.today), base);
    if (!budget?.limits.length) return [];
    const rep = await loadReport(ctx, { period: 'month' });
    const spent = rollUpByCategory(rep.current.byCategory, rep.categories);
    return budget.limits.map((l) => {
      const st = limitStatus(toMinor(l.limit_amount), spent.get(l.category_id) ?? 0n);
      return { id: l.id, name: rep.categoryName(l.category_id), usedBp: st.usedBp, state: st.state };
    });
  },
};
